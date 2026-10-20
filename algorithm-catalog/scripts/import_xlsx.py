#!/usr/bin/env python3
"""ONE-TIME import of the hand-kept activation spreadsheet (hazard_event_info.xlsx) into
data/events.json. After this, the app + PRs are the source of truth and the sheet is retired.

Reads ONLY sheet 1, `Activation_Events` (one row per event; row 2 is the "EX:" example and is
skipped): Title · STAC name · Sub-title · US-gov link · Intro · Start · End · Need/Theme ·
Hazards · Locations · Layers. The other sheets are out of scope and ignored — a Layers cell that
only points at another sheet imports no layers (and is reported).

Merge rule, by stacName:
  * an event already in data/events.json keeps its curated layers/bbox/locations; it only gains a
    `page` (text from the sheet, plus its portal id when the page already exists on the portal);
  * a new event is appended, with places resolved against the gazetteer and a bbox derived from them.

Reports — never invents — every hazard, location or layer it could not map.

stdlib only. Run once, then review the diff in a PR:
    python3 -I algorithm-catalog/scripts/import_xlsx.py ~/Downloads/hazard_event_info.xlsx [--dry-run]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # algorithm-catalog/
DATA = ROOT / "data"
NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

# Pages that already exist on the Disasters Portal (app/site-config/event/event__<id>.ts on
# develop, 2026-10-20). Recording the id makes "Edit page" target the real page.
PORTAL_IDS = {
    "202501_Fire_CA": "southern-california-fire-jan-2025",
    "202606_Earthquake_Venezuela": "venezuela-earthquake-jun-2026",
    "202604_Typhoon_Sinlaku": "typhoon-sinlaku-2026",
    "202601_WinterWx_US": "us-winter-storm-jan-2026",
    "202410_Hurricane_Milton": "hurricane-milton-oct-2024",
    "202409_Hurricane_Helene": "hurricane-helene-sept-2024",
    "202507_Flood_TX": "texas-floods-july-2025",
}

# How the sheet spells sensors and products, normalised (lowercase, alphanumerics only).
ALGORITHM_ALIASES = {"sentinel2": "sentinel2", "landsat": "landsat", "satellogic": "satellogic",
                     "umbra": "umbra", "capella": "capella", "iceye": "iceye", "blackmarble": "blackmarble"}
PRODUCT_ALIASES = {"tc": "true", "truecolor": "true", "cir": "colorir", "colorinfrared": "colorir",
                   "natcolor": "nat", "naturalcolor": "nat", "hd": "hdnightlights", "sigmanaught": "sigma", "backscatter": "sigma0"}
NEEDS = {"prepare": "prepare", "respond": "respond", "recover": "recover",
         "resilience": "resilience", "buildresilience": "resilience"}

norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())  # noqa: E731


# --- xlsx (stdlib) ---------------------------------------------------------------------------------


def read_sheets(path: Path) -> dict[str, list[dict[str, str]]]:
    """{sheet name: [{column letter: text}]} — the same parse leave/generate_leave_tracker.py uses."""
    z = zipfile.ZipFile(path)
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out: dict[str, list[dict[str, str]]] = {}
    for sheet in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", NS):
        target = rels[sheet.get(f"{{{NS['r']}}}id")].lstrip("/")
        target = target if target.startswith("xl/") else f"xl/{target}"
        rows = []
        for row in ET.fromstring(z.read(target)).iter(f"{{{NS['m']}}}row"):
            cells = {}
            for c in row.findall("m:c", NS):
                v = c.find("m:v", NS)
                if c.get("t") == "s" and v is not None:
                    text = shared[int(v.text)]
                elif c.get("t") == "inlineStr":
                    text = "".join(x.text or "" for x in c.iter(f"{{{NS['m']}}}t"))
                else:
                    text = v.text if v is not None else ""
                if text and text.strip():
                    cells[re.match(r"[A-Z]+", c.get("r")).group()] = text.strip()
            rows.append(cells)
        out[sheet.get("name")] = rows
    return out


def excel_date(v: str) -> str:
    """Excel serial day (1900 system, epoch 1899-12-30) -> ISO. 45667 -> 2025-01-10."""
    return (dt.date(1899, 12, 30) + dt.timedelta(days=int(float(v)))).isoformat()


# --- gazetteer -------------------------------------------------------------------------------------


class Gazetteer:
    def __init__(self) -> None:
        rows = json.loads((DATA / "places.json").read_text()) + json.loads((DATA / "places-cities.json").read_text())
        self.by_id = {r[0]: r for r in rows}
        self.states = {r[1].lower(): r[0] for r in rows if re.fullmatch(r"US-[A-Z]{2}", r[0])}
        self.states.update({r[0][3:].lower(): r[0] for r in rows if re.fullmatch(r"US-[A-Z]{2}", r[0])})
        self.states["cnmi"] = "US-MP"
        self.countries = {r[1].lower(): r[0] for r in rows if re.fullmatch(r"[A-Z]{2}", r[0])}
        self.cities = {(r[1].lower(), r[0][:5]): r[0] for r in rows if "-c" in r[0]}

    def label(self, pid: str) -> str:
        name = self.by_id[pid][1]
        return f"{name}, {self.by_id[pid[:5]][1]}" if pid.count("-") == 2 else name

    def resolve(self, text: str) -> list[str] | None:
        """One sheet location cell -> place ids, or None when any part cannot be resolved."""
        t = text.strip().lower()
        if t in self.states:
            return [self.states[t]]
        if t in self.countries:
            return [self.countries[t]]
        parts = [p.strip() for p in t.split(",")]
        if len(parts) == 2 and parts[1] in self.states:  # "Los Angeles, CA"
            city = self.cities.get((parts[0], self.states[parts[1]]))
            if city:
                return [city]
        if all(p in self.states for p in parts):  # "Florida, Alabama"
            return [self.states[p] for p in parts]
        return None

    def bbox(self, ids: list[str]) -> str | None:
        """Union of the places' boxes, padded to 0.06° tall — src/places.ts unionBbox, mirrored."""
        boxes = [self.by_id[i][2:] for i in ids]
        w, s, e, n = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
        if e - w > 180:
            return None
        if n - s < 0.06:
            mid = (n + s) / 2
            s, n = mid - 0.03, mid + 0.03
        return ",".join(str(round(x, 3)) for x in (w, s, e, n))


