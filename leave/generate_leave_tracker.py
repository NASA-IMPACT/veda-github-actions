#!/usr/bin/env python3
"""Turn a COLOR-CODED leave-tracker .xlsx into normalized leave CSV/JSON + a coverage rollup.

The source workbook is a calendar MATRIX, not a tidy table: each team tab has a person per
row and a day per column, and a person's status on a day is encoded by the CELL FILL COLOR
(the day cells hold no text). Weekends are gray shading; a handful of legend colors map to
leave categories (see COLOR_CATEGORY below). This reads the workbook with the Python standard
library only (`zipfile` + `xml.etree`) — no `openpyxl`, no pip deps — and emits:

  leaves_<slug>.csv          one row per person/day/status
  leaves_<slug>.json         {meta, people:[{slug,name,team,role,leaves:[...]}], warnings}
  leave_coverage_<slug>.json per-team-per-day out counts/%/people (dashboard applies live threshold)
  leave_manifest.json        fixed name: {slug,pi,year,generated,source_file,files,stats}

Inputs (pick one):
  --xlsx FILE       live parse of a real workbook
  --from-json FILE  offline: a pre-parsed {meta, people, warnings} dataset (fixtures/tests)

New/edited people can be layered on via per-person JSON files in --overrides-dir (one file per
person); override records win over xlsx records for the same (person, date). Standard library
only; deterministic ordering for clean diffs.
"""
import argparse
import calendar
import csv
import datetime
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

# ---------------------------------------------------------------- constants / config

# Team tabs that hold people. Everything else (Conferences, Meetings, the LEAVE TEMPLATE
# legend helper) is skipped as data.
SKIP_SHEETS = {"Conferences", "Meetings", "LEAVE TEMPLATE"}

# Fill color (8-char ARGB, upper) -> leave category. Overridable via --colors JSON.
COLOR_CATEGORY = {
    "FFFF0000": "unavailable",        # UNAVAILABLE (headline red)
    "FFF4CCCC": "unavailable",        #   light-red variant
    "FFFFFF00": "limited",            # LIMITED AVAILABILITY (headline yellow)
    "FFFCE5CD": "limited",            #   light-orange variant
    "FFE6B8AF": "holiday",            # Holidays
    "FFD9D2E9": "planned_time_off",   # Planned Time Off
    "FFFFF2CC": "work_travel",        # Work Travel
    "FFD9EAD3": "wfh",                # WFH
    "FFC9DAF8": "other",              # Other (note)
}

# Which categories reduce availability, and by how much (for coverage math).
CATEGORY_META = {
    "unavailable":      {"out": True,  "weight": 1.0},
    "holiday":          {"out": True,  "weight": 1.0},
    "planned_time_off": {"out": True,  "weight": 1.0},
    "limited":          {"out": False, "weight": 0.5},
    "work_travel":      {"out": False, "weight": 0.0},
    "wfh":              {"out": False, "weight": 0.0},
    "other":            {"out": False, "weight": 0.0},
}

# Fills that are NOT a leave signal (weekend/grid shading, plain white/none). Skipped silently.
IGNORE_COLORS = {
    "FF999999",  # weekend shading
    "FFD9D9D9", "FFCCCCCC", "FFB7B7B7",  # grid / header shading
    "FFFFFFFF",  # white / no fill
    "FFA2C4C9", "FFCFE2F3", "FFEAD1DC",  # header accents seen on non-day cells
}

MONTH_NUM = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
MONTH_NUM.update({m.lower(): i for i, m in enumerate(calendar.month_abbr) if m})

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def local(tag):
    """Local tag name, namespace-stripped."""
    return tag.rsplit("}", 1)[-1]


def slugify(text):
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", (text or "").strip()).strip("-").lower()
    return s or "unknown"


