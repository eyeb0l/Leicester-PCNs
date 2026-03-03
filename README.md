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

- Leaflet heat intensities are normalized per filter run with the default "Power" mapping (γ = 2.2) using the p99 count as the cap so the top streets dominate while mid/low streets fall off quickly.
- The "Streets shown" control lets you restrict rendering to the top 200/100/50 streets by count for diagnostics; the default shows all available streets.
- Circle marker radii reuse the same p99 cap and γ = 2.2 exponent so both the heat layer and markers highlight the same hotspots. Weights below `0.08` are zeroed before rendering to prevent faint blobs.
- Flip `DEBUG_SHOW_WEIGHTS` in `app.js` to inspect min/p25/p50/p75/p90/p95/p99/max stats plus the top streets and verify the distribution if the map ever looks off.

## Debug snapshot

Captured with `node scripts/debug_snapshot.js` (which mirrors the `DEBUG_SHOW_WEIGHTS` output) using the current dataset:

```
Scenario: All streets
Streets visualized: 1169
Count percentiles: min:1 · p25:6 · p50:26 · p75:96 · p90:282 · p95:447 · p99:972 · max:5041
Weight percentiles: min:0.0000 · p25:0.0000 · p50:0.0000 · p75:0.0000 · p90:0.0000 · p95:0.1811 · p99:1.0000 · max:1.0000
Marker radius percentiles: min:2.00 · p50:2.01 · p90:3.05 · p99:18.00 · max:18.00
┌─────────┬────────────────────────┬───────┬────────┬────────┐
│ (index) │ street                 │ count │ weight │ radius │
├─────────┼────────────────────────┼───────┼────────┼────────┤
│ 0       │ London Road            │ 5041  │ 1      │ 18     │
│ 1       │ Western Road           │ 2612  │ 1      │ 18     │
│ 2       │ Bowling Green Street   │ 1849  │ 1      │ 18     │
│ 3       │ Wellington Street      │ 1742  │ 1      │ 18     │
│ 4       │ Granby Street          │ 1618  │ 1      │ 18     │
│ …       │ …                      │ …     │ …      │ …      │
│ 24      │ The Newarke            │ 688   │ 0.4676 │ 9.48   │
└─────────┴────────────────────────┴───────┴────────┴────────┘

Scenario: Top 50 streets
Streets visualized: 50
Count percentiles: min:504 · p25:573 · p50:688 · p75:972 · p90:1610 · p95:1849 · p99:5041 · max:5041
Weight percentiles: min:0.0000 · p25:0.0000 · p50:0.0000 · p75:0.0000 · p90:0.0812 · p95:0.1101 · p99:1.0000 · max:1.0000
Marker radius percentiles: min:2.10 · p50:2.20 · p90:3.30 · p99:18.00 · max:18.00
┌─────────┬────────────────────────┬───────┬────────┬────────┐
│ (index) │ street                 │ count │ weight │ radius │
├─────────┼────────────────────────┼───────┼────────┼────────┤
│ 0       │ London Road            │ 5041  │ 1      │ 18     │
│ 1       │ Western Road           │ 2612  │ 0.2354 │ 5.77   │
│ 2       │ Bowling Green Street   │ 1849  │ 0.1101 │ 3.76   │
│ 3       │ Wellington Street      │ 1742  │ 0.0966 │ 3.54   │
│ 4       │ Granby Street          │ 1618  │ 0.0821 │ 3.31   │
│ …       │ …                      │ …     │ …      │ …      │
│ 24      │ The Newarke            │ 688   │ 0      │ 2.20   │
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
