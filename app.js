const LEICESTER_CENTER = [52.6369, -1.1398];
const DEFAULT_ZOOM = 13;
const MARKER_MIN_ZOOM = 14;
const MANUAL_OVERRIDE_STATUS = "manual_override";
const DEBUG_SHOW_WEIGHTS = false;
const MARKER_MIN_RADIUS = 2.5;
const MARKER_MAX_RADIUS = 75;
const THEME_STORAGE_KEY = "leicester-theme-preference";
const MAP_CONFIG_PATH = "map-config.json";
const MAPBOX_CONFIG_ERROR_MESSAGE =
  "Missing Mapbox configuration. Copy map-config.example.json to map-config.json and add a public Mapbox token.";
const MAPBOX_TILE_ERROR_MESSAGE =
  "Mapbox tiles failed to load. Check the token and its URL restrictions.";
const MAPBOX_ATTRIBUTION =
  '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> <a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener noreferrer">Improve this map</a>';
const DEFAULT_BASEMAP_STYLES = Object.freeze({
  light: "mapbox/streets-v12",
  dark: "mapbox/dark-v11",
});
const THEME_MAP_PROFILES = Object.freeze({
  light: {
    tileFilter: "contrast(1.08) brightness(0.96) saturate(0.9)",
    heatOpacityScale: 0.82,
    heatRadiusScale: 0.94,
    markerOutlineMix: 0.56,
    markerOpacityBoost: 0.06,
  },
  dark: {
    tileFilter: "none",
    heatOpacityScale: 1,
    heatRadiusScale: 1,
    markerOutlineMix: 0.42,
    markerOpacityBoost: 0,
  },
});
const THEME_COLORS = {
  light: "#f8f3e8",
  dark: "#111820",
};
const TOP_FILTER_LIMITS = {
  all: Infinity,
  top200: 200,
  top100: 100,
  top50: 50,
};
const METRIC_MODES = Object.freeze({
  total: "total",
  density: "density",
});
const METRIC_LABELS = Object.freeze({
  [METRIC_MODES.total]: "total fines",
  [METRIC_MODES.density]: "density (fines/mi)",
});
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
  log: "logarithmic",
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
const DATASET_DAY_COUNT = 365;
const rootElement = document.documentElement;
const bodyElement = document.body;
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
const supportedColorSchemesMeta = document.querySelector('meta[name="supported-color-schemes"]');
const systemThemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
const themeState = {
  mode: rootElement.dataset.theme === "dark" ? "dark" : "light",
  source: rootElement.dataset.themeSource === "manual" ? "manual" : "system",
};
const elements = {
  themeToggle: document.querySelector("#theme-toggle"),
  themeToggleNote: document.querySelector("#theme-toggle-note"),
  themeReset: document.querySelector("#theme-reset"),
  searchInput: document.querySelector("#search-input"),
  weightMode: document.querySelector("#weight-mode"),
  topFilter: document.querySelector("#top-filter"),
  metricMode: document.querySelector("#metric-mode"),
  toggleHeat: document.querySelector("#toggle-heat"),
  toggleMarkers: document.querySelector("#toggle-markers"),
  toggleZeroes: document.querySelector("#toggle-zeroes"),
  resetView: document.querySelector("#reset-view"),
  summaryList: document.querySelector("#summary-list"),
  leagueTable: document.querySelector("#league-table"),
  leagueTableMeta: document.querySelector("#league-table-meta"),
  legendMode: document.querySelector("#legend-mode"),
  legendBar: document.querySelector("#legend-bar"),
  legendTicks: document.querySelector("#legend-ticks"),
  statusBanner: document.querySelector("#status-banner"),
  mapboxWordmark: document.querySelector("#mapbox-wordmark"),
};

const map = L.map("map", {
  zoomControl: true,
  minZoom: 11,
}).setView(LEICESTER_CENTER, DEFAULT_ZOOM);

let allFeatures = [];
let visibleFeatures = [];
let baseTileLayer = null;
let markerLayer = L.layerGroup();
let heatLayer = null;
let defaultBounds = null;
let lastFocusedSearchKey = "";
let basemapConfig = null;
let transientStatusMessage = "";
let persistentStatusMessage = "";

function getSystemTheme() {
  return systemThemeMediaQuery.matches ? "dark" : "light";
}

