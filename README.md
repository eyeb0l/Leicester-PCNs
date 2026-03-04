# Leicester 2025 Parking Fines Heat Map

Static web app and Python preprocessing pipeline for mapping Leicester City Council parking fine counts by street in 2025.

- Source rows: 1,548
- Normalized streets: 1,546 (two duplicate groups resolved: `Atlas Close` vs `Atlas Close.` and `Brookland  Road` vs `Brookland Road`)
- Positive-count rows: 1,204 · Zero-count rows: 344 (hidden by default in the UI)
- Malformed `Count` value `11.` is coerced to integer 11 during parsing

## Project structure

- `data/source/leicester.csv`: tracked source CSV used by the build scripts
- `data/build/normalized_streets.json`: normalized street dataset emitted by `prepare_data.py`
- `data/cache/geocode-cache.json`: resumable geocode cache, including failures
- `data/cache/street-lengths.json`: street length cache derived from OSM/Overpass
- `data/manual-overrides.json`: manual lat/lon fixes that override cached API results
- `data/build/streets.geojson`: final map-ready point dataset
- `data/build/summary.json`: build summary used by the browser UI
- `map-config.example.json`: tracked template for the public Mapbox runtime config
- `map-config.json`: ignored runtime config loaded by the browser at startup

## Data rules

- Expected CSV columns: `Street/Location`, `City/Area`, `Count`
- Street names are normalized using Unicode `NFKC`, whitespace collapsing, and trailing period stripping
- Deduping is exact after normalization only; there is no fuzzy matching
- Count values are parsed with `float()` and accepted only when they represent a whole number (e.g., `11.` → `11`)
- Manual overrides always take precedence over geocoder responses
- Failed geocodes are cached and not retried unless you delete them or rerun with `--retry-errors`
- Street-length enrichment skips any car park/parking area and any manual-override location
- Popup length and fines-per-mile are hidden when street length cannot be derived

## Map providers

- Visible basemap: Mapbox Static Tiles (`mapbox/streets-v12` in light mode and `mapbox/dark-v11` in dark mode)
- Geocoding provider: Nominatim (OpenStreetMap)

## Runtime config

Copy the tracked example and add a public Mapbox token before serving the site:

```bash
cp map-config.example.json map-config.json
```

- Use a public `pk.` access token in `map-config.json`
- Restrict the token to `http://localhost:8000` and your deployed origin in the Mapbox dashboard
- Publish `map-config.json` alongside the rest of the static site assets in deployment
- Leave `mapbox/streets-v12` and `mapbox/dark-v11` in place unless you want to target different compatible style IDs
- The light theme intentionally uses a higher-contrast base map plus a lighter heat/marker treatment so labels and roads remain readable under the overlay.
- If your local `map-config.json` was copied before this change, it may still pin `mapbox/light-v11`; edit it manually or regenerate it to pick up the new default.

## Cloudflare Pages

For a GitHub-linked Cloudflare Pages deployment, do not commit `map-config.json`. Instead:

1. Add a Pages environment variable named `MAPBOX_PUBLIC_TOKEN` for both Preview and Production.
2. Set the build command to `node scripts/write-map-config.mjs`.
3. Set the build output directory to `.` so Pages publishes the repository root as static assets.

The script writes `map-config.json` at build time from the Pages environment variable, which keeps the token out of Git while still making the required public `pk.` token available to the browser.

- Production URL restrictions are straightforward: allow your production hostname and stable `pages.dev` hostname if you use it.
- Preview deployments usually get changing URLs. Use a separate preview token with looser restrictions if you want preview builds to keep working.
- If your build command also needs to regenerate data, prepend those steps before `node scripts/write-map-config.mjs`.
- Cloudflare Pages deployments will pick up the new `mapbox/streets-v12` light-style default automatically through [`scripts/write-map-config.mjs`](/Volumes/T7/Projects/Leicester-PCNs/scripts/write-map-config.mjs).

If you deploy from the terminal instead of a GitHub-triggered Pages build, use the same script first and then deploy the static output:

```bash
MAPBOX_PUBLIC_TOKEN=pk.your-token-here node scripts/write-map-config.mjs
wrangler pages deploy . --project-name pcn
```

This repo already publishes the repository root as static assets, which matches [`wrangler.jsonc`](/Volumes/T7/Projects/Leicester-PCNs/wrangler.jsonc).

### Preview token troubleshooting

If a Preview deployment loads the app shell but the basemap never appears, the usual cause is Mapbox token URL restrictions not matching the Preview hostname.

- Check the browser network panel for failed requests to `api.mapbox.com/styles/v1/...` with `401` or `403` responses.
- If Production works but Preview does not, your token is probably restricted to the production hostname only.
- The simplest fix is to use a separate Preview token in Cloudflare Pages with looser URL restrictions.
- If you want one token for both, include every hostname you actually serve from, including any stable `pages.dev` URL you use.
- The app will surface this failure as `Mapbox tiles failed to load. Check the token and its URL restrictions.`

## Geocoding behavior

- Provider: Nominatim (OpenStreetMap)
- Query format: `{display_name}, Leicester, UK`
- Rate limiting: handled by `geopy.extra.rate_limiter.RateLimiter` with a 1-second minimum delay and automatic retries
- Cache writes happen after every lookup so interrupted runs can resume safely
- `--max-records N` can be used for short test runs (default geocodes every uncached street)
- `--summary-only` prints cache stats without making requests

## Commands

```bash
cp /Users/irisgiertuga/Desktop/leicester.csv data/source/leicester.csv
cp map-config.example.json map-config.json
python3 -m pip install --user geopy
python3 scripts/prepare_data.py
python3 scripts/geocode_streets.py --progress --retry-errors
python3 scripts/build_street_lengths.py
python3 scripts/build_geojson.py
python3 -m http.server
```