# --- layers ----------------------------------------------------------------------------------------


def split_top(text: str) -> list[str]:
    """Split on commas that are not inside [...]."""
    out, depth, cur = [], 0, ""
    for ch in text:
        depth += ch == "["
        depth -= ch == "]"
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    return [x for x in [*out, cur.strip()] if x]


def map_layer(alg: str, prod: str, algorithms: dict[str, dict]) -> dict | None:
    a = algorithms.get(ALGORITHM_ALIASES.get(norm(alg), ""))
    if not a or not prod:
        return None
    want = PRODUCT_ALIASES.get(norm(prod), norm(prod))
    for p in a["products"]:
        if want in (norm(p["id"]), norm(p["label"]), norm(p.get("folder", ""))):
            return {"algorithm": a["id"], "product": p["id"]}
    return None


def parse_layers(cell: str, algorithms: dict[str, dict]) -> tuple[list[dict], list[str]]:
    """'Sentinel-2[trueColor,SWIR], Planet' -> catalog layers + external names."""
    layers, external = [], []
    for item in split_top(cell):
        m = re.match(r"^(.*?)\s*\[(.*)\]?$", item)
        alg, prods = (m.group(1), m.group(2).rstrip("]").split(",")) if m and "[" in item else (item, [""])
        for prod in prods:
            hit = map_layer(alg, prod.strip(), algorithms)
            if hit and hit not in layers:
                layers.append(hit)
            elif not hit:
                external.append(f"{alg.strip()} {prod.strip()}".strip())
    return layers, external



# --- JSON in the house style (Prettier-ish: short arrays/objects inline at 100 columns) -----------


def fmt(v, indent: int = 0, key: int = 0) -> str:
    """`key` = width of the `"name": ` prefix on this line, so inline arrays respect 100 columns."""
    pad, inner = " " * indent, " " * (indent + 2)
    if isinstance(v, dict):
        flat = "{ " + ", ".join(f"{json.dumps(k)}: {json.dumps(x, ensure_ascii=False)}" for k, x in v.items()) + " }"
        if all(not isinstance(x, (dict, list)) for x in v.values()) and indent >= 6 and len(pad) + len(flat) <= 100:
            return flat
        body = ",\n".join(f"{inner}{json.dumps(k)}: {fmt(x, indent + 2, len(json.dumps(k)) + 2)}" for k, x in v.items())
        return "{\n" + body + "\n" + pad + "}"
    if isinstance(v, list):
        if not v:
            return "[]"
        if all(not isinstance(x, (dict, list)) for x in v):
            flat = "[" + ", ".join(json.dumps(x, ensure_ascii=False) for x in v) + "]"
            if len(pad) + key + len(flat) + 1 <= 100:  # +1 for the trailing comma
                return flat
        return "[\n" + ",\n".join(inner + fmt(x, indent + 2) for x in v) + "\n" + pad + "]"
    return json.dumps(v, ensure_ascii=False)


