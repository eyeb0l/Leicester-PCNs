#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const MARKER_MIN_RADIUS = 2.5;
const MARKER_MAX_RADIUS = 75;
const DEFAULT_ZOOM = 13;
const HEAT_BLOB_OPTIONS = {
  minRadius: 12.5,
  maxRadius: 65,
  zoomRadiusBoost: 5,
  minOpacity: 0.07,
  maxOpacity: 0.34,
};

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
const DEBUG_FOCUS_PERCENTILES = {
  p50: 0.5,
  p90: 0.9,
  p95: 0.95,
  p99: 0.99,
  max: 1,
};
const ALL_HEAT_STOPS = [
  ["min", 0.005],
  ["p50", 0.018],
  ["p75", 0.055],
  ["p90", 0.16],
  ["p95", 0.32],
  ["p99", 0.72],
  ["max", 1],
];
const ALL_MARKER_STOPS = [
  ["min", 0.01],
  ["p50", 0.02],
  ["p90", 0.1],
  ["p95", 0.18],
  ["p99", 0.45],
  ["max", 1],
];
const TOP_HEAT_STOPS = [
  ["min", 0.08],
  ["p50", 0.18],
  ["p75", 0.3],
  ["p90", 0.55],
  ["p95", 0.76],
  ["p99", 0.93],
  ["max", 1],
];
const TOP_MARKER_STOPS = [
  ["min", 0.14],
  ["p50", 0.22],
  ["p90", 0.48],
  ["p95", 0.62],
  ["p99", 0.88],
  ["max", 1],
];
const COLOR_DEBUG_PERCENTILES = {
  p50: 0.5,
  p75: 0.75,
  p90: 0.9,
  p99: 0.99,
};
const MARKER_COLOR_RAMP = [
  [0, "#fff6ee"],
  [0.55, "#f6d8b7"],
  [0.74, "#eba567"],
  [0.9, "#c84d27"],
  [1, "#7f1018"],
];
const MARKER_OUTLINE_COLOR = "#4c120f";
const MARKER_OPACITY_STOPS = [
  [0, 0.25],
  [0.22, 0.33],
  [0.5, 0.5],
  [0.75, 0.62],
  [1, 0.8],
];
const COLOR_CAP_LABEL_BY_FILTER = {
  all: "p99",
  top200: "max",
  top100: "max",
  top50: "max",
};
const COLOR_TRANSFORM_LABELS = {
  linear: "linear",
  log: "log1p",
  percentile: "log1p",
  power: "power",
  sqrt: "square root",
};
const COLOR_POWER_GAMMA = 0.42;
const DEFAULT_WEIGHT_MODE = "log";

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

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;
  const value = Number.parseInt(expanded, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixHexColors(fromHex, toHex, amount) {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  const t = clamp(amount);
  return rgbToHex({
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  });
}

function buildOutputAnchors(countPercentiles, stopConfig) {
  const anchors = [];
  for (const [label, output] of stopConfig) {
    const count = Math.max(0, countPercentiles[label] ?? 0);
    const anchor = { label, count, output };
    if (anchors.length && anchors[anchors.length - 1].count === count) {
      anchors[anchors.length - 1] = anchor;
    } else {
      anchors.push(anchor);
    }
  }
  return anchors;
}

function interpolateAnchors(count, anchors) {
  if (!anchors.length) {
    return 0;
  }
  if (count <= anchors[0].count) {
    return anchors[0].output;
  }
  for (let index = 1; index < anchors.length; index += 1) {
    const lower = anchors[index - 1];
    const upper = anchors[index];
    if (count <= upper.count) {
      if (upper.count <= lower.count) {
        return upper.output;
      }
      const t = clamp((count - lower.count) / (upper.count - lower.count));
      return lower.output + (upper.output - lower.output) * t;
    }
  }
  return anchors[anchors.length - 1].output;
}

function computeMarkerRadius(markerStrength) {
  const span = MARKER_MAX_RADIUS - MARKER_MIN_RADIUS;
  return MARKER_MIN_RADIUS + span * clamp(markerStrength);
}

function boostHeatWeight(weight) {
  const normalized = clamp(weight);
  if (normalized <= 0.02) {
    return clamp(normalized, 0.012, 1);
  }
  if (normalized < 0.12) {
    return clamp(normalized * 0.72, 0.02, 1);
  }
  const contrasted = normalized ** 1.12;
  return clamp(contrasted, 0.015, 1);
}

function getHeatRadius(heatWeight, zoom = DEFAULT_ZOOM) {
  const zoomDelta = zoom - DEFAULT_ZOOM;
  const baseRadius =
    HEAT_BLOB_OPTIONS.minRadius +
    (HEAT_BLOB_OPTIONS.maxRadius - HEAT_BLOB_OPTIONS.minRadius) * clamp(heatWeight ** 1.08);
  return Math.round(
    clamp(
      baseRadius + Math.max(0, zoomDelta) * HEAT_BLOB_OPTIONS.zoomRadiusBoost,
      HEAT_BLOB_OPTIONS.minRadius,
      HEAT_BLOB_OPTIONS.maxRadius + 24
    )
  );
}

function getHeatOpacity(heatWeight) {
  return (
    HEAT_BLOB_OPTIONS.minOpacity +
    (HEAT_BLOB_OPTIONS.maxOpacity - HEAT_BLOB_OPTIONS.minOpacity) * clamp(heatWeight ** 0.96)
  );
}

function getColorTransformMode(weightMode) {
  if (["linear", "log", "power", "sqrt"].includes(weightMode)) {
    return weightMode;
  }
  return "log";
}

function transformCountForColor(count, transformMode) {
  const safeCount = Math.max(0, count);
  if (transformMode === "linear") {
    return safeCount;
  }
  if (transformMode === "sqrt") {
    return Math.sqrt(safeCount);
  }
  if (transformMode === "power") {
    return safeCount ** COLOR_POWER_GAMMA;
  }
  return Math.log1p(safeCount);
}

function getColorCapLabel(limit) {
  if (!Number.isFinite(limit) || limit === Infinity) {
    return COLOR_CAP_LABEL_BY_FILTER.all;
  }
  if (limit <= 50) {
    return COLOR_CAP_LABEL_BY_FILTER.top50;
  }
  if (limit <= 100) {
    return COLOR_CAP_LABEL_BY_FILTER.top100;
  }
  return COLOR_CAP_LABEL_BY_FILTER.top200;
}

function computeColorPercent(count, colorContext) {
  const transformedCap = transformCountForColor(colorContext.capCount, colorContext.transformMode);
  if (!Number.isFinite(transformedCap) || transformedCap <= 0) {
    return 0;
  }
  const transformedCount = transformCountForColor(count, colorContext.transformMode);
  return clamp(transformedCount / transformedCap);
}

function interpolateRampColor(percent, ramp) {
  const clampedPercent = clamp(percent);
  if (clampedPercent <= ramp[0][0]) {
    return ramp[0][1];
  }
  for (let index = 1; index < ramp.length; index += 1) {
    const [lowerStop, lowerColor] = ramp[index - 1];
    const [upperStop, upperColor] = ramp[index];
    if (clampedPercent <= upperStop) {
      const range = upperStop - lowerStop;
      const t = range <= 0 ? 1 : (clampedPercent - lowerStop) / range;
      return mixHexColors(lowerColor, upperColor, t);
    }
  }
  return ramp[ramp.length - 1][1];
}

function interpolateStopValue(percent, stops) {
  const clampedPercent = clamp(percent);
  if (clampedPercent <= stops[0][0]) {
    return stops[0][1];
  }
  for (let index = 1; index < stops.length; index += 1) {
    const [lowerStop, lowerValue] = stops[index - 1];
    const [upperStop, upperValue] = stops[index];
    if (clampedPercent <= upperStop) {
      const range = upperStop - lowerStop;
      const t = range <= 0 ? 1 : (clampedPercent - lowerStop) / range;
      return lowerValue + (upperValue - lowerValue) * t;
    }
  }
  return stops[stops.length - 1][1];
}

function createMarkerColorStyle(colorPercent) {
  const fillColor = interpolateRampColor(colorPercent, MARKER_COLOR_RAMP);
  const strokeColor = mixHexColors(fillColor, MARKER_OUTLINE_COLOR, 0.42);
  const fillOpacity = interpolateStopValue(colorPercent, MARKER_OPACITY_STOPS);
  return {
    fillColor,
    strokeColor,
    fillOpacity,
  };
}

function formatAnchors(anchors, decimals = 4) {
  return anchors
    .map((anchor) => `${anchor.label}:${Math.round(anchor.count)}->${anchor.output.toFixed(decimals)}`)
    .join(" · ");
}

function formatColorModeLabel(transformMode) {
  return COLOR_TRANSFORM_LABELS[transformMode] || "log1p";
}

function selectMedianColorSamples(scaledPoints, sampleSize = 5) {
  const sorted = [...scaledPoints].sort((a, b) => a.count - b.count);
  if (!sorted.length) {
    return [];
  }
  const middle = Math.floor(sorted.length / 2);
  const halfWindow = Math.floor(sampleSize / 2);
  const start = Math.max(0, middle - halfWindow);
  return sorted.slice(start, Math.min(sorted.length, start + sampleSize));
}

function buildColorSampleRows(points) {
  return points.map((point) => ({
    street: point.feature.properties.display_name,
    count: point.count,
    colorPercent: Number(point.colorPercent.toFixed(4)),
    fillColor: point.fillColor,
    fillOpacity: Number(point.fillOpacity.toFixed(2)),
  }));
}

function getStopConfig(limit) {
  if (!Number.isFinite(limit) || limit === Infinity) {
    return {
      heatStops: ALL_HEAT_STOPS,
      markerStops: ALL_MARKER_STOPS,
    };
  }
  return {
    heatStops: TOP_HEAT_STOPS,
    markerStops: TOP_MARKER_STOPS,
  };
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

function runScenario(label, limit, weightMode = DEFAULT_WEIGHT_MODE) {
  const filtered = applyTopFilter(baseFeatures, limit);
  const deduped = dedupeByCacheKey(filtered);
  const counts = deduped.map((feature) => getCount(feature));
  const countPercentiles = describePercentiles(counts, COUNT_PERCENTILES);
  const stopConfig = getStopConfig(limit);
  const heatAnchors = buildOutputAnchors(countPercentiles, stopConfig.heatStops);
  const markerAnchors = buildOutputAnchors(countPercentiles, stopConfig.markerStops);
  const colorCapLabel = getColorCapLabel(limit);
  const colorCapCount = Math.max(1, countPercentiles[colorCapLabel] || countPercentiles.max || 1);
  const colorTransformMode = getColorTransformMode(weightMode);
  const scaledPoints = deduped.map((feature) => {
    const count = getCount(feature);
    const heatStrength = interpolateAnchors(count, heatAnchors);
    const weight = boostHeatWeight(heatStrength);
    const markerStrength = interpolateAnchors(count, markerAnchors);
    const radius = computeMarkerRadius(markerStrength);
    const colorPercent = computeColorPercent(count, {
      capCount: colorCapCount,
      transformMode: colorTransformMode,
    });
    const markerColorStyle = createMarkerColorStyle(colorPercent);
    const [lon, lat] = feature.geometry.coordinates;
    return {
      feature,
      count,
      weight,
      heatRadius: getHeatRadius(weight),
      heatOpacity: getHeatOpacity(weight),
      radius,
      colorPercent,
      fillColor: markerColorStyle.fillColor,
      strokeColor: markerColorStyle.strokeColor,
      fillOpacity: markerColorStyle.fillOpacity,
      lat,
      lon,
    };
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
      fillColor: point.fillColor,
      fillOpacity: Number(point.fillOpacity.toFixed(2)),
    }));
  const topColorSamples = buildColorSampleRows(
    [...scaledPoints].sort((a, b) => b.count - a.count).slice(0, 10)
  );
  const medianColorSamples = buildColorSampleRows(selectMedianColorSamples(scaledPoints));

  console.log(`Scenario: ${label}`);
  console.log(`Streets visualized: ${scaledPoints.length}`);
  console.log("Heat mapping anchors:", formatAnchors(heatAnchors));
  console.log("Marker mapping anchors:", formatAnchors(markerAnchors));
  console.log(
    `Marker colour mapping: cap=${colorCapLabel}:${Math.round(
      colorCapCount
    )} · transform=${formatColorModeLabel(colorTransformMode)}`
  );
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
  console.log(
    "Marker colour count focus:",
    formatPercentiles(countPercentiles, Object.keys(COLOR_DEBUG_PERCENTILES))
  );
  if (limit === 50) {
    console.log(
      "Top 50 count focus:",
      formatPercentiles(countPercentiles, Object.keys(DEBUG_FOCUS_PERCENTILES))
    );
    console.log(
      "Top 50 weight focus:",
      formatPercentiles(weightPercentiles, Object.keys(DEBUG_FOCUS_PERCENTILES), 4)
    );
  }
  console.table(topRows);
  console.log("Marker colour samples: top 10");
  console.table(topColorSamples);
  console.log("Marker colour samples: around p50");
  console.table(medianColorSamples);
  console.log("");
}

runScenario("All streets", Infinity);
runScenario("Top 50 streets", 50);