def pi_slug(pi):
    """Filename slug from a PI label: 'PI 26.4' or '26.4' -> '26.4'; empty -> 'all'."""
    v = re.sub(r"^(pi|iteration)\s+", "", (pi or "").strip(), flags=re.IGNORECASE)
    v = re.sub(r"[^A-Za-z0-9._-]+", "-", v).strip("-").lower()
    return v or "all"


def pi_year(pi, now, override):
    """Base calendar year: --year wins, else 'PI 26.4' -> 2026, else the year in --now."""
    if override:
        return int(override)
    m = re.search(r"(\d{2})(?:\.\d+)?", pi or "")
    if m:
        return 2000 + int(m.group(1))
    m = re.match(r"(\d{4})", now or "")
    return int(m.group(1)) if m else datetime.date.today().year


# ---------------------------------------------------------------- column / A1 helpers

def col_to_idx(ref):
    """'C' -> 3, 'DJ' -> 114 (1-based)."""
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
    return n


def a1_to_rc(ref):
    """'DD9' -> (row=9, col=108)."""
    letters = "".join(ch for ch in ref if ch.isalpha())
    digits = "".join(ch for ch in ref if ch.isdigit())
    return int(digits), col_to_idx(letters)


# ---------------------------------------------------------------- xlsx low-level readers

def load_shared_strings(z):
    try:
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    out = []
    for si in root.findall(M + "si"):
        out.append("".join(t.text or "" for t in si.iter(M + "t")))
    return out


def load_fill_map(z):
    """Return xf_index -> ARGB hex string (upper) or None, resolving cellXfs -> fills."""
    root = ET.fromstring(z.read("xl/styles.xml"))
    fills = []
    for fill in root.find(M + "fills").findall(M + "fill"):
        pat = fill.find(M + "patternFill")
        rgb = None
        if pat is not None and pat.get("patternType") not in (None, "none"):
            fg = pat.find(M + "fgColor")
            if fg is not None and fg.get("rgb"):
                rgb = fg.get("rgb").upper()
                if len(rgb) == 6:
                    rgb = "FF" + rgb
        fills.append(rgb)
    xf_fill = []
    for xf in root.find(M + "cellXfs").findall(M + "xf"):
        fid = int(xf.get("fillId") or 0)
        xf_fill.append(fills[fid] if fid < len(fills) else None)
    return xf_fill


def sheet_files(z):
    """Ordered [(sheet_name, 'xl/worksheets/sheetN.xml')] via workbook.xml + its rels."""
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid2tgt = {}
    for rel in rels:
        tgt = rel.get("Target")
        if tgt.startswith("/"):
            tgt = tgt[1:]
        if not tgt.startswith("xl/"):
            tgt = "xl/" + tgt
        rid2tgt[rel.get("Id")] = tgt
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    out = []
    for sh in wb.iter(M + "sheet"):
        out.append((sh.get("name"), rid2tgt.get(sh.get(RID))))
    return out


def read_sheet_cells(z, path, strings):
    """path -> {row: {col: (value_str, xf_index)}}."""
    root = ET.fromstring(z.read(path))
    rows = {}
    for row in root.iter(M + "row"):
        rnum = int(row.get("r"))
        cells = {}
        for c in row.findall(M + "c"):
            ci = col_to_idx(c.get("r"))
            s = int(c.get("s") or 0)
            t = c.get("t")
            v = c.find(M + "v")
            isr = c.find(M + "is")
            val = ""
            if t == "s" and v is not None:
                val = strings[int(v.text)]
            elif t == "inlineStr" and isr is not None:
                val = "".join(x.text or "" for x in isr.iter(M + "t"))
            elif v is not None:
                val = v.text or ""
            cells[ci] = (val, s)
        rows[rnum] = cells
    return rows


