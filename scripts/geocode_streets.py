#!/usr/bin/env python3
"""Geocode parking-fine street records against Nominatim with resumable caching."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from geopy.extra.rate_limiter import RateLimiter
from geopy.geocoders import Nominatim


REPO_ROOT = Path(__file__).resolve().parent.parent
NORMALIZED_JSON = REPO_ROOT / "data" / "build" / "normalized_streets.json"
CACHE_JSON = REPO_ROOT / "data" / "cache" / "geocode-cache.json"
MANUAL_OVERRIDES_JSON = REPO_ROOT / "data" / "manual-overrides.json"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Safari/605.1.15"
ACCEPTED_TYPES = {
    "road",
    "pedestrian",
    "residential",
    "service",
    "parking",
    "unclassified",
    "tertiary",
    "secondary",
    "primary",
    "living_street",
    "path",
    "footway",
    "cycleway",
}
REGION_BOUNDARY = {
    "lat_min": 52.47,
    "lat_max": 52.84,
    "lon_min": -1.36,
    "lon_max": -1.0,
}
TERMINAL_STATUSES = {"ok", "not_found", "ambiguous", "manual_override"}
VIEWBOX = (
    (REGION_BOUNDARY["lat_min"], REGION_BOUNDARY["lon_min"]),
    (REGION_BOUNDARY["lat_max"], REGION_BOUNDARY["lon_max"]),
)

GEOCODER = Nominatim(user_agent=USER_AGENT, timeout=30)
GEOCODE_WITH_LIMITER = RateLimiter(
    GEOCODER.geocode,
    min_delay_seconds=1.0,
    max_retries=2,
    error_wait_seconds=5.0,
    swallow_exceptions=False,
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def normalize_match_text(value: str) -> str:
    value = normalize_text(value).lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def normalize_identity(value: str) -> str:
    value = normalize_text(value).lower()
    value = re.sub(r"[\s.,;:!?]+$", "", value)
    return value


def normalize_street_variant(value: str) -> str:
    normalized = normalize_identity(value)
    normalized = re.sub(r"^(?:[abm]\d+[a-z]?)\s+", "", normalized)
    return normalized


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_cache(cache: dict[str, Any]) -> None:
    CACHE_JSON.parent.mkdir(parents=True, exist_ok=True)
    with CACHE_JSON.open("w", encoding="utf-8") as handle:
        json.dump(cache, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def load_normalized_records() -> list[dict[str, Any]]:
    payload = load_json(NORMALIZED_JSON, None)
    if payload is None:
        raise FileNotFoundError(
            f"Missing normalized data at {NORMALIZED_JSON}. Run scripts/prepare_data.py first."
        )
    return payload["streets"]


def load_cache() -> dict[str, Any]:
    cache = load_json(CACHE_JSON, None)
    if cache is None:
        return {"version": 1, "provider": "nominatim", "entries": {}}
    cache.setdefault("version", 1)
    cache.setdefault("provider", "nominatim")
    cache.setdefault("entries", {})
    return cache


def load_manual_overrides() -> dict[str, Any]:
    overrides = load_json(MANUAL_OVERRIDES_JSON, {})
    if not MANUAL_OVERRIDES_JSON.exists():
        MANUAL_OVERRIDES_JSON.parent.mkdir(parents=True, exist_ok=True)
        with MANUAL_OVERRIDES_JSON.open("w", encoding="utf-8") as handle:
            json.dump({}, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    return overrides


def in_region_bounds(lat: float, lon: float) -> bool:
    return (
        REGION_BOUNDARY["lat_min"] <= lat <= REGION_BOUNDARY["lat_max"]
        and REGION_BOUNDARY["lon_min"] <= lon <= REGION_BOUNDARY["lon_max"]
    )


def build_match_blob(result: dict[str, Any]) -> str:
    parts = [str(result.get("display_name") or "")]
    address = result.get("address")
    if isinstance(address, dict):
        parts.extend(str(value or "") for value in address.values())
    return normalize_match_text(" ".join(parts))


def build_area_variants(area: str) -> set[str]:
    normalized = normalize_match_text(area)
    if not normalized:
        return set()
    variants = {normalized}
    if " and " in normalized:
        variants.add(normalized.replace(" and ", " "))
    return variants


def result_matches_area(area: str, result: dict[str, Any]) -> bool:
    area_variants = build_area_variants(area)
    if not area_variants:
        return False
    blob = f" {build_match_blob(result)} "
    return any(f" {variant} " in blob for variant in area_variants)


def build_street_variants(result: dict[str, Any]) -> set[str]:
    parts = [str(result.get("name") or "")]
    display_name = str(result.get("display_name") or "")
    if display_name:
        parts.append(display_name.split(",", 1)[0])
    address = result.get("address")
    if isinstance(address, dict):
        for key in ("road", "pedestrian", "residential", "footway", "cycleway", "path", "highway"):
            parts.append(str(address.get(key) or ""))
    variants: set[str] = set()
    for value in parts:
        normalized = normalize_identity(value)
        if not normalized:
            continue
        variants.add(normalized)
        stripped = normalize_street_variant(value)
        if stripped:
            variants.add(stripped)
    return variants


def result_matches_street(street_name: str, result: dict[str, Any]) -> bool:
    variants = build_street_variants(result)
    targets = {normalize_identity(street_name), normalize_street_variant(street_name)}
    targets.discard("")
    return any(target in variants for target in targets)


def build_result_context(result: dict[str, Any]) -> str:
    parts = [str(result.get("name") or "")]
    address = result.get("address")
    if isinstance(address, dict):
        for key in ("road", "pedestrian", "residential", "suburb", "quarter", "village", "town", "city", "county"):
            parts.append(str(address.get(key) or ""))
    return normalize_match_text(" ".join(parts))


def result_score(street_name: str, area: str, result: dict[str, Any]) -> tuple[int, int, int, float]:
    result_type = str(result.get("type", "")).lower()
    category = str(result.get("category", "")).lower()
    importance = float(result.get("importance") or 0.0)
    match_blob = build_match_blob(result)
    lat = float(result["lat"])
    lon = float(result["lon"])
    street_bonus = 4 if result_matches_street(street_name, result) else 0
    type_bonus = 2 if result_type in ACCEPTED_TYPES else 0
    category_bonus = 1 if category in {"highway", "place"} else 0
    area_bonus = 3 if result_matches_area(area, result) else 0
    county_bonus = 1 if " leicestershire " in f" {match_blob} " else 0
    bounds_bonus = 2 if in_region_bounds(lat, lon) else -2
    total_score = street_bonus + type_bonus + category_bonus + area_bonus + county_bonus + bounds_bonus
    return (total_score, street_bonus, area_bonus, importance)


def pick_result(query: str, street_name: str, area: str, results: list[dict[str, Any]]) -> dict[str, Any]:
    if not results:
        return {
            "query": query,
            "status": "not_found",
            "source": "nominatim",
            "fetched_at": utc_now_iso(),
        }

    usable = []
    for result in results:
        try:
            lat = float(result["lat"])
            lon = float(result["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        usable.append((result_score(street_name, area, result), lat, lon, result))

    if not usable:
        return {
            "query": query,
            "status": "error",
            "error": "No usable coordinates returned",
            "source": "nominatim",
            "fetched_at": utc_now_iso(),
        }

    usable.sort(key=lambda item: item[0], reverse=True)
    best_score, best_lat, best_lon, best_result = usable[0]
    if best_score[0] < 2:
        return {
            "query": query,
            "status": "ambiguous",
            "display_name": best_result.get("display_name"),
            "importance": float(best_result.get("importance") or 0.0),
            "source": "nominatim",
            "fetched_at": utc_now_iso(),
        }

    if len(usable) > 1:
        next_score, _, _, next_result = usable[1]
        if best_score[0] == next_score[0]:
            best_context = build_result_context(best_result)
            next_context = build_result_context(next_result)
            best_street_match = result_matches_street(street_name, best_result)
            next_street_match = result_matches_street(street_name, next_result)
            best_area_match = result_matches_area(area, best_result)
            next_area_match = result_matches_area(area, next_result)
            importance_gap = float(best_score[3]) - float(next_score[3])
            if (
                best_context != next_context
                and best_street_match == next_street_match
                and best_area_match == next_area_match
                and importance_gap < 0.05
            ):
                return {
                    "query": query,
                    "status": "ambiguous",
                    "display_name": best_result.get("display_name"),
                    "importance": float(best_result.get("importance") or 0.0),
                    "source": "nominatim",
                    "fetched_at": utc_now_iso(),
                }

    return {
        "query": query,
        "status": "ok",
        "lat": best_lat,
        "lon": best_lon,
        "display_name": best_result.get("display_name"),
        "importance": float(best_result.get("importance") or 0.0),
        "type": best_result.get("type"),
        "category": best_result.get("category"),
        "source": "nominatim",
        "fetched_at": utc_now_iso(),
    }


def fetch_results(query: str) -> list[dict[str, Any]]:
    locations = GEOCODE_WITH_LIMITER(
        query,
        exactly_one=False,
        addressdetails=True,
        limit=5,
        country_codes="gb",
        viewbox=VIEWBOX,
        bounded=False,
    )
    if not locations:
        return []
    results: list[dict[str, Any]] = []
    for location in locations:
        raw = getattr(location, "raw", None)
        if raw:
            results.append(raw)
    return results


def apply_manual_override(cache: dict[str, Any], cache_key: str, override: dict[str, Any], query: str) -> None:
    cache["entries"][cache_key] = {
        "query": query,
        "status": "manual_override",
        "lat": float(override["lat"]),
        "lon": float(override["lon"]),
        "display_name": override.get("display_name") or query,
        "importance": 1.0,
        "source": "manual_override",
        "reason": override.get("reason", ""),
        "fetched_at": utc_now_iso(),
    }


def should_skip(entry: dict[str, Any] | None) -> bool:
    return bool(entry and entry.get("status") in TERMINAL_STATUSES)


def geocode_records(
    force_retry_errors: bool = False,
    force_retry_ambiguous: bool = False,
    max_records: int | None = None,
    show_progress: bool = False,
) -> None:
    records = load_normalized_records()
    cache = load_cache()
    manual_overrides = load_manual_overrides()
    entries = cache["entries"]
    processed = 0
    total = len(records)

    for record in records:
        cache_key = record["cache_key"]
        query = record["query"]
        area = str(record.get("area") or record.get("city") or "")

        if cache_key in manual_overrides:
            apply_manual_override(cache, cache_key, manual_overrides[cache_key], query)
            save_cache(cache)
            if show_progress:
                entry = cache["entries"].get(cache_key, {})
                status = entry.get("status", "unknown")
                detail = entry.get("display_name", "")
                detail_suffix = f" ({detail})" if detail else ""
                print(f"[{processed + 1}/{total}] {cache_key} -> {status}{detail_suffix}", flush=True)
            processed += 1
            if max_records is not None and processed >= max_records:
                break
            continue

        existing = entries.get(cache_key)
        if should_skip(existing):
            if existing and existing.get("status") == "ambiguous" and force_retry_ambiguous:
                pass
            else:
                continue
        if existing and existing.get("status") == "error" and not force_retry_errors:
            continue

        try:
            results = fetch_results(query)
            entries[cache_key] = pick_result(query, record["display_name"], area, results)
        except Exception as exc:  # noqa: BLE001
            entries[cache_key] = {
                "query": query,
                "status": "error",
                "error": str(exc),
                "source": "nominatim",
                "fetched_at": utc_now_iso(),
            }

        save_cache(cache)
        if show_progress:
            entry = entries.get(cache_key, {})
            status = entry.get("status", "unknown")
            detail = entry.get("error") if status == "error" else entry.get("display_name", "")
            detail_suffix = f" ({detail})" if detail else ""
            print(f"[{processed + 1}/{total}] {cache_key} -> {status}{detail_suffix}", flush=True)
        processed += 1
        if max_records is not None and processed >= max_records:
            break


def summarize_cache() -> dict[str, int]:
    cache = load_cache()
    statuses: dict[str, int] = {}
    for entry in cache["entries"].values():
        status = str(entry.get("status", "unknown"))
        statuses[status] = statuses.get(status, 0) + 1
    return statuses


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--retry-errors",
        action="store_true",
        help="Retry cache entries previously marked as error.",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print cache status counts without performing any geocoding.",
    )
    parser.add_argument(
        "--retry-ambiguous",
        action="store_true",
        help="Retry cache entries previously marked as ambiguous.",
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=None,
        help="Limit the number of geocode/manual-override operations in this run.",
    )
    parser.add_argument(
        "--progress",
        action="store_true",
        help="Print per-record status updates while geocoding.",
    )
    args = parser.parse_args()

    if args.summary_only:
        print(json.dumps(summarize_cache(), indent=2, ensure_ascii=False))
        return

    geocode_records(
        force_retry_errors=args.retry_errors,
        force_retry_ambiguous=args.retry_ambiguous,
        max_records=args.max_records,
        show_progress=args.progress,
    )
    print(json.dumps(summarize_cache(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
