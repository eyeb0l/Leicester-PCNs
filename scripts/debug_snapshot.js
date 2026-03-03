#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const SCALE_EXPONENT = 2.2;
const HEAT_WEIGHT_FLOOR = 0.08;
const MARKER_MIN_RADIUS = 2;
const MARKER_MAX_RADIUS = 18;

const COUNT_PERCENTILES = {
  min: 0,
  p25: 0.25,
  p50: 0.5,
  p75: 0.75,
  p90: 0.9,
  p95: 0.95,
  p99: 0.99,
  max: 1,
};
const WEIGHT_PERCENTILES = {
  min: 0,
  p25: 0.25,
  p50: 0.5,
  p75: 0.75,
  p90: 0.9,
  p95: 0.95,
  p99: 0.99,
  max: 1,
};
const RADIUS_PERCENTILES = {
  min: 0,
  p50: 0.5,
  p90: 0.9,
  p99: 0.99,
  max: 1,
};

const dataPath = path.join(__dirname, "..", "data", "build", "streets.geojson");
const geojson = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const baseFeatures = (geojson.features || []).filter((feature) => !feature.properties.is_zero_count);

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function quantile(sortedValues, percentile) {
  if (!sortedValues.length) {
    return 0;
  }
  const clampedPercent = clamp(percentile, 0, 1);
  const index = Math.round(clampedPercent * (sortedValues.length - 1));
  return sortedValues[index];
}

function describePercentiles(values, config) {
  if (!values.length) {
    return Object.fromEntries(Object.keys(config).map((label) => [label, 0]));
  }
  const sorted = [...values].sort((a, b) => a - b);
  return Object.fromEntries(
    Object.entries(config).map(([label, percent]) => [label, quantile(sorted, percent)])
  );
}

function normalizeCount(count, capCount) {
  if (!capCount) {
    return 0;
  }
  const clampedCount = Math.min(Math.max(count, 0), capCount);
  return clampedCount / capCount;
}

function computeMarkerRadius(normalized) {
  const span = MARKER_MAX_RADIUS - MARKER_MIN_RADIUS;
  return MARKER_MIN_RADIUS + span * (Math.max(0, normalized) ** SCALE_EXPONENT);
}

function dedupeByCacheKey(features) {
  const map = new Map();
  for (const feature of features) {
    const key = feature.properties.cache_key || feature.properties.display_name;
    const existing = map.get(key);
    if (!existing || getCount(feature) > getCount(existing)) {
      map.set(key, feature);
    }
  }
  return Array.from(map.values());
}

function getCount(feature) {
  return Number(feature.properties.count_total) || 0;
}

function applyTopFilter(features, limit) {
  if (!Number.isFinite(limit) || limit === Infinity || features.length <= limit) {
    return features;
  }
  const sorted = [...features].sort((a, b) => getCount(b) - getCount(a));
  return sorted.slice(0, limit);
}

function formatPercentiles(stats, order, decimals = 0) {
  return order
    .map((label) => {
      const value = stats[label] ?? 0;
      const formatted = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
      return `${label}:${formatted}`;
    })
    .join(" · ");
}

function runScenario(label, limit) {
  const filtered = applyTopFilter(baseFeatures, limit);
  const deduped = dedupeByCacheKey(filtered);
  const counts = deduped.map((feature) => getCount(feature));
  const countPercentiles = describePercentiles(counts, COUNT_PERCENTILES);
  const capCount = Math.max(1, countPercentiles.p99 || countPercentiles.max || 1);
  const scaledPoints = deduped.map((feature) => {
    const count = getCount(feature);
    const normalized = normalizeCount(count, capCount);
    const rawWeight = Math.max(0, normalized) ** SCALE_EXPONENT;
    const weight = rawWeight >= HEAT_WEIGHT_FLOOR ? rawWeight : 0;
    const radius = computeMarkerRadius(normalized);
    const [lon, lat] = feature.geometry.coordinates;
    return { feature, count, normalized, weight, radius, lat, lon };
  });
  const weightPercentiles = describePercentiles(
    scaledPoints.map((point) => point.weight),
    WEIGHT_PERCENTILES
  );
  const radiusPercentiles = describePercentiles(
    scaledPoints.map((point) => point.radius),
    RADIUS_PERCENTILES
  );
  const topRows = [...scaledPoints]
    .sort((a, b) => b.count - a.count)
    .slice(0, 25)
    .map((point) => ({
      street: point.feature.properties.display_name,
      count: point.count,
      weight: Number(point.weight.toFixed(4)),
      radius: Number(point.radius.toFixed(2)),
    }));

  console.log(`Scenario: ${label}`);
  console.log(`Streets visualized: ${scaledPoints.length}`);
  console.log(
    "Count percentiles:",
    formatPercentiles(countPercentiles, Object.keys(COUNT_PERCENTILES))
  );
  console.log(
    "Weight percentiles:",
    formatPercentiles(weightPercentiles, Object.keys(WEIGHT_PERCENTILES), 4)
  );
  console.log(
    "Marker radius percentiles:",
    formatPercentiles(radiusPercentiles, Object.keys(RADIUS_PERCENTILES), 2)
  );
  console.table(topRows);
  console.log("");
}

runScenario("All streets", Infinity);
runScenario("Top 50 streets", 50);