def read_notes(z, sheet_path):
    """{(row, col): note_text} for a sheet, preferring threaded comments over legacy boilerplate."""
    base = os.path.basename(sheet_path)                       # sheetN.xml
    rels_path = f"xl/worksheets/_rels/{base}.rels"
    try:
        rels = ET.fromstring(z.read(rels_path))
    except KeyError:
        return {}
    threaded, legacy = None, None
    for rel in rels:
        tgt = rel.get("Target", "")
        norm = os.path.normpath(os.path.join("xl/worksheets", tgt)).replace("\\", "/")
        if "threadedComment" in tgt:
            threaded = norm
        elif "comments" in tgt:
            legacy = norm
    notes = {}
    if legacy:
        try:
            root = ET.fromstring(z.read(legacy))
            for cm in root.iter(M + "comment"):
                txt = "".join(t.text or "" for t in cm.iter(M + "t")).strip()
                if txt and not txt.startswith("[Threaded comment]"):
                    notes[a1_to_rc(cm.get("ref"))] = txt
        except KeyError:
            pass
    if threaded:
        try:
            root = ET.fromstring(z.read(threaded))
            for tc in root.iter():
                if local(tc.tag) != "threadedComment":
                    continue
                ref = tc.get("ref")
                txt = "".join(el.text or "" for el in tc if local(el.tag) == "text").strip()
                if ref and txt:
                    notes[a1_to_rc(ref)] = txt          # threaded wins over legacy
        except KeyError:
            pass
    return notes


# ---------------------------------------------------------------- date header reconstruction

def build_calendar(rows, base_year):
    """From the header rows build {col: {date, weekday, sprint}} for each day column.

    Finds the 'Date' row dynamically (col A == 'Date'); month labels (row above) are sparse
    and carried forward; the year rolls over when the month number decreases (Dec->Jan)."""
    date_row = next((r for r, cells in rows.items()
                     if (cells.get(1, ("", 0))[0] or "").strip().lower() == "date"), 5)
    month_row, sprint_row = date_row - 1, date_row - 2
    day_cells = rows.get(date_row, {})
    month_cells = rows.get(month_row, {})
    sprint_cells = rows.get(sprint_row, {})

    cal = {}
    cur_sprint = None
    year = base_year
    mnum = None                 # seeded from the first month label; advanced on day wrap
    prev_day = None
    for ci in sorted(day_cells):
        if ci < 2:
            continue
        raw = (day_cells[ci][0] or "").strip()
        if not raw:
            continue
        try:
            day = int(round(float(raw)))
        except ValueError:
            continue
        # Month labels (row above) are sparse and can lag a day or two behind the actual
        # month boundary (a weekend under the previous month's merged label). So seed the
        # month from the first label, then advance whenever the DAY NUMBER decreases.
        mlabel = (month_cells.get(ci, ("", 0))[0] or "").strip()
        if mlabel and MONTH_NUM.get(mlabel.lower()):
            if mnum is None:
                mnum = MONTH_NUM[mlabel.lower()]
        if mnum is None:
            continue
        if prev_day is not None and day < prev_day:
            mnum += 1
            if mnum > 12:
                mnum, year = 1, year + 1
        prev_day = day
        slabel = (sprint_cells.get(ci, ("", 0))[0] or "").strip().strip('"')
        if slabel:
            cur_sprint = slabel
        try:
            d = datetime.date(year, mnum, day)
        except ValueError:
            continue
        cal[ci] = {"date": d.isoformat(), "weekday": d.strftime("%a"),
                   "iso_week": d.isocalendar()[1], "sprint": cur_sprint,
                   "data_start": date_row + 2}
    data_start = date_row + 2
    return cal, data_start


# ---------------------------------------------------------------- parse a workbook -> dataset