function updateThemeMeta(theme) {
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", THEME_COLORS[theme] || THEME_COLORS.light);
  }
  if (colorSchemeMeta) {
    colorSchemeMeta.setAttribute("content", theme);
  }
  if (supportedColorSchemesMeta) {
    supportedColorSchemesMeta.setAttribute("content", theme);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function toStatusMessage(error, fallback) {
  if (error instanceof Error && isNonEmptyString(error.message)) {
    return error.message;
  }
  if (isNonEmptyString(error)) {
    return error.trim();
  }
  return fallback;
}

function renderStatus() {
  if (!elements.statusBanner) {
    return;
  }
  const message = persistentStatusMessage || transientStatusMessage;
  if (message) {
    elements.statusBanner.textContent = message;
    elements.statusBanner.classList.remove("is-hidden");
    return;
  }
  elements.statusBanner.textContent = "";
  elements.statusBanner.classList.add("is-hidden");
}

function showStatus(message, options = {}) {
  const { persistent = false } = options;
  const nextMessage = isNonEmptyString(message) ? message.trim() : "";
  if (persistent) {
    persistentStatusMessage = nextMessage;
  } else {
    transientStatusMessage = nextMessage;
  }
  renderStatus();
}

function clearStatus(options = {}) {
  const { persistent = false } = options;
  if (persistent) {
    persistentStatusMessage = "";
  } else {
    transientStatusMessage = "";
  }
  renderStatus();
}

function hideStatus() {
  clearStatus();
}

function setMapboxBrandingVisible(isVisible) {
  if (elements.mapboxWordmark) {
    elements.mapboxWordmark.hidden = !isVisible;
  }
}

function normalizeStyleId(value, fallback) {
  return isNonEmptyString(value) ? value.trim() : fallback;
}

function validateMapConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(MAPBOX_CONFIG_ERROR_MESSAGE);
  }

  const token = isNonEmptyString(config.mapboxAccessToken) ? config.mapboxAccessToken.trim() : "";
  if (!token || token.includes("YOUR_PUBLIC_TOKEN_HERE") || !token.startsWith("pk.")) {
    throw new Error(MAPBOX_CONFIG_ERROR_MESSAGE);
  }

  const rawStyles = config.basemapStyles;
  if (rawStyles != null && (typeof rawStyles !== "object" || Array.isArray(rawStyles))) {
    throw new Error(MAPBOX_CONFIG_ERROR_MESSAGE);
  }
  if (rawStyles?.light != null && !isNonEmptyString(rawStyles.light)) {
    throw new Error(MAPBOX_CONFIG_ERROR_MESSAGE);
  }
  if (rawStyles?.dark != null && !isNonEmptyString(rawStyles.dark)) {
    throw new Error(MAPBOX_CONFIG_ERROR_MESSAGE);
  }

  return {
    mapboxAccessToken: token,
    basemapStyles: {
      light: normalizeStyleId(rawStyles?.light, DEFAULT_BASEMAP_STYLES.light),
      dark: normalizeStyleId(rawStyles?.dark, DEFAULT_BASEMAP_STYLES.dark),
    },
  };
}

