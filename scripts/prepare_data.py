#!/usr/bin/env python3
"""Normalize parking fine street data from CSV/XLSX sources into a stable JSON dataset."""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE_FILES = [REPO_ROOT / "data" / "source" / "leicester.csv"]
OUTPUT_JSON = REPO_ROOT / "data" / "build" / "normalized_streets.json"
COLUMN_ALIASES = {
    "street": ("Street/Location", "Location Name"),
    "area": ("City/Area", "Authority", "Authority Name"),
    "count": ("Count", "Number Of PCNs Issued"),
}
DEFAULT_AREA = "Leicester"
DEFAULT_COUNTRY = "UK"


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


def parse_count(raw_value: Any, street_name: str) -> int:
    value = normalize_text("" if raw_value is None else str(raw_value))
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
    area: str = DEFAULT_AREA
    country: str = DEFAULT_COUNTRY
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
            "city": self.area,
            "area": self.area,
            "country": self.country,
            "query": f"{display_name}, {self.area}, {self.country}",
            "count_total": self.count_total,
            "source_rows": self.source_rows,
            "has_zero_count_variant": self.has_zero_count_variant,
            "has_positive_count_variant": self.has_positive_count_variant,
            "is_zero_count": self.count_total == 0,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "sources",
        nargs="*",
        type=Path,
        help="Source CSV/XLSX files to normalize. Defaults to data/source/leicester.csv.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_JSON,
        help=f"Output JSON path (default: {OUTPUT_JSON})",
    )
    return parser.parse_args()


def resolve_column_name(fieldnames: Iterable[str | None], key: str, source_path: Path) -> str:
    header_lookup = {
        normalize_text(str(name)): str(name)
        for name in fieldnames
        if normalize_text("" if name is None else str(name))
    }
    for alias in COLUMN_ALIASES[key]:
        normalized_alias = normalize_text(alias)
        if normalized_alias in header_lookup:
            return header_lookup[normalized_alias]
    expected_display = ", ".join(COLUMN_ALIASES[key])
    raise ValueError(f"{source_path} is missing a supported {key} column ({expected_display})")


def canonicalize_row(
    row: dict[str, Any],
    street_column: str,
    area_column: str,
    count_column: str,
) -> dict[str, Any]:
    return {
        "street": row.get(street_column, ""),
        "area": row.get(area_column, ""),
        "count": row.get(count_column, ""),
    }


def load_csv_rows(source_path: Path) -> list[dict[str, Any]]:
    with source_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError(f"{source_path} has no header row")
        street_column = resolve_column_name(reader.fieldnames, "street", source_path)
        area_column = resolve_column_name(reader.fieldnames, "area", source_path)
        count_column = resolve_column_name(reader.fieldnames, "count", source_path)
        return [canonicalize_row(row, street_column, area_column, count_column) for row in reader]


def load_xlsx_rows(source_path: Path) -> list[dict[str, Any]]:
    try:
        from openpyxl import load_workbook
    except ImportError as exc:
        raise RuntimeError(
            "Reading Excel sources requires openpyxl. Install it with `python3 -m pip install openpyxl`."
        ) from exc

    workbook = load_workbook(source_path, read_only=True, data_only=True)
    worksheet = workbook[workbook.sheetnames[0]]
    rows = worksheet.iter_rows(values_only=True)
    header_row = next(rows, None)
    if header_row is None:
        raise ValueError(f"{source_path} has no rows")

    header_names = [None if value is None else str(value) for value in header_row]
    street_column = resolve_column_name(header_names, "street", source_path)
    area_column = resolve_column_name(header_names, "area", source_path)
    count_column = resolve_column_name(header_names, "count", source_path)
    street_index = header_names.index(street_column)
    area_index = header_names.index(area_column)
    count_index = header_names.index(count_column)

    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        if row is None:
            continue
        street_value = row[street_index] if street_index < len(row) else ""
        area_value = row[area_index] if area_index < len(row) else ""
        count_value = row[count_index] if count_index < len(row) else ""
        if street_value is None and area_value is None and count_value is None:
            continue
        normalized_rows.append(
            {
                "street": street_value,
                "area": area_value,
                "count": count_value,
            }
        )
    workbook.close()
    return normalized_rows


def load_rows(source_paths: list[Path]) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    source_labels: list[str] = []
    for source_path in source_paths:
        resolved_path = source_path.expanduser().resolve()
        if not resolved_path.exists():
            raise FileNotFoundError(f"Source file not found: {resolved_path}")
        suffix = resolved_path.suffix.lower()
        if suffix == ".csv":
            loaded_rows = load_csv_rows(resolved_path)
        elif suffix in {".xlsx", ".xlsm"}:
            loaded_rows = load_xlsx_rows(resolved_path)
        else:
            raise ValueError(f"Unsupported source type {resolved_path.suffix!r} for {resolved_path}")
        rows.extend(loaded_rows)
        source_labels.append(str(resolved_path))
    return rows, source_labels


def build_records(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[str, StreetAggregate] = {}
    for row in rows:
        street_raw = strip_outer_whitespace(str(row.get("street", "") or ""))
        if not street_raw:
            raise ValueError("Street/Location or Location Name is required")

        area_raw = normalize_text(str(row.get("area", "") or "")) or DEFAULT_AREA
        count_value = parse_count(row.get("count", ""), street_raw)

        normalized_street = normalize_identity(street_raw)
        normalized_area = normalize_identity(area_raw)
        cache_key = f"{normalized_street}|{normalized_area}|uk"

        aggregate = grouped.get(cache_key)
        if aggregate is None:
            aggregate = StreetAggregate(
                normalized_street=normalized_street,
                cache_key=cache_key,
                area=area_raw,
            )
            grouped[cache_key] = aggregate
        aggregate.add_row(street_raw, count_value)

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
    args = parse_args()
    source_paths = args.sources or DEFAULT_SOURCE_FILES
    rows, source_labels = load_rows(source_paths)
    records, duplicate_groups = build_records(rows)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": utc_now_iso(),
        "source_csv": source_labels[0] if len(source_labels) == 1 else None,
        "source_files": source_labels,
        "source_row_count": len(rows),
        "normalized_street_count": len(records),
        "zero_count_rows": sum(1 for row in records if row["is_zero_count"]),
        "positive_count_rows": sum(1 for row in records if not row["is_zero_count"]),
        "duplicate_groups_resolved": len(duplicate_groups),
        "duplicate_groups": duplicate_groups,
        "streets": records,
    }
    with args.output.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(
        json.dumps(
            {
                "output": str(args.output),
                "source_row_count": payload["source_row_count"],
                "normalized_street_count": payload["normalized_street_count"],
                "duplicate_groups_resolved": payload["duplicate_groups_resolved"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
