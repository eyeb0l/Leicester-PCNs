const LEICESTER_CENTER = [52.6369, -1.1398];
const DEFAULT_ZOOM = 13;
const MARKER_MIN_ZOOM = 14;
const DEBUG_SHOW_WEIGHTS = true;
const SCALE_EXPONENT = 2.2;
const HEAT_WEIGHT_FLOOR = 0.08;
const MARKER_MIN_RADIUS = 2;
const MARKER_MAX_RADIUS = 18;
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
// Normalized weights + conservative heat settings keep hotspots readable instead of saturating the city.
const HEAT_LAYER_OPTIONS = {
  radius: 10,
  blur: 7,
  maxZoom: 17,
  minOpacity: 0.2,
  maxOpacity: 0.5,
  max: 1,
};
const HEAT_GRADIENT = {
  0.2: "#fee6a8",
  0.45: "#f0893f",
  0.75: "#d7441f",
  1.0: "#8c1b13",
};
const WEIGHT_MODE_LABELS = {
  power: "power (γ=2.2)",
  linear: "linear",
  sqrt: "square root",
  log: "logarithmic",
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

function createWeightCalculator(mode) {
  if (mode === "linear") {
    return (x) => clamp(x);
  }
  if (mode === "sqrt") {
    return (x) => clamp(Math.sqrt(Math.max(0, x)));
  }
  if (mode === "log") {
    const scale = Math.log1p(9);
    return (x) => clamp(Math.log1p(Math.max(0, x) * 9) / scale);
  }
  return (x) => clamp(Math.max(0, x) ** SCALE_EXPONENT);
}

function quantile(sortedValues, percentile) {
  if (!sortedValues.length) {
    return 0;
  }
  const clampedPercent = clamp(percentile, 0, 1);
  const index = Math.round(clampedPercent * (sortedValues.length - 1));
  return sortedValues[index];
}

function normalizeCount(count, capCount) {
  if (!Number.isFinite(capCount) || capCount <= 0) {
    return 0;
  }
  const clampedCount = Math.min(Math.max(count, 0), capCount);
  return clampedCount / capCount;
}

function computeMarkerRadius(normalizedCount) {
  const span = MARKER_MAX_RADIUS - MARKER_MIN_RADIUS;
  return MARKER_MIN_RADIUS + span * (Math.max(0, normalizedCount) ** SCALE_EXPONENT);
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

function getCount(feature) {
  return Number(feature.properties.count_total) || 0;
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

function logHeatSummary(mode, scaledPoints, stats) {
  const topStreets = [...scaledPoints]
    .sort((a, b) => b.count - a.count)
    .slice(0, 25)
    .map((point) => ({
      street: point.feature.properties.display_name,
      count: point.count,
      weight: Number(point.weight.toFixed(4)),
      radius: Number(point.radius.toFixed(2)),
    }));

  console.groupCollapsed(`[heat] mode=${mode} points=${scaledPoints.length} capCount=${stats.capCount}`);
  console.log(`Streets visualized: ${scaledPoints.length}`);
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
  console.table(topStreets);
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

function computeScalingContext(features) {
  const counts = features.map((feature) => getCount(feature));
  const countPercentiles = describePercentiles(counts, COUNT_PERCENTILES);
  const capCount = Math.max(1, countPercentiles.p99 || countPercentiles.max || 1);
  return { capCount, countPercentiles };
}

function buildScaledPoints(features, mode, scalingContext) {
  if (!features.length) {
    return {
      scaledPoints: [],
      stats: {
        capCount: 0,
        countPercentiles: describePercentiles([], COUNT_PERCENTILES),
        weightPercentiles: describePercentiles([], WEIGHT_PERCENTILES),
        radiusPercentiles: describePercentiles([], RADIUS_PERCENTILES),
      },
    };
  }

  const weightFor = createWeightCalculator(mode);
  const scaledPoints = features.map((feature) => {
    const count = getCount(feature);
    const normalized = normalizeCount(count, scalingContext.capCount);
    const rawWeight = weightFor(normalized);
    const weight = rawWeight >= HEAT_WEIGHT_FLOOR ? rawWeight : 0;
    const radius = computeMarkerRadius(normalized);
    const [lon, lat] = feature.geometry.coordinates;
    return {
      feature,
      lat,
      lon,
      count,
      normalized,
      weight,
      radius,
    };
  });

  return {
    scaledPoints,
    stats: {
      capCount: scalingContext.capCount,
      countPercentiles: scalingContext.countPercentiles,
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
  const { display_name: displayName, count_total: countTotal, source_rows: sourceRows, aliases } = feature.properties;
  const aliasHtml =
    aliases.length > 1
      ? `<p class="aliases">Aliases: ${aliases.map((alias) => escapeHtml(alias)).join(", ")}</p>`
      : "";

  return `
    <div class="popup-content">
      <h3>${escapeHtml(displayName)}</h3>
      <p><strong>${formatNumber(countTotal)}</strong> fines</p>
      <p>${formatNumber(sourceRows)} source row${sourceRows === 1 ? "" : "s"}</p>
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
    const marker = L.circleMarker([point.lat, point.lon], {
      radius: point.radius,
      color: "#8d280f",
      weight: 1,
      fillColor: "#d65f2a",
      fillOpacity: 0.72,
      opacity: 0.85,
    });
    marker.bindPopup(popupHtml(point.feature));
    layer.addLayer(marker);
  }
  return layer;
}

function buildHeatLayer(features, mode, scalingContext) {
  const { scaledPoints, stats } = buildScaledPoints(features, mode, scalingContext);
  if (DEBUG_SHOW_WEIGHTS) {
    logHeatSummary(mode, scaledPoints, stats);
  }

  const heatPoints = scaledPoints.map((point) => [point.lat, point.lon, point.weight]);
  return {
    layer:
      heatPoints.length > 0
        ? L.heatLayer(heatPoints, {
            ...HEAT_LAYER_OPTIONS,
            gradient: HEAT_GRADIENT,
          })
        : null,
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

function applyFilters(summary) {
  const showZeroes = elements.toggleZeroes.checked;
  const searchTerm = elements.searchInput.value.trim().toLowerCase();
  const weightMode = elements.weightMode.value;
  const topFilterMode = elements.topFilter.value;

  const baseFiltered = allFeatures.filter((feature) => {
    const isVisibleZero = showZeroes || !feature.properties.is_zero_count;
    return isVisibleZero && matchesSearch(feature, searchTerm);
  });
  visibleFeatures = applyTopCountFilter(baseFiltered, topFilterMode);

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
  const scalingContext = computeScalingContext(heatFeatures);
  const heatResult = buildHeatLayer(heatFeatures, weightMode, scalingContext);
  markerLayer = buildMarkerLayer(heatResult.scaledPoints);
  heatLayer = heatResult.layer;

  if (heatLayer && elements.toggleHeat.checked && heatResult.scaledPoints.length > 0) {
    heatLayer.addTo(map);
  }

  updateMarkerVisibility();
  elements.legendMode.textContent = WEIGHT_MODE_LABELS[weightMode] || `${weightMode} scale`;
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
      elements.weightMode.value = "power";
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
    map.on("zoomend", updateMarkerVisibility);

    hideStatus();
  } catch (error) {
    showStatus(error.message);
    console.error(error);
  }
}

init();
