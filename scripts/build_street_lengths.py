#!/usr/bin/env python3
"""Build a cached street-length index from OpenStreetMap via Overpass."""

from __future__ import annotations

import json
import math
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parent.parent
NORMALIZED_JSON = REPO_ROOT / "data" / "build" / "normalized_streets.json"
GEOCODE_CACHE_JSON = REPO_ROOT / "data" / "cache" / "geocode-cache.json"
MANUAL_OVERRIDES_JSON = REPO_ROOT / "data" / "manual-overrides.json"
OUTPUT_JSON = REPO_ROOT / "data" / "cache" / "street-lengths.json"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
REGION_BBOX = {
    "south": 52.47,
    "west": -1.36,
    "north": 52.84,
    "east": -1.0,
}
EARTH_RADIUS_METERS = 6_371_000.0
METERS_PER_MILE = 1_609.344
CAR_PARK_PATTERN = re.compile(r"\b(?:car\s*park|carpark|parking\s+area)\b", re.IGNORECASE)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def normalize_identity(value: str) -> str:
    normalized = normalize_text(value).lower()
    normalized = re.sub(r"[\s.,;:!?]+$", "", normalized)
    return normalized


def is_car_park_name(value: str) -> bool:
    return bool(CAR_PARK_PATTERN.search(normalize_text(value)))


def is_car_park_record(record: dict[str, Any]) -> bool:
    names = [record.get("display_name", ""), *(record.get("aliases") or [])]
    return any(is_car_park_name(name) for name in names)


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * (math.sin(d_lambda / 2) ** 2)
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_METERS * c


def compute_way_length_meters(geometry: list[dict[str, Any]]) -> float:
    if len(geometry) < 2:
        return 0.0
    total = 0.0
    for index in range(1, len(geometry)):
        prev = geometry[index - 1]
        curr = geometry[index]
        total += haversine_meters(
            float(prev["lat"]),
            float(prev["lon"]),
            float(curr["lat"]),
            float(curr["lon"]),
        )
    return total


def normalize_node_key(point: dict[str, Any]) -> str:
    return f"{float(point['lat']):.7f},{float(point['lon']):.7f}"


def geometry_distance_meters(lat: float, lon: float, geometry: list[dict[str, Any]]) -> float:
    best_distance = math.inf
    for point in geometry:
        distance = haversine_meters(lat, lon, float(point["lat"]), float(point["lon"]))
        if distance < best_distance:
            best_distance = distance
    return best_distance


def cluster_name_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    node_to_indices: dict[str, set[int]] = {}
    for index, candidate in enumerate(candidates):
        for node_key in candidate["node_keys"]:
            node_to_indices.setdefault(node_key, set()).add(index)

    visited: set[int] = set()
    clusters: list[dict[str, Any]] = []
    for start_index in range(len(candidates)):
        if start_index in visited:
            continue

        queue = [start_index]
        cluster_indices: list[int] = []
        visited.add(start_index)
        while queue:
            current_index = queue.pop()
            cluster_indices.append(current_index)
            for node_key in candidates[current_index]["node_keys"]:
                for neighbor_index in node_to_indices.get(node_key, set()):
                    if neighbor_index in visited:
                        continue
                    visited.add(neighbor_index)
                    queue.append(neighbor_index)

        cluster_geometry: list[dict[str, Any]] = []
        cluster_length = 0.0
        for index in cluster_indices:
            candidate = candidates[index]
            cluster_length += candidate["length_meters"]
            cluster_geometry.extend(candidate["geometry"])
        clusters.append(
            {
                "length_meters": cluster_length,
                "geometry": cluster_geometry,
                "way_count": len(cluster_indices),
            }
        )

    return clusters


