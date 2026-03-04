#!/usr/bin/env python3
"""Build GeoJSON and summary outputs from normalized streets and cached geocodes."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
NORMALIZED_JSON = REPO_ROOT / "data" / "build" / "normalized_streets.json"
CACHE_JSON = REPO_ROOT / "data" / "cache" / "geocode-cache.json"
MANUAL_OVERRIDES_JSON = REPO_ROOT / "data" / "manual-overrides.json"
STREET_LENGTHS_JSON = REPO_ROOT / "data" / "cache" / "street-lengths.json"
GEOJSON_OUTPUT = REPO_ROOT / "data" / "build" / "streets.geojson"
SUMMARY_OUTPUT = REPO_ROOT / "data" / "build" / "summary.json"
CAR_PARK_PATTERN = re.compile(r"\b(?:car\s*park|carpark|parking\s+area)\b", re.IGNORECASE)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def is_car_park(street: dict[str, Any]) -> bool:
    names = [street.get("display_name", ""), *(street.get("aliases") or [])]
    return any(CAR_PARK_PATTERN.search(str(name) or "") for name in names)


def to_finite_number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def main() -> None:
    normalized = load_json(NORMALIZED_JSON)
    cache = load_json(CACHE_JSON) if CACHE_JSON.exists() else {"entries": {}}
    manual_overrides = load_json(MANUAL_OVERRIDES_JSON) if MANUAL_OVERRIDES_JSON.exists() else {}
    street_lengths = load_json(STREET_LENGTHS_JSON) if STREET_LENGTHS_JSON.exists() else {"entries": {}}
    length_entries = street_lengths.get("entries", {})

    features = []
    failed_geocode_count = 0
    geocoded_success_count = 0

    for street in normalized["streets"]:
        cache_key = street["cache_key"]
        entry = cache["entries"].get(cache_key)
        count_total = int(street["count_total"])
        is_car_park_feature = is_car_park(street)

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
        length_entry = length_entries.get(cache_key) if isinstance(length_entries, dict) else None
        street_length_meters: float | None = None
        street_length_miles: float | None = None
        fines_per_mile: float | None = None
        if (
            status != "manual_override"
            and not is_car_park_feature
            and isinstance(length_entry, dict)
            and length_entry.get("status") == "ok"
        ):
            street_length_meters = to_finite_number(length_entry.get("length_meters"))
            street_length_miles = to_finite_number(length_entry.get("length_miles"))
            if (
                street_length_miles is not None
                and street_length_miles > 0
                and math.isfinite(count_total)
            ):
                fines_per_mile = count_total / street_length_miles
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
                    "count_total": count_total,
                    "source_rows": street["source_rows"],
                    "is_zero_count": street["is_zero_count"],
                    "has_zero_count_variant": street["has_zero_count_variant"],
                    "geocode_status": status,
                    "is_car_park": is_car_park_feature,
                    "street_length_meters": street_length_meters,
                    "street_length_miles": street_length_miles,
                    "fines_per_mile": fines_per_mile,
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
