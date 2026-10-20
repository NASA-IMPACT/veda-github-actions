#!/usr/bin/env python3
"""Build the bundled gazetteer behind the Submit form's place picker.

One-time / occasional, run by hand — NOT in CI. The output is committed:

    data/places.json         countries + US states/territories + US counties  (bundled eagerly)
    data/places-cities.json  US incorporated places + CDPs                     (lazy chunk)

Sources (public, no credentials), passed as zip paths — the script never downloads anything:

    https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip
    https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_{state,county,place}_500k.zip

stdlib only. A shapefile's every polygon record header already carries its bounding box, so the
.shp is read with `struct` for the box alone and the .dbf for the names — no geometry is parsed.

Place ids are HIERARCHICAL so a parent is a prefix of its children (src/rules.ts PLACE_ID_RE):
    US                country  (ISO 3166-1 alpha-2)
    US-AL             state    (USPS code)
    US-AL-101         county   (county FIPS)
    US-AL-c51000      city     (place FIPS) — parent is the STATE; Census places can span counties

Each row is [id, name, west, south, east, north], bbox rounded OUTWARD to 3 decimals (~100 m).
The display label is derived in src/places.ts, never stored.

Run:
    python3 -I algorithm-catalog/scripts/build_places.py \\
        --countries ne_50m_admin_0_countries.zip --states cb_2023_us_state_500k.zip \\
        --counties cb_2023_us_county_500k.zip --places cb_2023_us_place_500k.zip
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # algorithm-catalog/
OUT_MAIN = ROOT / "data" / "places.json"
OUT_CITIES = ROOT / "data" / "places-cities.json"

# Natural Earth lists these as their own admin-0 units; the Census state file already has them as
# US-<code>. Keeping both would put "Puerto Rico · country" next to "Puerto Rico · state".
CENSUS_TERRITORIES = {"PR", "GU", "MP", "VI", "AS", "UM"}

# Natural Earth's NAME, where the short form reads better in a chip ("Broaden to United States").
NAME_OVERRIDES = {"US": "United States"}


def _member(z: zipfile.ZipFile, suffix: str) -> bytes:
    names = [n for n in z.namelist() if n.lower().endswith(suffix)]
    if len(names) != 1:
        raise SystemExit(f"{z.filename}: expected exactly one *{suffix}, found {names}")
    return z.read(names[0])


def read_dbf(b: bytes) -> list[dict[str, str]]:
    """dBASE III: header, 32-byte field descriptors up to 0x0D, then fixed-width records."""
    nrec, header_len, rec_len = struct.unpack("<IHH", b[4:12])
    fields: list[tuple[str, int]] = []
    o = 32
    while b[o] != 0x0D:
        fields.append((b[o : o + 11].split(b"\0")[0].decode("ascii"), b[o + 16]))
        o += 32
    rows: list[dict[str, str]] = []
    for i in range(nrec):
        r = header_len + i * rec_len
        o = r + 1  # skip the deletion flag
        row: dict[str, str] = {}
        for name, width in fields:
            # Natural Earth pads with NULs, Census with spaces.
            row[name] = b[o : o + width].decode("utf-8", errors="replace").replace("\0", "").strip()
            o += width
        rows.append(row)
    return rows


def read_shp_boxes(b: bytes) -> list[tuple[float, float, float, float] | None]:
    """Per-record (xmin, ymin, xmax, ymax), or None for a null shape. Records are in .dbf order."""
    out: list[tuple[float, float, float, float] | None] = []
    o = 100
    while o < len(b):
        _num, words = struct.unpack(">ii", b[o : o + 8])
        content = o + 8
        (shape_type,) = struct.unpack("<i", b[content : content + 4])
        out.append(None if shape_type == 0 else struct.unpack("<4d", b[content + 4 : content + 36]))
        o = content + words * 2
    return out


def read_layer(path: Path) -> list[tuple[dict[str, str], tuple[float, float, float, float]]]:
    with zipfile.ZipFile(path) as z:
        rows = read_dbf(_member(z, ".dbf"))
        boxes = read_shp_boxes(_member(z, ".shp"))
    if len(rows) != len(boxes):
        raise SystemExit(f"{path}: {len(rows)} dbf rows but {len(boxes)} shp records")
    return [(r, bx) for r, bx in zip(rows, boxes) if bx is not None]


def row(pid: str, name: str, box: tuple[float, float, float, float]) -> list:
    w, s, e, n = box
    return [
        pid,
        name,
        math.floor(w * 1000) / 1000,
        math.floor(s * 1000) / 1000,
        math.ceil(e * 1000) / 1000,
        math.ceil(n * 1000) / 1000,
    ]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--countries", type=Path, required=True)
    ap.add_argument("--states", type=Path, required=True)
    ap.add_argument("--counties", type=Path, required=True)
    ap.add_argument("--places", type=Path, required=True)
    args = ap.parse_args(argv)

    main_rows: list[list] = []
    skipped: list[str] = []

    # A few Natural Earth units share an ISO code (Australia's external territories all say AU).
    # Keep the largest, which is the country itself.
    countries: dict[str, tuple[str, tuple[float, float, float, float]]] = {}
    area = lambda bx: (bx[2] - bx[0]) * (bx[3] - bx[1])  # noqa: E731
    for r, box in read_layer(args.countries):
        iso = r.get("ISO_A2_EH", "")
        if len(iso) != 2 or not iso.isalpha() or not iso.isupper():
            skipped.append(f"country {r.get('NAME')!r} (ISO_A2_EH={iso!r})")
            continue
        if iso in CENSUS_TERRITORIES:
            continue
        if iso in countries and area(countries[iso][1]) >= area(box):
            skipped.append(f"country {r.get('NAME')!r} (duplicate {iso}, kept {countries[iso][0]!r})")
            continue
        countries[iso] = (NAME_OVERRIDES.get(iso, r["NAME"]), box)
    main_rows.extend(row(iso, name, box) for iso, (name, box) in countries.items())

    state_by_fips: dict[str, str] = {}
    for r, box in read_layer(args.states):
        state_by_fips[r["STATEFP"]] = r["STUSPS"]
        main_rows.append(row(f"US-{r['STUSPS']}", r["NAME"], box))

    for r, box in read_layer(args.counties):
        main_rows.append(row(f"US-{r['STUSPS']}-{r['COUNTYFP']}", r["NAMELSAD"], box))

    city_rows = [
        row(f"US-{r['STUSPS']}-c{r['PLACEFP']}", r["NAME"], box)
        for r, box in read_layer(args.places)
        if r["STATEFP"] in state_by_fips
    ]

    main_rows.sort(key=lambda x: x[0])
    city_rows.sort(key=lambda x: x[0])
    for path, rows in ((OUT_MAIN, main_rows), (OUT_CITIES, city_rows)):
        ids = [x[0] for x in rows]
        if len(ids) != len(set(ids)):
            raise SystemExit(f"{path.name}: duplicate place ids")
        # One row per line: diffable, and still compact.
        body = ",\n".join(json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in rows)
        path.write_text(f"[\n{body}\n]\n", encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}: {len(rows)} places, {path.stat().st_size:,} bytes")
    for s in skipped:
        print(f"  skipped {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
