#!/usr/bin/env python3
"""Build GeoJSON and summary outputs from normalized streets and cached geocodes."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
NORMALIZED_JSON = REPO_ROOT / "data" / "build" / "normalized_streets.json"
CACHE_JSON = REPO_ROOT / "data" / "cache" / "geocode-cache.json"
MANUAL_OVERRIDES_JSON = REPO_ROOT / "data" / "manual-overrides.json"
GEOJSON_OUTPUT = REPO_ROOT / "data" / "build" / "streets.geojson"
SUMMARY_OUTPUT = REPO_ROOT / "data" / "build" / "summary.json"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> None:
    normalized = load_json(NORMALIZED_JSON)
    cache = load_json(CACHE_JSON) if CACHE_JSON.exists() else {"entries": {}}
    manual_overrides = load_json(MANUAL_OVERRIDES_JSON) if MANUAL_OVERRIDES_JSON.exists() else {}

    features = []
    failed_geocode_count = 0
    geocoded_success_count = 0

    for street in normalized["streets"]:
        cache_key = street["cache_key"]
        entry = cache["entries"].get(cache_key)

        if cache_key in manual_overrides:
            override = manual_overrides[cache_key]
            status = "manual_override"
            lat = float(override["lat"])
            lon = float(override["lon"])
        elif entry and entry.get("status") in {"ok", "manual_override"}:
            status = str(entry["status"])
            lat = float(entry["lat"])
            lon = float(entry["lon"])
        else:
            if entry and entry.get("status") in {"not_found", "ambiguous", "error"}:
                failed_geocode_count += 1
            continue

        geocoded_success_count += 1
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat],
                },
                "properties": {
                    "cache_key": cache_key,
                    "display_name": street["display_name"],
                    "aliases": street["aliases"],
                    "count_total": street["count_total"],
                    "source_rows": street["source_rows"],
                    "is_zero_count": street["is_zero_count"],
                    "has_zero_count_variant": street["has_zero_count_variant"],
                    "geocode_status": status,
                },
            }
        )

    features.sort(key=lambda feature: feature["properties"]["count_total"], reverse=True)

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    summary = {
        "source_row_count": normalized["source_row_count"],
        "normalized_street_count": normalized["normalized_street_count"],
        "geocoded_success_count": geocoded_success_count,
        "failed_geocode_count": failed_geocode_count,
        "zero_count_feature_count": sum(1 for feature in features if feature["properties"]["is_zero_count"]),
        "duplicate_groups_resolved": normalized["duplicate_groups_resolved"],
        "last_build_at": utc_now_iso(),
    }

    GEOJSON_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with GEOJSON_OUTPUT.open("w", encoding="utf-8") as handle:
        json.dump(geojson, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    with SUMMARY_OUTPUT.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
