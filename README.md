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
- `data/manual-overrides.json`: manual lat/lon fixes that override cached API results
- `data/build/streets.geojson`: final map-ready point dataset
- `data/build/summary.json`: build summary used by the browser UI

## Data rules

- Expected CSV columns: `Street/Location`, `City/Area`, `Count`
- Street names are normalized using Unicode `NFKC`, whitespace collapsing, and trailing period stripping
- Deduping is exact after normalization only; there is no fuzzy matching
- Count values are parsed with `float()` and accepted only when they represent a whole number (e.g., `11.` → `11`)
- Manual overrides always take precedence over geocoder responses
- Failed geocodes are cached and not retried unless you delete them or rerun with `--retry-errors`

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
python3 -m pip install --user geopy
python3 scripts/prepare_data.py
python3 scripts/geocode_streets.py --progress --retry-errors
python3 scripts/build_geojson.py
python3 -m http.server
```

Then open [http://localhost:8000](http://localhost:8000).

## Heatmap tuning

- Leaflet heat intensities are normalized per filter run using percentile-anchored interpolation, not direct max-based or cap-based normalization.
- The "Streets shown" control lets you restrict rendering to the top 200/100/50 streets by count for diagnostics; the default shows all available streets.
- In `all` mode, the heat layer and markers use wider percentile stop curves so outliers like London Road remain visually dominant while 500-1200 streets stay clearly smaller.
- In Top-N modes, the app uses a different percentile stop curve on the sliced dataset so the upper half remains legible instead of collapsing toward the floor.
- Circle markers still render in the `2-60px` range, but marker size now comes from percentile anchors rather than a single clipped cap.
- No heat or marker values are dropped to zero via a rendering threshold; use the Top-N filter to reduce clutter instead.
- Flip `DEBUG_SHOW_WEIGHTS` in `app.js` to inspect mapping anchors, count/weight percentiles, and the top streets for the current filter slice if the map ever looks off.

## Debug snapshot

Captured with `node scripts/debug_snapshot.js` (which mirrors the `DEBUG_SHOW_WEIGHTS` output) using the current dataset:

```
Scenario: All streets
Streets visualized: 1169
Heat mapping anchors: min:1->0.0200 · p50:26->0.0400 · p90:282->0.1800 · p95:447->0.3000 · p99:972->0.6500 · max:5041->1.0000
Marker mapping anchors: min:1->0.0100 · p50:26->0.0200 · p90:282->0.1000 · p95:447->0.1800 · p99:972->0.4500 · max:5041->1.0000
Count percentiles: min:1 · p25:6 · p50:26 · p75:96 · p90:282 · p95:447 · p99:972 · max:5041
Weight percentiles: min:0.0200 · p25:0.0240 · p50:0.0400 · p75:0.0783 · p90:0.1800 · p95:0.3000 · p99:0.6500 · max:1.0000
Marker radius percentiles: min:2.58 · p50:3.16 · p90:7.80 · p99:28.10 · max:60.00
┌─────────┬────────────────────────┬───────┬────────┬────────┐
│ (index) │ street                 │ count │ weight │ radius │
├─────────┼────────────────────────┼───────┼────────┼────────┤
│ 0       │ London Road            │ 5041  │ 1      │ 60     │
│ 1       │ Western Road           │ 2612  │ 0.7911 │ 40.96  │
│ 2       │ Bowling Green Street   │ 1849  │ 0.7254 │ 34.98  │
│ 3       │ Wellington Street      │ 1742  │ 0.7162 │ 34.14  │
│ 4       │ Granby Street          │ 1618  │ 0.7056 │ 33.16  │
│ …       │ …                      │ …     │ …      │ …      │
│ 24      │ The Newarke            │ 688   │ 0.4607 │ 19.63  │
└─────────┴────────────────────────┴───────┴────────┴────────┘

Scenario: Top 50 streets
Streets visualized: 50
Heat mapping anchors: min:504->0.1800 · p50:688->0.2800 · p90:1610->0.5500 · p95:1849->0.7200 · max:5041->1.0000
Marker mapping anchors: min:504->0.1400 · p50:688->0.2200 · p90:1610->0.4800 · p95:1849->0.6200 · max:5041->1.0000
Count percentiles: min:504 · p25:573 · p50:688 · p75:972 · p90:1610 · p95:1849 · p99:5041 · max:5041
Weight percentiles: min:0.1800 · p25:0.2175 · p50:0.2800 · p75:0.3632 · p90:0.5500 · p95:0.7200 · p99:1.0000 · max:1.0000
Marker radius percentiles: min:10.12 · p50:14.76 · p90:29.84 · p99:60.00 · max:60.00
Top 50 count focus: p50:688 · p90:1610 · p95:1849 · p99:5041 · max:5041
Top 50 weight focus: p50:0.2800 · p90:0.5500 · p95:0.7200 · p99:1.0000 · max:1.0000
┌─────────┬────────────────────────┬───────┬────────┬────────┐
│ (index) │ street                 │ count │ weight │ radius │
├─────────┼────────────────────────┼───────┼────────┼────────┤
│ 0       │ London Road            │ 5041  │ 1      │ 60     │
│ 1       │ Western Road           │ 2612  │ 0.7869 │ 43.23  │
│ 2       │ Bowling Green Street   │ 1849  │ 0.72   │ 37.96  │
│ 3       │ Wellington Street      │ 1742  │ 0.6439 │ 34.32  │
│ 4       │ Granby Street          │ 1618  │ 0.5557 │ 30.11  │
│ …       │ …                      │ …     │ …      │ …      │
│ 24      │ The Newarke            │ 688   │ 0.28   │ 14.76  │
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
