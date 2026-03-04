const LEICESTER_CENTER = [52.6369, -1.1398];
const DEFAULT_ZOOM = 13;
const MARKER_MIN_ZOOM = 14;
const MANUAL_OVERRIDE_STATUS = "manual_override";
const DEBUG_SHOW_WEIGHTS = false;
const MARKER_MIN_RADIUS = 2.5;
const MARKER_MAX_RADIUS = 75;
const TOP_FILTER_LIMITS = {
  all: Infinity,
  top200: 200,
  top100: 100,
  top50: 50,
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
  [0, 0.22],
  [0.22, 0.3],
  [0.5, 0.46],
  [0.75, 0.58],
  [1, 0.74],
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
// Heat layer is rendered as large colour-matched blobs so the palette tracks the markers.
const HEAT_BLOB_OPTIONS = {
  minRadius: 12.5,
  maxRadius: 65,
  zoomRadiusBoost: 5,
  minOpacity: 0.07,
  maxOpacity: 0.34,
};
const WEIGHT_MODE_LABELS = {
  log: "logarithmic",
  power: "power",
  sqrt: "square root",
  linear: "linear",
  percentile: "percentile anchored",
};

const elements = {
  searchInput: document.querySelector("#search-input"),
  weightMode: document.querySelector("#weight-mode"),
  topFilter: document.querySelector("#top-filter"),
  toggleHeat: document.querySelector("#toggle-heat"),
  toggleMarkers: document.querySelector("#toggle-markers"),
  toggleZeroes: document.querySelector("#toggle-zeroes"),
  resetView: document.querySelector("#reset-view"),
  summaryList: document.querySelector("#summary-list"),
  legendMode: document.querySelector("#legend-mode"),
  legendBar: document.querySelector("#legend-bar"),
  legendTicks: document.querySelector("#legend-ticks"),
  statusBanner: document.querySelector("#status-banner"),
};

const map = L.map("map", {
  zoomControl: true,
  minZoom: 11,
}).setView(LEICESTER_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

let allFeatures = [];
let visibleFeatures = [];
let markerLayer = L.layerGroup();
let heatLayer = null;
let defaultBounds = null;
let lastFocusedSearchKey = "";

function showStatus(message) {
  elements.statusBanner.textContent = message;
  elements.statusBanner.classList.remove("is-hidden");
}

function hideStatus() {
  elements.statusBanner.classList.add("is-hidden");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) {
    return min;
  }
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
    return Object.fromEntries(Object.keys(config).map((key) => [key, 0]));
  }
  const sorted = [...values].sort((a, b) => a - b);
  return Object.fromEntries(
    Object.entries(config).map(([label, percent]) => [label, quantile(sorted, percent)])
  );
}