async function loadMapConfig() {
  let response;
  try {
    response = await fetch(MAP_CONFIG_PATH, { cache: "no-store" });
  } catch {
    throw new Error(MAPBOX_CONFIG_ERROR_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(MAPBOX_CONFIG_ERROR_MESSAGE);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(MAPBOX_CONFIG_ERROR_MESSAGE);
  }

  return validateMapConfig(payload);
}

function createMapboxTileUrl(styleId, token) {
  const encodedStyleId = String(styleId)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const params = new URLSearchParams({ access_token: token });
  return `https://api.mapbox.com/styles/v1/${encodedStyleId}/tiles/256/{z}/{x}/{y}?${params.toString()}`;
}

function getThemeMapProfile(theme = themeState.mode) {
  return THEME_MAP_PROFILES[theme] || THEME_MAP_PROFILES.light;
}

function applyMapTileFilter(theme = themeState.mode) {
  const tilePane = map.getPane("tilePane");
  if (!tilePane) {
    return;
  }
  tilePane.style.filter = getThemeMapProfile(theme).tileFilter;
}

function createBaseTileLayer(theme) {
  if (!basemapConfig) {
    return null;
  }

  const styleId = basemapConfig.basemapStyles[theme] || basemapConfig.basemapStyles.light;
  const layer = L.tileLayer(createMapboxTileUrl(styleId, basemapConfig.mapboxAccessToken), {
    attribution: MAPBOX_ATTRIBUTION,
    maxZoom: 19,
  });

  layer.on("tileerror", () => {
    if (baseTileLayer !== layer) {
      return;
    }
    showStatus(MAPBOX_TILE_ERROR_MESSAGE, { persistent: true });
  });
  layer.on("load", () => {
    if (baseTileLayer !== layer || persistentStatusMessage !== MAPBOX_TILE_ERROR_MESSAGE) {
      return;
    }
    clearStatus({ persistent: true });
  });

  return layer;
}

function updateBaseLayer(theme) {
  const nextLayer = createBaseTileLayer(theme);
  if (!nextLayer) {
    applyMapTileFilter(theme);
    return;
  }
  if (baseTileLayer) {
    map.removeLayer(baseTileLayer);
  }
  baseTileLayer = nextLayer;
  baseTileLayer.addTo(map);
  applyMapTileFilter(theme);
}

function syncThemeUi() {
  if (elements.themeToggle) {
    elements.themeToggle.checked = themeState.mode === "dark";
  }
  if (elements.themeToggleNote) {
    const label = themeState.mode === "dark" ? "Dark" : "Light";
    elements.themeToggleNote.textContent =
      themeState.source === "manual"
        ? `Manual override active. ${label} mode is locked in.`
        : `Following your device setting. ${label} mode is active.`;
  }
  if (elements.themeReset) {
    elements.themeReset.hidden = themeState.source !== "manual";
  }
}

function setThemeTarget(target, theme, source) {
  if (!target) {
    return;
  }
  target.dataset.theme = theme;
  target.dataset.themeSource = source;
  target.dataset.colorMode = theme;
  target.dataset.darkMode = String(theme === "dark");
  target.style.colorScheme = theme;
  target.classList.toggle("theme-light", theme === "light");
  target.classList.toggle("theme-dark", theme === "dark");
  target.classList.toggle("light", theme === "light");
  target.classList.toggle("dark", theme === "dark");
  target.classList.toggle("color-mode-light", theme === "light");
  target.classList.toggle("color-mode-dark", theme === "dark");
}

function setThemeRoot(theme, source) {
  setThemeTarget(rootElement, theme, source);
  setThemeTarget(bodyElement, theme, source);
}

function applyTheme(theme, source = themeState.source) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  const nextSource = source === "manual" ? "manual" : "system";
  themeState.mode = nextTheme;
  themeState.source = nextSource;
  setThemeRoot(nextTheme, nextSource);
  updateThemeMeta(nextTheme);
  updateBaseLayer(nextTheme);
  applyMapTileFilter(nextTheme);
  syncThemeUi();
}

function persistThemePreference(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
  applyTheme(theme, "manual");
}

function resetThemePreference() {
  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {}
  applyTheme(getSystemTheme(), "system");
}

applyTheme(themeState.mode, themeState.source);

const handleSystemThemeChange = (event) => {
  if (themeState.source !== "manual") {
    applyTheme(event.matches ? "dark" : "light", "system");
  }
};