# --- main ------------------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("xlsx", type=Path)
    ap.add_argument("--dry-run", action="store_true", help="report only; do not write data/events.json")
    args = ap.parse_args(argv)

    sheets = read_sheets(args.xlsx)
    events = json.loads((DATA / "events.json").read_text())
    if fmt(events) + "\n" != (DATA / "events.json").read_text():
        print("note: data/events.json is not in the formatter's house style; the write will reformat it.")
    hazards = json.loads((DATA / "hazards.json").read_text())
    algorithms = {a["id"]: a for a in json.loads((DATA / "algorithms.json").read_text())}
    gaz = Gazetteer()
    report: list[str] = []

    hazard_ids = {}
    for h in hazards:
        for k in (h["id"], h["label"], h["token"], *h["aliases"]):
            hazard_ids[norm(k)] = h["id"]

    by_stac = {e["stacName"]: e for e in events}
    for row in sheets["Activation_Events"][1:]:
        name, stac = row.get("A", ""), row.get("B", "")
        if not name or name.startswith("EX:"):
            continue
        where = f"{stac or name}:"

        page: dict = {}
        if row.get("C"):
            page["subtitle"] = row["C"]
        if row.get("E"):
            page["intro"] = row["E"]
        if row.get("D"):
            page["govLink"] = row["D"]
        needs = [NEEDS[norm(x)] for x in re.split(r"[,;/]", row.get("H", "")) if norm(x) in NEEDS]
        page["needs"] = needs
        if stac in PORTAL_IDS:
            page["portalId"] = PORTAL_IDS[stac]
        has_page = any(k != "needs" for k in page) or needs

        if stac in by_stac:
            if has_page:
                by_stac[stac]["page"] = page
            report.append(f"{where} already in events.json — kept its layers/bbox/locations; page {'set' if has_page else 'not set'}.")
            continue

        hz = []
        for x in re.split(r"[,;]", row.get("I", "")):
            if not x.strip():
                continue
            if norm(x) in hazard_ids:
                hz.append(hazard_ids[norm(x)])
            else:
                report.append(f"{where} hazard {x.strip()!r} is not in data/hazards.json — dropped.")

        places, free = [], []
        for cell in [c for c in re.split(r";", row.get("J", "")) if c.strip()]:
            ids = gaz.resolve(cell)
            if ids:
                places += [i for i in ids if i not in places]
            else:
                free.append(cell.strip())
                report.append(f"{where} location {cell.strip()!r} is not in the gazetteer — kept as free text.")

        cell = row.get("K", "")
        if "sheet" in norm(cell):
            layers, external = [], []
            report.append(f"{where} Layers cell only points at another sheet ({cell!r}) — no layers imported.")
        else:
            layers, external = parse_layers(cell, algorithms)
            if not cell:
                report.append(f"{where} no Layers in sheet 1 — imported with no layers.")
        if external:
            report.append(f"{where} {len(external)} layer(s) have no catalog algorithm — kept as externalLayers: {', '.join(external)}")

        start = excel_date(row["F"]) if row.get("F") else ""
        end = excel_date(row["G"]) if row.get("G") else ""
        if not end:
            report.append(f"{where} no end date in the sheet — imported as ongoing (end is optional).")

        ev = {
            "id": stac,
            "name": name,
            "stacName": stac,
            "start": start,
            **({"end": end} if end else {}),
            "hazards": hz,
            "locations": [*(gaz.label(i) for i in places), *free],
        }
        if places:
            ev["places"] = places
            box = gaz.bbox(places)
            if box:
                ev["bbox"] = box
            else:
                report.append(f"{where} places straddle the antimeridian — no bbox derived.")
        ev["layers"] = layers
        ev["externalLayers"] = external
        if has_page:
            ev["page"] = page
        events.append(ev)
        report.append(f"{where} added ({len(layers)} catalog layers, {len(places)} places).")

    print("\n".join(f"- {r}" for r in report))
    if not args.dry_run:
        (DATA / "events.json").write_text(fmt(events) + "\n", encoding="utf-8")
        print(f"\nwrote data/events.json ({len(events)} events)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