def parse_xlsx(path, teams_filter, color_map, base_year):
    z = zipfile.ZipFile(path)
    strings = load_shared_strings(z)
    xf_fill = load_fill_map(z)
    people = []
    warnings = []
    all_dates = []

    for name, spath in sheet_files(z):
        if name in SKIP_SHEETS or not spath:
            continue
        if teams_filter and name not in teams_filter:
            continue
        rows = read_sheet_cells(z, spath, strings)
        notes = read_notes(z, spath)
        cal, data_start = build_calendar(rows, base_year)
        all_dates.extend(info["date"] for info in cal.values())

        for rnum in sorted(r for r in rows if r >= data_start):
            cells = rows[rnum]
            raw_name = (cells.get(1, ("", 0))[0] or "")
            person = raw_name.strip()
            if not person:
                continue
            role = (cells.get(2, ("", 0))[0] or "").strip()
            leaves = []
            for ci, info in cal.items():
                val, s = cells.get(ci, ("", 0))
                color = xf_fill[s] if s < len(xf_fill) else None
                if not color or color in IGNORE_COLORS:
                    continue
                cat = color_map.get(color)
                if not cat:
                    warnings.append(f"unmapped fill {color} at {name}!r{rnum}c{ci} ({person})")
                    continue
                meta = CATEGORY_META[cat]
                leaves.append({
                    "date": info["date"], "status": cat,
                    "out": meta["out"], "weight": meta["weight"],
                    "note": notes.get((rnum, ci)), "source": "xlsx",
                })
            leaves.sort(key=lambda l: l["date"])
            people.append({"slug": slugify(person), "name": person, "team": name,
                           "role": role, "leaves": leaves})

    span = {"start": min(all_dates), "end": max(all_dates)} if all_dates else {"start": "", "end": ""}
    teams = sorted({p["team"] for p in people})
    return {"people": people, "warnings": warnings, "teams": teams, "span": span}


# ---------------------------------------------------------------- overrides

def expand_entry(entry, include_weekends=False):
    """One override entry -> list of {date, status} (inclusive start..end, or a single date)."""
    status = entry.get("status", "unavailable")
    out = []
    if entry.get("date"):
        days = [entry["date"]]
    else:
        start = datetime.date.fromisoformat(entry["start"])
        end = datetime.date.fromisoformat(entry.get("end", entry["start"]))
        days = []
        d = start
        while d <= end:
            if include_weekends or d.weekday() < 5:
                days.append(d.isoformat())
            d += datetime.timedelta(days=1)
    for iso in days:
        out.append({"date": iso, "status": status, "note": entry.get("note")})
    return out


def merge_person_override(dataset, by_slug, known_statuses, ov, fn):
    """Apply one person's override dict onto the dataset (new person, or edited dates)."""
    slug = ov.get("slug") or slugify(ov.get("person", ""))
    person = by_slug.get(slug)
    if person is None:
        person = {"slug": slug, "name": ov.get("person", slug),
                  "team": ov.get("team", "Overrides"), "role": ov.get("role", ""),
                  "leaves": []}
        by_slug[slug] = person
        dataset["people"].append(person)
    if ov.get("team"):
        person["team"] = ov["team"]
    if ov.get("role"):
        person["role"] = ov["role"]
    touched = set()
    new_records = []
    for entry in ov.get("entries", []):
        for rec in expand_entry(entry, ov.get("include_weekends", False)):
            if rec["status"] not in known_statuses:
                dataset["warnings"].append(
                    f"override {fn}: unknown status {rec['status']!r} on {rec['date']}")
                continue
            touched.add(rec["date"])
            if rec["status"] == "available":
                continue                                       # tombstone: just clears xlsx record
            meta = CATEGORY_META[rec["status"]]
            new_records.append({"date": rec["date"], "status": rec["status"],
                                "out": meta["out"], "weight": meta["weight"],
                                "note": rec["note"], "source": "override"})
    # Override wins per (person, date): drop xlsx records for any touched date, then add.
    person["leaves"] = [l for l in person["leaves"] if l["date"] not in touched]
    person["leaves"].extend(new_records)
    person["leaves"].sort(key=lambda l: l["date"])