function formatPercentileStats(stats, order, decimals = 0) {
  return order
    .map((label) => {
      const value = stats[label] ?? 0;
      const formatted =
        decimals > 0 ? Number(value).toFixed(decimals) : formatNumber(Math.round(value));
      return `${label}:${formatted}`;
    })
    .join(" · ");
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

function getHeatRadius(heatWeight, zoom) {
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

function getColorCapLabel(topFilterMode) {
  return COLOR_CAP_LABEL_BY_FILTER[topFilterMode] || "p99";
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
    colorPercent,
    fillColor,
    strokeColor,
    fillOpacity,
  };
}

function buildLegendGradient(ramp) {
  const stops = ramp
    .map(([stop, color]) => `${color} ${Math.round(stop * 100)}%`)
    .join(", ");
  return `linear-gradient(90deg, ${stops})`;
}

function formatAnchorStats(anchors, decimals = 2) {
  return anchors
    .map((anchor) => `${anchor.label}:${formatNumber(Math.round(anchor.count))}->${anchor.output.toFixed(decimals)}`)
    .join(" · ");
}

function getCount(feature) {
  return Number(feature.properties.count_total) || 0;
}

function getFeatureKey(feature) {
  return feature.properties.cache_key || feature.properties.display_name;
}

function isManualOverride(feature) {
  return feature.properties.geocode_status === MANUAL_OVERRIDE_STATUS;
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

function applyTopCountFilter(features, mode) {
  const limit = TOP_FILTER_LIMITS[mode] ?? Infinity;
  if (!Number.isFinite(limit) || limit === Infinity || features.length <= limit) {
    return features;
  }
  const sorted = [...features].sort((a, b) => getCount(b) - getCount(a));
  return sorted.slice(0, limit);
}

function matchesSearch(feature, term) {
  if (!term) {
    return true;
  }
  const haystacks = [feature.properties.display_name, ...(feature.properties.aliases || [])]
    .join(" ")
    .toLowerCase();
  return haystacks.includes(term);
}

function logHeatSummary(topFilterMode, scaledPoints, stats) {
  const topStreets = [...scaledPoints]
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

  console.groupCollapsed(
    `[heat] filter=${topFilterMode} points=${scaledPoints.length}`
  );
  console.log(`Streets visualized: ${scaledPoints.length}`);
  console.log("Heat mapping anchors:", formatAnchorStats(stats.heatAnchors, 4));
  console.log("Marker mapping anchors:", formatAnchorStats(stats.markerAnchors, 4));
  console.log(
    `Marker colour mapping: cap=${stats.colorCapLabel}:${formatNumber(
      Math.round(stats.colorCapCount)
    )} · transform=${formatColorModeLabel(stats.colorTransformMode)}`
  );
  console.log(
    "Count percentiles:",
    formatPercentileStats(stats.countPercentiles, Object.keys(COUNT_PERCENTILES))
  );
  console.log(
    "Weight percentiles:",
    formatPercentileStats(stats.weightPercentiles, Object.keys(WEIGHT_PERCENTILES), 4)
  );
  console.log(
    "Marker radius percentiles:",
    formatPercentileStats(stats.radiusPercentiles, Object.keys(RADIUS_PERCENTILES), 2)
  );
  console.log(
    "Marker colour count focus:",
    formatPercentileStats(stats.countPercentiles, Object.keys(COLOR_DEBUG_PERCENTILES))
  );
  if (topFilterMode === "top50") {
    console.log(
      "Top 50 count focus:",
      formatPercentileStats(stats.countPercentiles, Object.keys(DEBUG_FOCUS_PERCENTILES))
    );
    console.log(
      "Top 50 weight focus:",
      formatPercentileStats(stats.weightPercentiles, Object.keys(DEBUG_FOCUS_PERCENTILES), 4)
    );
  }
  console.table(topStreets);
  console.log("Marker colour samples: top 10");
  console.table(topColorSamples);
  console.log("Marker colour samples: around p50");
  console.table(medianColorSamples);
  console.groupEnd();
}

function dedupeByCacheKey(features) {
  const map = new Map();
  for (const feature of features) {
    const key = feature.properties.cache_key || feature.properties.display_name;
    const existing = map.get(key);
    if (!existing || (feature.properties.count_total || 0) > (existing.properties.count_total || 0)) {
      map.set(key, feature);
    }
  }
  return Array.from(map.values());
}

function getStopConfig(topFilterMode) {
  if (topFilterMode === "all") {
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

function computeScalingContext(features, topFilterMode, weightMode) {
  const counts = features.map((feature) => getCount(feature));
  const countPercentiles = describePercentiles(counts, COUNT_PERCENTILES);
  const stopConfig = getStopConfig(topFilterMode);
  const heatAnchors = buildOutputAnchors(countPercentiles, stopConfig.heatStops);
  const markerAnchors = buildOutputAnchors(countPercentiles, stopConfig.markerStops);
  const colorCapLabel = getColorCapLabel(topFilterMode);
  const colorCapCount = Math.max(1, countPercentiles[colorCapLabel] || countPercentiles.max || 1);
  const colorTransformMode = getColorTransformMode(weightMode);
  return {
    countPercentiles,
    heatAnchors,
    markerAnchors,
    colorCapLabel,
    colorCapCount,
    colorTransformMode,
  };
}

function buildScaledPoints(features, scalingContext) {
  if (!features.length) {
    return {
      scaledPoints: [],
      stats: {
        countPercentiles: describePercentiles([], COUNT_PERCENTILES),
        heatAnchors: [],
        markerAnchors: [],
        colorCapLabel: "p99",
        colorCapCount: 0,
        colorTransformMode: "log",
        weightPercentiles: describePercentiles([], WEIGHT_PERCENTILES),
        radiusPercentiles: describePercentiles([], RADIUS_PERCENTILES),
      },
    };
  }

  const scaledPoints = features.map((feature) => {
    const count = getCount(feature);
    const heatStrength = interpolateAnchors(count, scalingContext.heatAnchors);
    const weight = boostHeatWeight(heatStrength);
    const markerStrength = interpolateAnchors(count, scalingContext.markerAnchors);
    const radius = computeMarkerRadius(markerStrength);
    const colorPercent = computeColorPercent(count, {
      capCount: scalingContext.colorCapCount,
      transformMode: scalingContext.colorTransformMode,
    });
    const markerColorStyle = createMarkerColorStyle(colorPercent);
    const [lon, lat] = feature.geometry.coordinates;
    return {
      feature,
      lat,
      lon,
      count,
      weight,
      heatRadius: getHeatRadius(weight, map.getZoom()),
      heatOpacity: getHeatOpacity(weight),
      radius,
      colorPercent,
      fillColor: markerColorStyle.fillColor,
      strokeColor: markerColorStyle.strokeColor,
      fillOpacity: markerColorStyle.fillOpacity,
    };
  });

  return {
    scaledPoints,
    stats: {
      countPercentiles: scalingContext.countPercentiles,
      heatAnchors: scalingContext.heatAnchors,
      markerAnchors: scalingContext.markerAnchors,
      colorCapLabel: scalingContext.colorCapLabel,
      colorCapCount: scalingContext.colorCapCount,
      colorTransformMode: scalingContext.colorTransformMode,
      weightPercentiles: describePercentiles(
        scaledPoints.map((point) => point.weight),
        WEIGHT_PERCENTILES
      ),
      radiusPercentiles: describePercentiles(
        scaledPoints.map((point) => point.radius),
        RADIUS_PERCENTILES
      ),
    },
  };
}

function popupHtml(feature) {
  const {
    display_name: displayName,
    count_total: countTotal,
    source_rows: sourceRows,
    aliases,
    geocode_status: geocodeStatus,
    marker_fill_color: markerFillColor,
    marker_fill_opacity: markerFillOpacity,
  } = feature.properties;
  const aliasHtml =
    aliases.length > 1
      ? `<p class="aliases">Aliases: ${aliases.map((alias) => escapeHtml(alias)).join(", ")}</p>`
      : "";
  const statusHtml =
    geocodeStatus === MANUAL_OVERRIDE_STATUS
      ? '<p class="marker-style"><strong>Manual override</strong></p>'
      : "";
  const markerStyleHtml =
    markerFillColor && Number.isFinite(markerFillOpacity)
      ? `<p class="marker-style">Marker: ${escapeHtml(markerFillColor)} · opacity ${Number(
          markerFillOpacity
        ).toFixed(2)}</p>`
      : "";

  return `
    <div class="popup-content">
      <h3>${escapeHtml(displayName)}</h3>
      <p><strong>${formatNumber(countTotal)}</strong> fines</p>
      <p>${formatNumber(sourceRows)} source row${sourceRows === 1 ? "" : "s"}</p>
      ${statusHtml}
      ${markerStyleHtml}
      ${aliasHtml}
    </div>
  `;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function updateSummary(summary, filteredCount) {
  const rows = [
    ["Source rows", formatNumber(summary.source_row_count)],
    ["Normalized streets", formatNumber(summary.normalized_street_count)],
    ["Geocoded streets", formatNumber(summary.geocoded_success_count)],
    ["Failed geocodes", formatNumber(summary.failed_geocode_count)],
    ["Zero-count mapped", formatNumber(summary.zero_count_feature_count)],
    ["Duplicate groups", formatNumber(summary.duplicate_groups_resolved)],
    ["Visible streets", formatNumber(filteredCount)],
  ];

  elements.summaryList.innerHTML = rows
    .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
    .join("");
}

function buildMarkerLayer(scaledPoints) {
  const layer = L.layerGroup();
  for (const point of scaledPoints) {
    point.feature.properties.marker_fill_color = point.fillColor;
    point.feature.properties.marker_fill_opacity = point.fillOpacity;
    const marker = L.circleMarker([point.lat, point.lon], {
      radius: point.radius,
      color: point.strokeColor,
      weight: isManualOverride(point.feature) ? 2 : 1,
      fillColor: point.fillColor,
      fillOpacity: point.fillOpacity,
      opacity: 0.88,
    });
    marker.bindPopup(popupHtml(point.feature));
    layer.addLayer(marker);
  }
  return layer;
}

function buildHeatLayerFromPoints(scaledPoints) {
  const layer = L.layerGroup();
  for (const point of scaledPoints) {
    const heatMarker = L.circleMarker([point.lat, point.lon], {
      radius: point.heatRadius,
      stroke: false,
      fillColor: point.fillColor,
      fillOpacity: point.heatOpacity,
      interactive: false,
      bubblingMouseEvents: false,
    });
    layer.addLayer(heatMarker);
  }
  return layer;
}

function updateLegend(stats) {
  if (elements.legendBar) {
    elements.legendBar.style.background = buildLegendGradient(MARKER_COLOR_RAMP);
  }
  if (elements.legendTicks) {
    const tickSpecs = [
      { label: "0", count: 0 },
      { label: "P50", count: stats.countPercentiles.p50 || 0 },
      { label: "P75", count: stats.countPercentiles.p75 || 0 },
      { label: "P90", count: stats.countPercentiles.p90 || 0 },
      { label: stats.colorCapLabel.toUpperCase(), count: stats.colorCapCount || 0 },
    ];
    elements.legendTicks.innerHTML = tickSpecs
      .map((tick) => {
        const colorPercent = computeColorPercent(tick.count, {
          capCount: stats.colorCapCount,
          transformMode: stats.colorTransformMode,
        });
        const markerColorStyle = createMarkerColorStyle(colorPercent);
        return `
          <div class="legend-tick">
            <span class="legend-swatch" style="background:${markerColorStyle.fillColor}; border-color:${markerColorStyle.strokeColor}; opacity:${markerColorStyle.fillOpacity};"></span>
            <span class="legend-tick-label">${tick.label}</span>
            <span class="legend-tick-value">${formatNumber(Math.round(tick.count))}</span>
          </div>
        `;
      })
      .join("");
  }
  elements.legendMode.textContent = `marker colour · ${formatColorModeLabel(
    stats.colorTransformMode
  )} / ${stats.colorCapLabel} cap`;
}

function buildHeatLayer(features, topFilterMode, scalingContext) {
  const { scaledPoints, stats } = buildScaledPoints(features, scalingContext);
  if (DEBUG_SHOW_WEIGHTS) {
    logHeatSummary(topFilterMode, scaledPoints, stats);
  }

  return {
    layer: scaledPoints.length > 0 ? buildHeatLayerFromPoints(scaledPoints) : null,
    scaledPoints,
    stats,
  };
}

function updateMarkerVisibility() {
  const shouldShow = elements.toggleMarkers.checked && map.getZoom() >= MARKER_MIN_ZOOM;
  const hasLayer = map.hasLayer(markerLayer);
  if (shouldShow && !hasLayer) {
    markerLayer.addTo(map);
  } else if (!shouldShow && hasLayer) {
    map.removeLayer(markerLayer);
  }
}

function focusVisibleFeatures(features, searchTerm, focusKey) {
  if (!searchTerm || focusKey === lastFocusedSearchKey || !features.length) {
    if (!searchTerm) {
      lastFocusedSearchKey = "";
    }
    return;
  }

  const points = features.map((feature) => {
    const [lon, lat] = feature.geometry.coordinates;
    return [lat, lon];
  });

  const bounds = L.latLngBounds(points);
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.4), { maxZoom: 16 });
    lastFocusedSearchKey = focusKey;
  }
}

function applyFilters(summary) {
  const showZeroes = elements.toggleZeroes.checked;
  const searchTerm = elements.searchInput.value.trim().toLowerCase();
  const weightMode = elements.weightMode.value;
  const topFilterMode = elements.topFilter.value;

  const baseFiltered = allFeatures.filter((feature) => {
    const isVisibleZero = showZeroes || !feature.properties.is_zero_count;
    return isVisibleZero;
  });
  const topFiltered = applyTopCountFilter(baseFiltered, topFilterMode);
  visibleFeatures = topFiltered.filter((feature) => matchesSearch(feature, searchTerm));

  if (map.hasLayer(markerLayer)) {
    map.removeLayer(markerLayer);
  }
  if (heatLayer && map.hasLayer(heatLayer)) {
    map.removeLayer(heatLayer);
  }
  const heatFeatures = dedupeByCacheKey(visibleFeatures);
  if (DEBUG_SHOW_WEIGHTS && heatFeatures.length !== visibleFeatures.length) {
    console.info(
      `[heat] deduped ${visibleFeatures.length - heatFeatures.length} overlapping point(s) before rendering`
    );
  }
  const scalingContext = computeScalingContext(heatFeatures, topFilterMode, weightMode);
  const heatResult = buildHeatLayer(heatFeatures, topFilterMode, scalingContext);
  markerLayer = buildMarkerLayer(heatResult.scaledPoints);
  heatLayer = heatResult.layer;

  if (heatLayer && elements.toggleHeat.checked && heatResult.scaledPoints.length > 0) {
    heatLayer.addTo(map);
  }

  updateMarkerVisibility();
  focusVisibleFeatures(
    visibleFeatures,
    searchTerm,
    `${topFilterMode}|${showZeroes ? "zeroes" : "nonzero"}|${searchTerm}`
  );
  updateLegend(heatResult.stats);
  updateSummary(summary, visibleFeatures.length);
}

function setDefaultBounds(features) {
  const points = features
    .filter((feature) => !feature.properties.is_zero_count)
    .map((feature) => {
      const [lon, lat] = feature.geometry.coordinates;
      return [lat, lon];
    });

  if (points.length > 0) {
    defaultBounds = L.latLngBounds(points);
    map.fitBounds(defaultBounds.pad(0.08));
  }
}

async function init() {
  showStatus("Loading prepared map data…");

  try {
    const [geojsonResponse, summaryResponse] = await Promise.all([
      fetch("data/build/streets.geojson"),
      fetch("data/build/summary.json"),
    ]);

    if (!geojsonResponse.ok || !summaryResponse.ok) {
      throw new Error("Missing prepared data. Run the Python build scripts first.");
    }

    const geojson = await geojsonResponse.json();
    const summary = await summaryResponse.json();

    allFeatures = geojson.features || [];
    setDefaultBounds(allFeatures);
    applyFilters(summary);

    elements.searchInput.addEventListener("input", () => applyFilters(summary));
    elements.weightMode.addEventListener("change", () => applyFilters(summary));
    elements.topFilter.addEventListener("change", () => applyFilters(summary));
    elements.toggleHeat.addEventListener("change", () => applyFilters(summary));
    elements.toggleMarkers.addEventListener("change", () => updateMarkerVisibility());
    elements.toggleZeroes.addEventListener("change", () => applyFilters(summary));
    elements.resetView.addEventListener("click", () => {
      elements.searchInput.value = "";
      elements.weightMode.value = "log";
      elements.topFilter.value = "all";
      elements.toggleHeat.checked = true;
      elements.toggleMarkers.checked = true;
      elements.toggleZeroes.checked = false;
      if (defaultBounds) {
        map.fitBounds(defaultBounds.pad(0.08));
      } else {
        map.setView(LEICESTER_CENTER, DEFAULT_ZOOM);
      }
      applyFilters(summary);
    });
    map.on("zoomend", () => {
      if (elements.toggleHeat.checked) {
        applyFilters(summary);
        return;
      }
      updateMarkerVisibility();
    });

    hideStatus();
  } catch (error) {
    showStatus(error.message);
    console.error(error);
  }
}

init();