if (typeof systemThemeMediaQuery.addEventListener === "function") {
  systemThemeMediaQuery.addEventListener("change", handleSystemThemeChange);
} else if (typeof systemThemeMediaQuery.addListener === "function") {
  systemThemeMediaQuery.addListener(handleSystemThemeChange);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function formatDecimal(value, fractionDigits = 1) {
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatPercent(value, fractionDigits = 1) {
  return new Intl.NumberFormat("en-GB", {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
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

function formatPercentileStats(stats, order, formatHint = 0) {
  return order
    .map((label) => {
      const value = stats[label] ?? 0;
      let formatted;
      if (typeof formatHint === "string") {
        formatted = formatMetricValue(value, formatHint, 1);
      } else {
        formatted = formatHint > 0 ? Number(value).toFixed(formatHint) : formatNumber(Math.round(value));
      }
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

function getHeatRadius(heatWeight, zoom, themeProfile = getThemeMapProfile()) {
  const zoomDelta = zoom - DEFAULT_ZOOM;
  const baseRadius =
    HEAT_BLOB_OPTIONS.minRadius +
    (HEAT_BLOB_OPTIONS.maxRadius - HEAT_BLOB_OPTIONS.minRadius) * clamp(heatWeight ** 1.08);
  const scaledRadius =
    (baseRadius + Math.max(0, zoomDelta) * HEAT_BLOB_OPTIONS.zoomRadiusBoost) *
    themeProfile.heatRadiusScale;
  return Math.round(
    clamp(
      scaledRadius,
      Math.max(10, HEAT_BLOB_OPTIONS.minRadius * 0.8),
      HEAT_BLOB_OPTIONS.maxRadius + 24
    )
  );
}

function getHeatOpacity(heatWeight, themeProfile = getThemeMapProfile()) {
  const baseOpacity =
    HEAT_BLOB_OPTIONS.minOpacity +
    (HEAT_BLOB_OPTIONS.maxOpacity - HEAT_BLOB_OPTIONS.minOpacity) * clamp(heatWeight ** 0.96);
  return clamp(baseOpacity * themeProfile.heatOpacityScale, 0.05, 1);
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

function createMarkerColorStyle(colorPercent, themeProfile = getThemeMapProfile()) {
  const fillColor = interpolateRampColor(colorPercent, MARKER_COLOR_RAMP);
  const strokeColor = mixHexColors(fillColor, MARKER_OUTLINE_COLOR, themeProfile.markerOutlineMix);
  const fillOpacity = clamp(
    interpolateStopValue(colorPercent, MARKER_OPACITY_STOPS) + themeProfile.markerOpacityBoost,
    0,
    0.82
  );
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

function getDensity(feature) {
  const density = Number(feature.properties.fines_per_mile);
  return Number.isFinite(density) ? density : null;
}

function getMetricMode() {
  return elements.metricMode?.value === METRIC_MODES.density ? METRIC_MODES.density : METRIC_MODES.total;
}

function getMetricLabel(metricMode) {
  return METRIC_LABELS[metricMode] || METRIC_LABELS[METRIC_MODES.total];
}

function getMetricValue(feature, metricMode) {
  if (metricMode === METRIC_MODES.density) {
    return getDensity(feature);
  }
  return getCount(feature);
}

function isMetricEligible(feature, metricMode) {
  if (metricMode === METRIC_MODES.density) {
    return Number.isFinite(getDensity(feature));
  }
  return true;
}

function formatMetricValue(value, metricMode, fractionDigits = 1) {
  if (metricMode === METRIC_MODES.density) {
    return formatDecimal(value, fractionDigits);
  }
  return formatNumber(Math.round(value));
}

function getFeatureKey(feature) {
  return feature.properties.cache_key || feature.properties.display_name;
}

function isManualOverride(feature) {
  return feature.properties.geocode_status === MANUAL_OVERRIDE_STATUS;
}

function formatColorModeLabel(transformMode) {
  return COLOR_TRANSFORM_LABELS[transformMode] || "logarithmic";
}

function syncTopFilterLabels(metricMode) {
  if (!elements.topFilter) {
    return;
  }
  const metricSuffix = metricMode === METRIC_MODES.density ? "density" : "count";
  const labels = {
    top200: `Top 200 by ${metricSuffix}`,
    top100: `Top 100 by ${metricSuffix}`,
    top50: `Top 50 by ${metricSuffix}`,
    all: "All streets",
  };
  for (const [value, label] of Object.entries(labels)) {
    const option = elements.topFilter.querySelector(`option[value="${value}"]`);
    if (option) {
      option.textContent = label;
    }
  }
}

function selectMedianColorSamples(scaledPoints, sampleSize = 5) {
  const sorted = [...scaledPoints].sort((a, b) => a.metricValue - b.metricValue);
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
    street: getFeatureLabel(point.feature),
    metricValue: Number(point.metricValue.toFixed(4)),
    colorPercent: Number(point.colorPercent.toFixed(4)),
    fillColor: point.fillColor,
    fillOpacity: Number(point.fillOpacity.toFixed(2)),
  }));
}

function applyTopMetricFilter(features, mode, metricMode) {
  const limit = TOP_FILTER_LIMITS[mode] ?? Infinity;
  if (!Number.isFinite(limit) || limit === Infinity || features.length <= limit) {
    return features;
  }
  const sorted = [...features].sort((a, b) => {
    const difference = (getMetricValue(b, metricMode) ?? -Infinity) - (getMetricValue(a, metricMode) ?? -Infinity);
    if (difference !== 0) {
      return difference;
    }
    return getFeatureLabel(a).localeCompare(getFeatureLabel(b));
  });
  return sorted.slice(0, limit);
}

function matchesSearch(feature, term) {
  if (!term) {
    return true;
  }
  const haystacks = [
    feature.properties.display_name,
    feature.properties.display_label,
    feature.properties.area,
    ...(feature.properties.aliases || []),
  ]
    .join(" ")
    .toLowerCase();
  return haystacks.includes(term);
}

function logHeatSummary(topFilterMode, metricMode, scaledPoints, stats) {
  const topStreets = [...scaledPoints]
    .sort((a, b) => b.metricValue - a.metricValue)
    .slice(0, 25)
    .map((point) => ({
      street: getFeatureLabel(point.feature),
      metricValue: Number(point.metricValue.toFixed(4)),
      weight: Number(point.weight.toFixed(4)),
      radius: Number(point.radius.toFixed(2)),
      fillColor: point.fillColor,
      fillOpacity: Number(point.fillOpacity.toFixed(2)),
    }));
  const topColorSamples = buildColorSampleRows(
    [...scaledPoints].sort((a, b) => b.metricValue - a.metricValue).slice(0, 10)
  );
  const medianColorSamples = buildColorSampleRows(selectMedianColorSamples(scaledPoints));

  console.groupCollapsed(
    `[heat] metric=${metricMode} filter=${topFilterMode} points=${scaledPoints.length}`
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
    `${getMetricLabel(metricMode)} percentiles:`,
    formatPercentileStats(stats.metricPercentiles, Object.keys(COUNT_PERCENTILES), metricMode)
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
    "Marker colour focus:",
    formatPercentileStats(stats.metricPercentiles, Object.keys(COLOR_DEBUG_PERCENTILES), metricMode)
  );
  if (topFilterMode === "top50") {
    console.log(
      "Top 50 metric focus:",
      formatPercentileStats(stats.metricPercentiles, Object.keys(DEBUG_FOCUS_PERCENTILES), metricMode)
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

function assignOverallRanks(features) {
  const rankedFeatures = dedupeByCacheKey(features).sort((left, right) => {
    const countDifference = getCount(right) - getCount(left);
    if (countDifference !== 0) {
      return countDifference;
    }
    return getFeatureLabel(left).localeCompare(getFeatureLabel(right));
  });
  const totalFineCount = rankedFeatures.reduce((sum, feature) => sum + getCount(feature), 0);

  const metricsByKey = new Map(
    rankedFeatures.map((feature, index) => [
      getFeatureKey(feature),
      {
        overallRank: index + 1,
        pcnsPerDay: getCount(feature) / DATASET_DAY_COUNT,
        shareOfTotal: totalFineCount > 0 ? getCount(feature) / totalFineCount : 0,
      },
    ])
  );

  for (const feature of features) {
    const metrics = metricsByKey.get(getFeatureKey(feature));
    feature.properties.overall_rank = metrics?.overallRank ?? null;
    feature.properties.pcns_per_day = metrics?.pcnsPerDay ?? 0;
    feature.properties.share_of_total = metrics?.shareOfTotal ?? 0;
  }
}

function assignDensityRanks(features) {
  const rankedFeatures = dedupeByCacheKey(features)
    .filter((feature) => Number.isFinite(getDensity(feature)))
    .sort((left, right) => {
      const densityDifference = (getDensity(right) ?? 0) - (getDensity(left) ?? 0);
      if (densityDifference !== 0) {
        return densityDifference;
      }
      return getFeatureLabel(left).localeCompare(getFeatureLabel(right));
    });

  const ranksByKey = new Map(rankedFeatures.map((feature, index) => [getFeatureKey(feature), index + 1]));

  for (const feature of features) {
    feature.properties.density_rank = ranksByKey.get(getFeatureKey(feature)) ?? null;
  }
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

function computeScalingContext(features, topFilterMode, weightMode, metricMode) {
  const metricValues = features
    .map((feature) => getMetricValue(feature, metricMode))
    .filter((value) => Number.isFinite(value));
  const metricPercentiles = describePercentiles(metricValues, COUNT_PERCENTILES);
  const stopConfig = getStopConfig(topFilterMode);
  const heatAnchors = buildOutputAnchors(metricPercentiles, stopConfig.heatStops);
  const markerAnchors = buildOutputAnchors(metricPercentiles, stopConfig.markerStops);
  const colorCapLabel = getColorCapLabel(topFilterMode);
  const colorCapCount = Math.max(1, metricPercentiles[colorCapLabel] || metricPercentiles.max || 1);
  const colorTransformMode = getColorTransformMode(weightMode);
  return {
    metricPercentiles,
    heatAnchors,
    markerAnchors,
    colorCapLabel,
    colorCapCount,
    colorTransformMode,
    metricMode,
  };
}

function buildScaledPoints(features, scalingContext, metricMode) {
  if (!features.length) {
    return {
      scaledPoints: [],
      stats: {
        metricPercentiles: describePercentiles([], COUNT_PERCENTILES),
        heatAnchors: [],
        markerAnchors: [],
        colorCapLabel: "p99",
        colorCapCount: 0,
        colorTransformMode: "log",
        weightPercentiles: describePercentiles([], WEIGHT_PERCENTILES),
        radiusPercentiles: describePercentiles([], RADIUS_PERCENTILES),
        metricMode,
      },
    };
  }

  const themeProfile = getThemeMapProfile();
  const scaledPoints = features.map((feature) => {
    const metricValue = getMetricValue(feature, metricMode) ?? 0;
    const heatStrength = interpolateAnchors(metricValue, scalingContext.heatAnchors);
    const weight = boostHeatWeight(heatStrength);
    const markerStrength = interpolateAnchors(metricValue, scalingContext.markerAnchors);
    const radius = computeMarkerRadius(markerStrength);
    const colorPercent = computeColorPercent(metricValue, {
      capCount: scalingContext.colorCapCount,
      transformMode: scalingContext.colorTransformMode,
    });
    const markerColorStyle = createMarkerColorStyle(colorPercent, themeProfile);
    const [lon, lat] = feature.geometry.coordinates;
    return {
      feature,
      lat,
      lon,
      metricValue,
      weight,
      heatRadius: getHeatRadius(weight, map.getZoom(), themeProfile),
      heatOpacity: getHeatOpacity(weight, themeProfile),
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
      metricPercentiles: scalingContext.metricPercentiles,
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
      metricMode,
    },
  };
}

function popupHtml(feature, metricMode) {
  const {
    display_name: displayName,
    display_label: displayLabel,
    area,
    count_total: countTotal,
    overall_rank: overallRank,
    density_rank: densityRank,
    pcns_per_day: pcnsPerDay,
    street_length_miles: streetLengthMiles,
    fines_per_mile: finesPerMile,
    aliases,
    geocode_status: geocodeStatus,
  } = feature.properties;
  const activeRank = metricMode === METRIC_MODES.density ? densityRank : overallRank;
  const rankLabel = metricMode === METRIC_MODES.density ? "Density rank" : "Overall rank";
  const rankHtml = Number.isFinite(activeRank)
    ? `<p>${rankLabel}: <strong>#${formatNumber(activeRank)}</strong></p>`
    : "";
  const perDayHtml = Number.isFinite(pcnsPerDay) ? `<p>~ ${formatDecimal(pcnsPerDay)} per day</p>` : "";
  const aliasHtml =
    aliases.length > 1
      ? `<p class="aliases">Aliases: ${aliases.map((alias) => escapeHtml(alias)).join(", ")}</p>`
      : "";
  const statusHtml =
    geocodeStatus === MANUAL_OVERRIDE_STATUS
      ? '<p class="marker-style"><strong>Manual override</strong></p>'
      : "";
  const hasLengthMetrics =
    Number.isFinite(streetLengthMiles) &&
    streetLengthMiles > 0 &&
    Number.isFinite(finesPerMile) &&
    finesPerMile >= 0;
  const lengthHtml = hasLengthMetrics
    ? `<p>Length: <strong>${formatDecimal(streetLengthMiles, 2)} mi</strong> · ${formatDecimal(
        finesPerMile,
        1
      )} fines/mi</p>`
    : "";
  const areaHtml = area ? `<p>Authority: <strong>${escapeHtml(area)}</strong></p>` : "";

  return `
    <div class="popup-content">
      <h3>${escapeHtml(displayLabel || displayName)}</h3>
      ${areaHtml}
      <p><strong>${formatNumber(countTotal)}</strong> fines</p>
      ${rankHtml}
      ${perDayHtml}
      ${lengthHtml}
      ${statusHtml}
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

function updateLeagueTable(features, metricMode, limit = 10) {
  if (!elements.leagueTable) {
    return;
  }

  const rankedRows = dedupeByCacheKey(features)
    .filter((feature) => {
      if (metricMode === METRIC_MODES.density) {
        return isMetricEligible(feature, metricMode);
      }
      return getCount(feature) > 0;
    })
    .sort((left, right) => {
      const metricDifference =
        (getMetricValue(right, metricMode) ?? -Infinity) - (getMetricValue(left, metricMode) ?? -Infinity);
      if (metricDifference !== 0) {
        return metricDifference;
      }
      return (left.properties.display_label || left.properties.display_name).localeCompare(
        right.properties.display_label || right.properties.display_name
      );
    })
    .slice(0, limit);

  if (elements.leagueTableMeta) {
    if (metricMode === METRIC_MODES.density) {
      elements.leagueTableMeta.textContent = "TOP 10 STREETS–DENSITY";
    } else {
      const topTenShare = rankedRows.reduce(
        (sum, feature) => sum + (feature.properties.share_of_total || 0),
        0
      );
      elements.leagueTableMeta.textContent = `TOP 10 STREETS–${formatPercent(topTenShare)}`;
    }
  }

  const rows = rankedRows.map((feature, index) => {
    const pcnsPerDay = feature.properties.pcns_per_day;
    const shareOfTotal = feature.properties.share_of_total;
    const density = getDensity(feature);
    const secondaryMeta =
      metricMode === METRIC_MODES.density
        ? `${formatDecimal(density ?? 0, 1)} fines/mi`
        : `${formatPercent(shareOfTotal)} of total`;
    return `
      <li class="league-row">
        <span class="league-rank">#${formatNumber(index + 1)}</span>
        <div class="league-main">
          <span class="league-street">${escapeHtml(
            feature.properties.display_label || feature.properties.display_name
          )}</span>
          <span class="league-meta">
            <span>${formatDecimal(pcnsPerDay)} per day</span>
            <span>${secondaryMeta}</span>
          </span>
        </div>
        <span class="league-count">${formatNumber(getCount(feature))} fines</span>
      </li>
    `;
  });

  elements.leagueTable.innerHTML = rows.join("");
}

function buildMarkerLayer(scaledPoints, metricMode) {
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
    marker.bindPopup(popupHtml(point.feature, metricMode));
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

function updateLegend(stats, metricMode) {
  const themeProfile = getThemeMapProfile();
  if (elements.legendBar) {
    elements.legendBar.style.background = buildLegendGradient(MARKER_COLOR_RAMP);
  }
  if (elements.legendTicks) {
    const tickSpecs = [
      { label: "0", value: 0 },
      { label: "P50", value: stats.metricPercentiles.p50 || 0 },
      { label: "P75", value: stats.metricPercentiles.p75 || 0 },
      { label: "P90", value: stats.metricPercentiles.p90 || 0 },
      { label: stats.colorCapLabel.toUpperCase(), value: stats.colorCapCount || 0 },
    ];
    elements.legendTicks.innerHTML = tickSpecs
      .map((tick) => {
        const colorPercent = computeColorPercent(tick.value, {
          capCount: stats.colorCapCount,
          transformMode: stats.colorTransformMode,
        });
        const markerColorStyle = createMarkerColorStyle(colorPercent, themeProfile);
        return `
          <div class="legend-tick">
            <span class="legend-swatch" style="background:${markerColorStyle.fillColor}; border-color:${markerColorStyle.strokeColor}; opacity:${markerColorStyle.fillOpacity};"></span>
            <span class="legend-tick-label">${tick.label}</span>
            <span class="legend-tick-value">${formatMetricValue(tick.value, metricMode, 1)}</span>
          </div>
        `;
      })
      .join("");
  }
  const capLabelSuffix = metricMode === METRIC_MODES.density ? " density cap" : " cap";
  elements.legendMode.textContent = `marker colour · ${getMetricLabel(metricMode)} · ${formatColorModeLabel(
    stats.colorTransformMode
  )} scale / ${stats.colorCapLabel}${capLabelSuffix}`;
}

function buildHeatLayer(features, topFilterMode, scalingContext, metricMode) {
  const { scaledPoints, stats } = buildScaledPoints(features, scalingContext, metricMode);
  if (DEBUG_SHOW_WEIGHTS) {
    logHeatSummary(topFilterMode, metricMode, scaledPoints, stats);
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

function getFeatureLabel(feature) {
  return feature?.properties?.display_label || feature?.properties?.display_name || "";
}

function applyFilters(summary) {
  const showZeroes = elements.toggleZeroes.checked;
  const searchTerm = elements.searchInput.value.trim().toLowerCase();
  const weightMode = elements.weightMode.value;
  const topFilterMode = elements.topFilter.value;
  const metricMode = getMetricMode();
  syncTopFilterLabels(metricMode);

  const baseFiltered = allFeatures.filter((feature) => {
    const isVisibleZero = showZeroes || !feature.properties.is_zero_count;
    return isVisibleZero;
  });
  const metricEligible = baseFiltered.filter((feature) => isMetricEligible(feature, metricMode));
  const topFiltered = applyTopMetricFilter(metricEligible, topFilterMode, metricMode);
  visibleFeatures = topFiltered.filter((feature) => matchesSearch(feature, searchTerm));

  if (metricMode === METRIC_MODES.density && visibleFeatures.length === 0) {
    showStatus("No streets with fines-per-mile are available for the current filters.");
  } else {
    clearStatus();
  }

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
  const scalingContext = computeScalingContext(heatFeatures, topFilterMode, weightMode, metricMode);
  const heatResult = buildHeatLayer(heatFeatures, topFilterMode, scalingContext, metricMode);
  markerLayer = buildMarkerLayer(heatResult.scaledPoints, metricMode);
  heatLayer = heatResult.layer;

  if (heatLayer && elements.toggleHeat.checked && heatResult.scaledPoints.length > 0) {
    heatLayer.addTo(map);
  }

  updateMarkerVisibility();
  focusVisibleFeatures(
    visibleFeatures,
    searchTerm,
    `${metricMode}|${topFilterMode}|${showZeroes ? "zeroes" : "nonzero"}|${searchTerm}`
  );
  updateLegend(heatResult.stats, metricMode);
  updateLeagueTable(allFeatures, metricMode);
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
  showStatus("Loading Mapbox configuration…");

  try {
    basemapConfig = await loadMapConfig();
    setMapboxBrandingVisible(true);
    updateBaseLayer(themeState.mode);
    applyMapTileFilter(themeState.mode);

    showStatus("Loading prepared map data…");
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
    assignOverallRanks(allFeatures);
    assignDensityRanks(allFeatures);
    syncTopFilterLabels(getMetricMode());
    updateLeagueTable(allFeatures, getMetricMode());
    setDefaultBounds(allFeatures);
    applyFilters(summary);

    elements.themeToggle.addEventListener("change", () => {
      persistThemePreference(elements.themeToggle.checked ? "dark" : "light");
    });
    elements.themeReset.addEventListener("click", () => {
      resetThemePreference();
    });
    elements.searchInput.addEventListener("input", () => applyFilters(summary));
    elements.weightMode.addEventListener("change", () => applyFilters(summary));
    elements.topFilter.addEventListener("change", () => applyFilters(summary));
    elements.metricMode.addEventListener("change", () => applyFilters(summary));
    elements.toggleHeat.addEventListener("change", () => applyFilters(summary));
    elements.toggleMarkers.addEventListener("change", () => updateMarkerVisibility());
    elements.toggleZeroes.addEventListener("change", () => applyFilters(summary));
    elements.resetView.addEventListener("click", () => {
      elements.searchInput.value = "";
      elements.weightMode.value = "log";
      elements.topFilter.value = "top200";
      elements.metricMode.value = METRIC_MODES.total;
      elements.toggleHeat.checked = true;
      elements.toggleMarkers.checked = true;
      elements.toggleZeroes.checked = false;
      syncTopFilterLabels(getMetricMode());
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
    showStatus(toStatusMessage(error, MAPBOX_CONFIG_ERROR_MESSAGE), { persistent: true });
    console.error(error);
  }
}

init();