def apply_overrides(dataset, overrides_dir, color_map):
    if not overrides_dir or not os.path.isdir(overrides_dir):
        return
    by_slug = {p["slug"]: p for p in dataset["people"]}
    known_statuses = set(CATEGORY_META) | {"available"}
    for fn in sorted(os.listdir(overrides_dir)):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(overrides_dir, fn), encoding="utf-8") as fh:
            doc = json.load(fh)
        # A file may hold a single person, a list of people, or {"people": [...]} — so one
        # PR can add several people at once.
        if isinstance(doc, list):
            people = doc
        elif isinstance(doc, dict) and isinstance(doc.get("people"), list):
            people = doc["people"]
        else:
            people = [doc]
        for ov in people:
            merge_person_override(dataset, by_slug, known_statuses, ov, fn)
    dataset["teams"] = sorted({p["team"] for p in dataset["people"]})


# ---------------------------------------------------------------- coverage rollup

def build_coverage(people):
    """Per-team-per-day: out_count (fully out), out_weight (limited=0.5), out_pct, people lists."""
    team_size = {}
    for p in people:
        team_size.setdefault(p["team"], set()).add(p["slug"])
    team_size = {t: len(s) for t, s in team_size.items()}

    # (team, date) -> {slug -> max weight that day, and whether fully out}
    day = {}
    for p in people:
        best = {}
        for l in p["leaves"]:
            key = (p["team"], l["date"])
            cur = best.get((key, p["slug"]), (0.0, False))
            best[(key, p["slug"])] = (max(cur[0], l["weight"]), cur[1] or l["out"])
        for (key, slug), (w, is_out) in best.items():
            day.setdefault(key, {})[slug] = (w, is_out)

    rows = []
    for (team, date), members in day.items():
        out_people = sorted(s for s, (w, o) in members.items() if o)
        limited = sorted(s for s, (w, o) in members.items() if not o and w > 0)
        out_weight = round(sum(w for w, o in members.values()), 3)
        size = team_size.get(team, 1) or 1
        rows.append({"date": date, "team": team, "team_size": size,
                     "out_count": len(out_people),
                     "out_weight": out_weight,
                     "out_pct": round(out_weight / size, 4),
                     "people_out": out_people, "limited": limited})
    rows.sort(key=lambda r: (r["date"], r["team"]))
    return team_size, rows


# ---------------------------------------------------------------- emit

def category_legend(color_map):
    color_of = {}
    for color, cat in color_map.items():
        color_of.setdefault(cat, color)
    return {cat: {"color": color_of.get(cat), **meta} for cat, meta in CATEGORY_META.items()}