Then open [http://localhost:8000](http://localhost:8000).

If you prefer to generate the config from an environment variable instead of editing the file manually:

```bash
MAPBOX_PUBLIC_TOKEN=pk.your-token-here node scripts/write-map-config.mjs
```

## Heatmap tuning

- Leaflet heat intensities and marker sizes are normalized per filter run using percentile anchors, while marker colour uses the selected scale transform.
- The `Map metric` control switches weighting between total fines and density (`fines_per_mile`).
- In density mode, streets without a finite `fines_per_mile` value are excluded from map rendering and ranking.
- The "Streets shown" control always ranks by the active metric (count in total mode, fines/mi in density mode); the default remains top 200.
- In `all` mode, the heat layer uses a steeper low-end curve than the markers so lower-count streets contribute much less background haze while outliers like London Road remain dominant.
- In Top-N modes, the app uses a different percentile stop curve on the sliced dataset so the upper half remains legible instead of collapsing toward the floor.
- Heat radius and blur now scale with zoom, and the rendered heat weights get an additional contrast boost so hotspots keep a readable footprint and stronger visual separation when you zoom in.
- Circle markers now render in the `2.5-75px` range, with size still driven by percentile anchors rather than a single clipped cap.
- No heat or marker values are dropped to zero via a rendering threshold; use the Top-N filter to reduce clutter instead.
- Flip `DEBUG_SHOW_WEIGHTS` in `app.js` to inspect mapping anchors, count/weight percentiles, and the top streets for the current filter slice if the map ever looks off.

## Debug snapshot

Captured with `node scripts/debug_snapshot.js` (which mirrors the `DEBUG_SHOW_WEIGHTS` output) using the current dataset:

```
Scenario: All streets
Streets visualized: 1193
Heat mapping anchors: min:1->0.0050 · p50:27->0.0180 · p75:97->0.0550 · p90:292->0.1600 · p95:452->0.3200 · p99:972->0.7200 · max:5041->1.0000
Marker mapping anchors: min:1->0.0100 · p50:27->0.0200 · p90:292->0.1000 · p95:452->0.1800 · p99:972->0.4500 · max:5041->1.0000
Count percentiles: min:1 · p25:6 · p50:27 · p75:97 · p90:292 · p95:452 · p99:972 · max:5041
Weight percentiles: min:0.0120 · p25:0.0120 · p50:0.0180 · p75:0.0396 · p90:0.1284 · p95:0.2791 · p99:0.6922 · max:1.0000
Marker radius percentiles: min:3.23 · p50:3.95 · p90:9.75 · p99:35.13 · max:75.00
┌─────────┬────────────────────────┬───────┬────────┬────────┐
│ (index) │ street                 │ count │ weight │ radius │
├─────────┼────────────────────────┼───────┼────────┼────────┤
│ 0       │ London Road            │ 5041  │ 1      │ 75     │
│ 1       │ Western Road           │ 2612  │ 0.8148 │ 51.2   │
│ 2       │ Bowling Green Street   │ 1849  │ 0.7575 │ 43.72  │
│ 3       │ Wellington Street      │ 1742  │ 0.7495 │ 42.67  │
│ 4       │ Granby Street          │ 1618  │ 0.7402 │ 41.46  │
│ …       │ …                      │ …     │ …      │ …      │
│ 24      │ Eastern Boulevard      │ 743   │ 0.5055 │ 26.5   │
└─────────┴────────────────────────┴───────┴────────┴────────┘

Scenario: Top 50 streets
Streets visualized: 50
Heat mapping anchors: min:505->0.0800 · p50:743->0.1800 · p75:972->0.3000 · p90:1610->0.5500 · p95:1849->0.7600 · max:5041->1.0000
Marker mapping anchors: min:505->0.1400 · p50:743->0.2200 · p90:1610->0.4800 · p95:1849->0.6200 · max:5041->1.0000
Count percentiles: min:505 · p25:582 · p50:743 · p75:972 · p90:1610 · p95:1849 · p99:5041 · max:5041
Weight percentiles: min:0.0576 · p25:0.0809 · p50:0.1465 · p75:0.2596 · p90:0.5119 · p95:0.7354 · p99:1.0000 · max:1.0000
Marker radius percentiles: min:12.65 · p50:18.45 · p90:37.30 · p99:75.00 · max:75.00
Top 50 count focus: p50:743 · p90:1610 · p95:1849 · p99:5041 · max:5041
Top 50 weight focus: p50:0.1465 · p90:0.5119 · p95:0.7354 · p99:1.0000 · max:1.0000
┌─────────┬────────────────────────┬───────┬────────┬────────┐
│ (index) │ street                 │ count │ weight │ radius │
├─────────┼────────────────────────┼───────┼────────┼────────┤
│ 0       │ London Road            │ 5041  │ 1      │ 75     │
│ 1       │ Western Road           │ 2612  │ 0.7978 │ 54.04  │
│ 2       │ Bowling Green Street   │ 1849  │ 0.7354 │ 47.45  │
│ 3       │ Wellington Street      │ 1742  │ 0.6343 │ 42.91  │
│ 4       │ Granby Street          │ 1618  │ 0.5193 │ 37.64  │
│ …       │ …                      │ …     │ …      │ …      │
│ 24      │ Eastern Boulevard      │ 743   │ 0.1465 │ 18.45  │
└─────────┴────────────────────────┴───────┴────────┴────────┘
```

## Manual fixes

Add verified coordinates to `data/manual-overrides.json`:

```json
{
  "example street|leicester|uk": {
    "lat": 52.6369,
    "lon": -1.1398,
    "reason": "Verified manually"
  }
}
```