def fetch_overpass_clusters() -> dict[str, list[dict[str, Any]]]:
    query = f"""
    [out:json][timeout:180];
    (
      way["highway"]["name"]({REGION_BBOX["south"]},{REGION_BBOX["west"]},{REGION_BBOX["north"]},{REGION_BBOX["east"]});
    );
    out geom;
    """.strip()
    payload = urlencode({"data": query}).encode("utf-8")
    request = Request(
        OVERPASS_URL,
        data=payload,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "User-Agent": "Leicester-PCNs street-length builder",
        },
        method="POST",
    )
    with urlopen(request, timeout=180) as response:  # noqa: S310
        body = response.read()
    parsed = json.loads(body.decode("utf-8"))
    elements = parsed.get("elements") or []
    ways_by_name: dict[str, list[dict[str, Any]]] = {}

    for element in elements:
        if element.get("type") != "way":
            continue
        tags = element.get("tags") or {}
        raw_name = str(tags.get("name") or "").strip()
        if not raw_name:
            continue
        geometry = element.get("geometry")
        if not isinstance(geometry, list):
            continue
        normalized_name = normalize_identity(raw_name)
        if not normalized_name:
            continue
        way_length = compute_way_length_meters(geometry)
        if way_length <= 0:
            continue
        node_keys = {normalize_node_key(point) for point in geometry}
        if not node_keys:
            continue
        ways_by_name.setdefault(normalized_name, []).append(
            {
                "length_meters": way_length,
                "geometry": geometry,
                "node_keys": node_keys,
            }
        )

    return {name: cluster_name_candidates(candidates) for name, candidates in ways_by_name.items()}


def choose_cluster(
    clusters: list[dict[str, Any]],
    lat: float,
    lon: float,
) -> dict[str, Any] | None:
    if not clusters:
        return None
    return min(
        clusters,
        key=lambda cluster: (
            geometry_distance_meters(lat, lon, cluster["geometry"]),
            -float(cluster["length_meters"]),
        ),
    )


def build_entries() -> dict[str, Any]:
    normalized = load_json(NORMALIZED_JSON, None)
    if normalized is None:
        raise FileNotFoundError(
            f"Missing normalized data at {NORMALIZED_JSON}. Run scripts/prepare_data.py first."
        )
    geocode_cache = load_json(GEOCODE_CACHE_JSON, {"entries": {}})
    manual_overrides = load_json(MANUAL_OVERRIDES_JSON, {})
    clusters_by_name = fetch_overpass_clusters()
    entries: dict[str, Any] = {}

    for street in normalized["streets"]:
        cache_key = street["cache_key"]
        normalized_street = cache_key.split("|", 1)[0]
        if cache_key in manual_overrides:
            entries[cache_key] = {"status": "skipped_manual_override"}
            continue
        if is_car_park_record(street):
            entries[cache_key] = {"status": "skipped_car_park"}
            continue

        geocode_entry = geocode_cache.get("entries", {}).get(cache_key, {})
        if geocode_entry.get("status") != "ok":
            entries[cache_key] = {"status": "missing_geocode"}
            continue

        try:
            lat = float(geocode_entry["lat"])
            lon = float(geocode_entry["lon"])
        except (KeyError, TypeError, ValueError):
            entries[cache_key] = {"status": "missing_geocode"}
            continue

        cluster = choose_cluster(clusters_by_name.get(normalized_street, []), lat, lon)
        if cluster is None:
            entries[cache_key] = {"status": "not_found"}
            continue

        length_meters = float(cluster["length_meters"])
        length_miles = length_meters / METERS_PER_MILE
        entries[cache_key] = {
            "status": "ok",
            "length_meters": round(length_meters, 3),
            "length_miles": round(length_miles, 6),
            "way_count": int(cluster["way_count"]),
        }

    return entries


def summarize_entries(entries: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for entry in entries.values():
        status = str(entry.get("status", "unknown"))
        counts[status] = counts.get(status, 0) + 1
    return counts


def main() -> None:
    entries = build_entries()
    payload = {
        "version": 1,
        "source": "openstreetmap_overpass",
        "generated_at": utc_now_iso(),
        "bbox": REGION_BBOX,
        "entries": entries,
    }
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_JSON.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(
        json.dumps(
            {
                "output": str(OUTPUT_JSON),
                "counts": summarize_entries(entries),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