def write_outputs(dataset, args, slug, year):
    os.makedirs(args.out_dir, exist_ok=True)
    people = sorted(dataset["people"], key=lambda p: (p["team"], p["slug"]))
    team_size, coverage = build_coverage(people)

    files = {"csv": f"leaves_{slug}.csv", "json": f"leaves_{slug}.json",
             "coverage": f"leave_coverage_{slug}.json"}

    # CSV: one row per person/day/status.
    csv_rows = 0
    with open(os.path.join(args.out_dir, files["csv"]), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["team", "person", "person_slug", "role", "date", "weekday", "iso_week",
                    "status", "out", "out_weight", "note", "source"])
        for p in people:
            for l in p["leaves"]:
                d = datetime.date.fromisoformat(l["date"])
                w.writerow([p["team"], p["name"], p["slug"], p["role"], l["date"],
                            d.strftime("%a"), d.isocalendar()[1], l["status"],
                            "true" if l["out"] else "false", l["weight"],
                            l["note"] or "", l["source"]])
                csv_rows += 1

    meta = {"pi": args.pi, "year": year, "generated": args.now,
            "source_file": os.path.basename(args.xlsx or args.from_json or ""),
            "span": dataset["span"], "teams": dataset["teams"],
            "team_size": team_size, "risk_threshold_default": args.risk_threshold,
            "categories": category_legend(_active_color_map(args))}
    leaves_doc = {"meta": meta, "people": people, "warnings": dataset["warnings"]}
    with open(os.path.join(args.out_dir, files["json"]), "w", encoding="utf-8") as fh:
        json.dump(leaves_doc, fh, indent=2)
    with open(os.path.join(args.out_dir, files["coverage"]), "w", encoding="utf-8") as fh:
        json.dump({"team_size": team_size, "days": coverage,
                   "risk_threshold_default": args.risk_threshold}, fh, indent=2)

    leave_days = sum(1 for p in people for l in p["leaves"] if l["out"])
    manifest = {"slug": slug, "pi": args.pi, "year": year, "generated": args.now,
                "source_file": meta["source_file"], "files": files,
                "stats": {"people": len(people), "teams": len(dataset["teams"]),
                          "leave_days": leave_days, "csv_rows": csv_rows,
                          "span_start": dataset["span"]["start"],
                          "span_end": dataset["span"]["end"],
                          "warnings": len(dataset["warnings"])}}
    with open(os.path.join(args.out_dir, "leave_manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    return manifest


# ---------------------------------------------------------------- color map override

def _active_color_map(args):
    if getattr(args, "_color_map", None) is None:
        cmap = dict(COLOR_CATEGORY)
        if args.colors and os.path.isfile(args.colors):
            with open(args.colors, encoding="utf-8") as fh:
                for k, v in json.load(fh).items():
                    cmap[k.upper()] = v
        args._color_map = cmap
    return args._color_map


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--xlsx", help="live: path to the leave-tracker .xlsx")
    ap.add_argument("--from-json", dest="from_json", help="offline: pre-parsed {meta,people,warnings}")
    ap.add_argument("--pi", default="", help="PI label, e.g. '26.4' (drives slug + year)")
    ap.add_argument("--year", default="", help="override the inferred calendar year")
    ap.add_argument("--teams", default="", help="comma list of team tabs (empty = all non-skip)")
    ap.add_argument("--overrides-dir", default="", help="dir of per-person override JSON files")
    ap.add_argument("--colors", default="", help="JSON color->category overrides")
    ap.add_argument("--risk-threshold", type=float, default=0.30, help="default %% OUT to flag (0-1)")
    ap.add_argument("--out-dir", default="reports")
    ap.add_argument("--now", default="unknown")
    args = ap.parse_args()
    args._color_map = None

    if not args.xlsx and not args.from_json:
        ap.error("one of --xlsx or --from-json is required")

    # Reproducible: with no --pi, infer it from the xlsx filename ("… 26.4.xlsx" -> "26.4"), so
    # the workflow needs no inputs and a new PI is picked up just by dropping a new workbook.
    if not args.pi and args.xlsx:
        m = re.search(r"(\d{2}\.\d+)", os.path.basename(args.xlsx))
        if m:
            args.pi = m.group(1)

    year = pi_year(args.pi, args.now, args.year)
    color_map = _active_color_map(args)

    if args.xlsx:
        teams_filter = {t.strip() for t in args.teams.split(",") if t.strip()}
        dataset = parse_xlsx(args.xlsx, teams_filter, color_map, year)
    else:
        with open(args.from_json, encoding="utf-8") as fh:
            loaded = json.load(fh)
        dataset = {"people": loaded.get("people", []),
                   "warnings": loaded.get("warnings", []),
                   "teams": sorted({p["team"] for p in loaded.get("people", [])}),
                   "span": loaded.get("meta", {}).get("span")
                           or loaded.get("span", {"start": "", "end": ""})}

    apply_overrides(dataset, args.overrides_dir, color_map)

    slug = pi_slug(args.pi)
    manifest = write_outputs(dataset, args, slug, year)

    s = manifest["stats"]
    print(f"leave-tracker: {s['people']} people · {s['teams']} teams · "
          f"{s['leave_days']} out-days · {s['span_start']}→{s['span_end']} "
          f"({s['warnings']} warnings)", file=sys.stderr)
    if dataset["warnings"]:
        for wmsg in dataset["warnings"][:20]:
            print("  warn:", wmsg, file=sys.stderr)


if __name__ == "__main__":
    main()
