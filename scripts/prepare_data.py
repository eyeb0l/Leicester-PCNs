#!/usr/bin/env python3
"""Normalize Leicester parking fine street data into a stable JSON dataset."""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_CSV = REPO_ROOT / "data" / "source" / "leicester.csv"
OUTPUT_JSON = REPO_ROOT / "data" / "build" / "normalized_streets.json"

EXPECTED_HEADERS = {"Street/Location", "City/Area", "Count"}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def normalize_identity(value: str) -> str:
    value = normalize_text(value).lower()
    value = re.sub(r"[\s.,;:!?]+$", "", value)
    return value


def strip_outer_whitespace(value: str) -> str:
    return (value or "").strip()


def choose_display_name(aliases: set[str], normalized_key: str) -> str:
    ranked = sorted(
        aliases,
        key=lambda alias: (
            alias.endswith("."),
            any(ch.isspace() and ch != " " for ch in alias),
            len(alias),
            alias.lower(),
        ),
    )
    if ranked:
        return normalize_text(ranked[0])
    return normalized_key.title()


def parse_count(raw_value: str, street_name: str) -> int:
    value = normalize_text(raw_value)
    try:
        parsed = float(value)
    except ValueError as exc:
        raise ValueError(f"Invalid Count value {raw_value!r} for street {street_name!r}") from exc
    if not parsed.is_integer():
        raise ValueError(f"Count value {raw_value!r} for street {street_name!r} is not a whole number")
    return int(parsed)


@dataclass
class StreetAggregate:
    normalized_street: str
    cache_key: str
    city: str = "Leicester"
    country: str = "UK"
    aliases: set[str] = field(default_factory=set)
    count_total: int = 0
    source_rows: int = 0
    has_zero_count_variant: bool = False
    has_positive_count_variant: bool = False

    def add_row(self, alias: str, count: int) -> None:
        self.aliases.add(alias)
        self.count_total += count
        self.source_rows += 1
        if count == 0:
            self.has_zero_count_variant = True
        else:
            self.has_positive_count_variant = True

    def to_record(self) -> dict[str, Any]:
        alias_list = sorted(self.aliases)
        display_name = choose_display_name(self.aliases, self.normalized_street)
        return {
            "cache_key": self.cache_key,
            "display_name": display_name,
            "aliases": alias_list,
            "city": self.city,
            "country": self.country,
            "query": f"{display_name}, {self.city}, {self.country}",
            "count_total": self.count_total,
            "source_rows": self.source_rows,
            "has_zero_count_variant": self.has_zero_count_variant,
            "has_positive_count_variant": self.has_positive_count_variant,
            "is_zero_count": self.count_total == 0,
        }


def load_rows() -> list[dict[str, str]]:
    with SOURCE_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = set(reader.fieldnames or [])
        missing = EXPECTED_HEADERS - headers
        if missing:
            missing_display = ", ".join(sorted(missing))
            raise ValueError(f"CSV is missing required columns: {missing_display}")
        return list(reader)


def build_records(rows: list[dict[str, str]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[str, StreetAggregate] = {}
    source_rows = 0
    for row in rows:
        street_raw = strip_outer_whitespace(row.get("Street/Location", ""))
        if not street_raw:
            raise ValueError("Street/Location is required")

        city_raw = normalize_text(row.get("City/Area", ""))
        count_value = parse_count(row.get("Count", ""), street_raw)

        normalized_street = normalize_identity(street_raw)
        normalized_city = "leicester"
        cache_key = f"{normalized_street}|{normalized_city}|uk"

        aggregate = grouped.get(cache_key)
        if aggregate is None:
            aggregate = StreetAggregate(
                normalized_street=normalized_street,
                cache_key=cache_key,
                city="Leicester",
            )
            grouped[cache_key] = aggregate
        aggregate.add_row(street_raw, count_value)
        source_rows += 1

    records = [aggregate.to_record() for aggregate in sorted(grouped.values(), key=lambda item: item.cache_key)]
    duplicate_groups = []
    for record in records:
        if record["source_rows"] > 1:
            duplicate_groups.append(
                {
                    "cache_key": record["cache_key"],
                    "display_name": record["display_name"],
                    "aliases": record["aliases"],
                    "count_total": record["count_total"],
                    "source_rows": record["source_rows"],
                }
            )
    return records, duplicate_groups


def main() -> None:
    rows = load_rows()
    records, duplicate_groups = build_records(rows)

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": utc_now_iso(),
        "source_csv": str(SOURCE_CSV),
        "source_row_count": len(rows),
        "normalized_street_count": len(records),
        "zero_count_rows": sum(1 for row in records if row["is_zero_count"]),
        "positive_count_rows": sum(1 for row in records if not row["is_zero_count"]),
        "duplicate_groups_resolved": len(duplicate_groups),
        "duplicate_groups": duplicate_groups,
        "streets": records,
    }
    with OUTPUT_JSON.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(
        json.dumps(
            {
                "output": str(OUTPUT_JSON),
                "source_row_count": payload["source_row_count"],
                "normalized_street_count": payload["normalized_street_count"],
                "duplicate_groups_resolved": payload["duplicate_groups_resolved"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
