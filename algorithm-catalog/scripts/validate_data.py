#!/usr/bin/env python3
"""Validate the Algorithm Catalog data against THE STANDARD.

Two jobs in one script:

1. **Mirror `src/rules.ts` 1:1** — the naming standard (`YYYYMM_Hazard_Location`), ISO date shape,
   bbox rules, hazard vocabulary. The TS copy runs in the browser while a responder types; this
   copy runs in CI over what actually got committed. `scripts/rules_parity_test.py` proves the two
   copies still agree, so they cannot silently drift.
2. **Structural + referential checks the browser cannot do** — duplicate ids, dangling
   algorithm/product/hazard references, missing thumbnail files, unparseable JSON.

stdlib only (no pip deps) — house rule: this runs in CI with no install step.

Run:
    python3 algorithm-catalog/scripts/validate_data.py
    python3 algorithm-catalog/scripts/validate_data.py --json
    python3 algorithm-catalog/scripts/validate_data.py --quiet

Exit 0 when clean (warnings are allowed), 1 when any ERROR is found.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Anchor every path off this file, never off the cwd — CI, Netlify and humans all run it from
# somewhere different.
ROOT = Path(__file__).resolve().parent.parent  # algorithm-catalog/
DATA = ROOT / "data"
PUBLIC = ROOT / "public"

# =================================================================================================
# THE STANDARD — mirrored 1:1 from src/rules.ts.
#
# The pattern SOURCE TEXT below is kept character-identical to the JavaScript literals so that
# rules_parity_test.py can compare the two files' constants literally (no JS engine needed).
# If you edit a rule here you MUST edit src/rules.ts too; the parity test fails otherwise.
# =================================================================================================

#: YYYYMM_Hazard_Location — EXACTLY three parts, so exactly two underscores.
#:
#: DELIBERATELY STRICTER THAN UPSTREAM. dps/_validate.sh:29-36 uses
#:     ^[0-9]{4}(0[1-9]|1[0-2])_[^_]+_.+$
#: whose final `.+` lets the LOCATION slot swallow extra underscores. That accepts
#: `202501_Tropical_Cyclone_CA` — which looks right but silently parses as hazard=`Tropical`,
#: location=`Cyclone_CA`, and then writes a GeoTIFF `HAZARD` tag of "Tropical". It also accepts
#: `202501_Flood_CA_extra` (an explicit upstream pass case, see
#: tests/integration/test_dps_validate.sh:41-48).
#:
#: The catalog rejects both: the third slot is `[^_]+` too. This is the safe direction to diverge —
#: every name WE accept, DPS also accepts. We only refuse some names DPS would have taken, and
#: those are precisely the ones that mis-slot the hazard. Multi-word hazards and locations must be
#: CamelCase: 202604_TropicalCyclone_Guam, not 202604_Tropical_Cyclone_Guam.
STAC_EVENT_RE = r'^[0-9]{4}(0[1-9]|1[0-2])_[^_]+_[^_]+$'

#: Exactly three underscore-separated slots: YYYYMM, Hazard, Location.
STAC_PART_COUNT = 3

#: The literal placeholder the upstream configs ship with. Rejected at run time.
STAC_PLACEHOLDER = "YYYYMM_Hazard_Location"

#: dps/_validate.sh:61-76 — validate_date_not_before() date shape.
ISO_DATE_RE = r'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'

#: dps/_validate.sh:118-143 — validate_bbox(). blackmarble.crs rejects a thinner box.
BBOX_MIN_LAT_SPAN = 0.05

#: A worked example to show the user in every error message about the event name.
STAC_EXAMPLE = "202511_Flood_TX"

#: Optional scene selectors. Sentinel-2 MGRS tile (sentinel2's `tile` input), e.g. T17RLN.
#: Landsat WRS-2 path/row (landsat's `process_tile` input), e.g. 171035. Only a non-empty,
#: malformed value is an error — both fields are optional.
MGRS_TILE_RE = r'^T[0-9]{2}[A-Z]{3}$'
WRS2_TILE_RE = r'^[0-9]{6}$'

_STAC_EVENT = re.compile(STAC_EVENT_RE)
_ISO_DATE = re.compile(ISO_DATE_RE)
_YEARMONTH = re.compile(r'^[0-9]{6}$')
_MONTH = re.compile(r'^(0[1-9]|1[0-2])$')
_BBOX_NUMBER = re.compile(r'^[-+]?[0-9]*\.?[0-9]+$')
_BBOX_SPLIT = re.compile(r'[,\s]+')


def matches(rx: re.Pattern, v: str) -> bool:
    """`RegExp.test()` semantics for an anchored pattern.

    WHY: Python's `$` also matches just *before* a trailing newline, JavaScript's (without /m)
    does not. Rejecting any value that contains a newline makes the two engines agree on every
    pattern in this file, without having to alter the shared pattern text.
    """
    return "\n" not in v and rx.search(v) is not None


# -------------------------------------------------------------------------------------------------
# Violation type (mirrors the TS `Violation` interface)
# -------------------------------------------------------------------------------------------------

ERROR = "error"
WARNING = "warning"


@dataclass(frozen=True)
class Violation:
    field: str
    rule: str
    severity: str
    message: str


def _err(field: str, rule: str, message: str) -> Violation:
    return Violation(field, rule, ERROR, message)


def _warn(field: str, rule: str, message: str) -> Violation:
    return Violation(field, rule, WARNING, message)


# -------------------------------------------------------------------------------------------------
# Individual rules (mirrors of the exported TS functions, same names in snake_case)
# -------------------------------------------------------------------------------------------------


def parse_stac_name(v: str) -> dict[str, str] | None:
    """Split a STAC event name into its three slots, or None if it isn't exactly three.

    Note this does NOT mirror upstream cog_metadata.parse_activation_event(), which does a
    `split('_', 2)` so LOCATION absorbs every trailing underscore. That absorption is the bug we
    are closing — see STAC_EVENT_RE.
    """
    parts = v.split("_")
    if len(parts) != STAC_PART_COUNT:
        return None
    return {"yearMonth": parts[0], "hazard": parts[1], "location": parts[2]}


def check_stac_name(
    value: str,
    hazards: list[dict[str, Any]] | None = None,
    selected: list[str] | None = None,
) -> list[Violation]:
    """The headline check: STAC metadata event name must be YYYYMM_Hazard_Location.

    `hazards` (optional) enables the soft cross-check that the token matches the hazards selected
    on the form — the regex permits any token, but a mismatch is nearly always a mistake.
    """
    hazards = hazards or []
    selected = selected or []
    v = value.strip()
    out: list[Violation] = []

    if not v:
        out.append(_err("stacName", "required", "STAC metadata event name is required."))
        return out
    if v == STAC_PLACEHOLDER:
        out.append(
            _err(
                "stacName",
                "placeholder",
                f'"{STAC_PLACEHOLDER}" is the placeholder value and is rejected at run time. '
                f"Set a real event, e.g. {STAC_EXAMPLE}.",
            )
        )
        return out
    if not matches(_STAC_EVENT, v):
        # Say precisely which part is wrong — a bare "doesn't match" is useless to a responder.
        # Underscore count is checked FIRST and reported on its own, because it is the mistake
        # people actually make (writing a multi-word hazard or location in full).
        parts = v.split("_")
        underscores = len(parts) - 1

        if underscores < 2:
            out.append(
                _err(
                    "stacName",
                    "underscore-count",
                    f"Needs exactly 2 underscores (YYYYMM_Hazard_Location) — found {underscores}. "
                    f"Example: {STAC_EXAMPLE}.",
                )
            )
        elif underscores > 2:
            # The dangerous one. Show them what it would silently be read as.
            location = "_".join(parts[2:])
            out.append(
                _err(
                    "stacName",
                    "underscore-count",
                    f"Needs exactly 2 underscores (YYYYMM_Hazard_Location) — found {underscores}. "
                    f'"{v}" would be read as hazard "{parts[1]}", location "{location}". '
                    f"Run multi-word names together in CamelCase, e.g. {STAC_EXAMPLE} or "
                    f"202604_TropicalCyclone_Guam.",
                )
            )
        elif not matches(_YEARMONTH, parts[0]):
            out.append(_err("stacName", "yearmonth", f'"{parts[0]}" must be a 6-digit YYYYMM, e.g. 202511.'))
        elif not matches(_MONTH, parts[0][4:]):
            out.append(
                _err("stacName", "month", f'Month "{parts[0][4:]}" is not 01-12. Example: {STAC_EXAMPLE}.')
            )
        else:
            out.append(_err("stacName", "format", f"Must be YYYYMM_Hazard_Location, e.g. {STAC_EXAMPLE}."))
        return out

    parsed = parse_stac_name(v)
    assert parsed is not None  # structurally guaranteed past the regex
    hazard = parsed["hazard"]

    if hazards:
        low = hazard.lower()

        def _is(h: dict[str, Any]) -> bool:
            token = h.get("token") if isinstance(h.get("token"), str) else ""
            aliases = h.get("aliases") if isinstance(h.get("aliases"), list) else []
            return token.lower() == low or any(isinstance(a, str) and a.lower() == low for a in aliases)

        match = next((h for h in hazards if _is(h)), None)
        if match is None:
            known = ", ".join(str(h.get("token", "")) for h in hazards)
            out.append(
                _warn(
                    "stacName",
                    "hazard-vocabulary",
                    f'Hazard token "{hazard}" is not in the controlled vocabulary. Known tokens: {known}.',
                )
            )
        elif selected and match.get("id") not in selected:
            out.append(
                _warn(
                    "stacName",
                    "hazard-mismatch",
                    f'Event name says "{hazard}" but that hazard is not selected below.',
                )
            )

    return out


def check_dates(start: str, end: str) -> list[Violation]:
    """ISO shape + ordering. Upstream only checks shape; start<=end is our own catalog invariant."""
    out: list[Violation] = []
    if not start:
        out.append(_err("start", "required", "Start date is required."))
    elif not matches(_ISO_DATE, start):
        out.append(_err("start", "format", f'Start date "{start}" must be YYYY-MM-DD.'))

    if not end:
        out.append(_err("end", "required", "End date is required."))
    elif not matches(_ISO_DATE, end):
        out.append(_err("end", "format", f'End date "{end}" must be YYYY-MM-DD.'))

    if start and end and matches(_ISO_DATE, start) and matches(_ISO_DATE, end) and start > end:
        out.append(_err("end", "order", f"End date {end} is before start date {start}."))
    return out


def check_bbox(value: str) -> list[Violation]:
    """dps/_validate.sh:118-143 — validate_bbox(), rule for rule. Empty is allowed (bbox is optional)."""
    v = value.strip()
    if not v:
        return []
    parts = [p for p in _BBOX_SPLIT.split(v) if p]
    if len(parts) != 4:
        return [
            _err(
                "bbox",
                "count",
                f'Bounding box needs exactly 4 numbers "min_lon,min_lat,max_lon,max_lat"; got {len(parts)}.',
            )
        ]
    if not all(matches(_BBOX_NUMBER, p) for p in parts):
        return [
            _err(
                "bbox",
                "numeric",
                'Bounding box must be four numbers "min_lon,min_lat,max_lon,max_lat" (WGS84).',
            )
        ]
    min_lon, min_lat, max_lon, max_lat = (float(p) for p in parts)
    out: list[Violation] = []
    if min_lon < -180 or max_lon > 180 or min_lat < -90 or max_lat > 90:
        out.append(_err("bbox", "range", "Bounding box is out of range (lon in [-180,180], lat in [-90,90])."))
        return out
    if min_lon >= max_lon or min_lat >= max_lat:
        out.append(_err("bbox", "order", "Bounding box needs min_lon<max_lon and min_lat<max_lat."))
        return out
    if max_lat - min_lat < BBOX_MIN_LAT_SPAN:
        out.append(
            _err(
                "bbox",
                "lat-span",
                f"Bounding box latitude span is < {BBOX_MIN_LAT_SPAN}°; widen it "
                f"(Black Marble needs a taller box).",
            )
        )
    return out


def check_hazards(selected: list[str], vocabulary: list[dict[str, Any]]) -> list[Violation]:
    out: list[Violation] = []
    if not selected:
        out.append(_err("hazards", "required", "Select at least one hazard type."))
        return out
    ids = {h.get("id") for h in vocabulary}
    for h in selected:
        if h not in ids:
            out.append(_err("hazards", "vocabulary", f'"{h}" is not a known hazard type.'))
        if "_" in h:
            out.append(_err("hazards", "underscore", f'Hazard "{h}" must not contain an underscore.'))
    return out


def check_locations(locations: list[str]) -> list[Violation]:
    clean = [l.strip() for l in locations if l.strip()]
    if not clean:
        return [_err("locations", "required", "Add at least one location, e.g. Los Angeles, CA.")]
    return []


def check_name(name: str) -> list[Violation]:
    if not name.strip():
        return [
            _err(
                "name",
                "required",
                "Activation event name is required — this is the human-readable name shown on the "
                "website, e.g. California Wildfires January 2025.",
            )
        ]
    return []


def check_products(products: list[dict[str, str]]) -> list[Violation]:
    if not products:
        return [_err("products", "required", "Select at least one product to generate.")]
    return []


def validate_request(r: dict[str, Any], vocabulary: list[dict[str, Any]]) -> list[Violation]:
    """Whole-request validation — the Python side of what gates the "Open PR" button."""
    return [
        *check_name(_s(r, "name")),
        *check_stac_name(_s(r, "stacName"), vocabulary, _strs(r, "hazards")),
        *check_dates(_s(r, "start"), _s(r, "end")),
        *check_hazards(_strs(r, "hazards"), vocabulary),
        *check_locations(_strs(r, "locations")),
        *check_bbox(_s(r, "bbox")),
        *check_products(_dicts(r, "products")),
    ]


# =================================================================================================
# Catalog validation — structure, references, files on disk
# =================================================================================================

# An Algorithm's `products` and a request's `products` are different shapes that share a field name,
# so the algorithm-side checks pass this example explicitly instead of using the table below.
ALGORITHM_PRODUCT_EXAMPLE = (
    '"products": [{"id": "swir", "label": "Shortwave Infrared", "folder": "shortwaveInfrared", "hazards": ["fire"]}]'
)

# A "valid example" to show next to every violation, keyed "<field>.<rule>" then "<field>".
RULE_EXAMPLES = {
    "stacName": STAC_EXAMPLE,
    "id.event-id-mismatch": f'"id": "{STAC_EXAMPLE}"  (id must equal stacName)',
    "id.duplicate": '"id": "sentinel2"  (used exactly once)',
    "id": '"id": "sentinel2"',
    "token": '"token": "TropicalCyclone"  (CamelCase, no underscore)',
    "name": '"name": "California Wildfires January 2025"',
    "start": '"start": "2025-01-07"',
    "end": '"end": "2025-01-31"',
    "bbox": '"bbox": "-118.9,33.6,-117.6,34.4"',
    "hazards": '"hazards": ["fire", "flood"]',
    "locations": '"locations": ["Los Angeles, CA"]',
    "products": '"products": [{"algorithm": "sentinel2", "product": "swir"}]',
    "layers": '"layers": [{"algorithm": "sentinel2", "product": "swir"}]',
    "thumb": '"thumb": "/thumbs/sentinel2.png"  (file at public/thumbs/sentinel2.png)',
    "temporalStart": '"temporalStart": "2015-06-23"',
    "kind": '"kind": "algorithm-request"',
    "ts": '"ts": "2025-01-08T17:04:11.284Z"',
    "<file>": "a JSON array of records, e.g. []",
}


def example_for(field: str, rule: str) -> str:
    return RULE_EXAMPLES.get(f"{field}.{rule}") or RULE_EXAMPLES.get(field) or ""


@dataclass
class Finding:
    file: str  # path relative to algorithm-catalog/
    where: str  # which record inside that file
    field: str
    rule: str
    severity: str
    message: str
    example: str

    def as_dict(self) -> dict[str, str]:
        return {
            "file": self.file,
            "where": self.where,
            "field": self.field,
            "rule": self.rule,
            "severity": self.severity,
            "message": self.message,
            "example": self.example,
        }


class Report:
    def __init__(self) -> None:
        self.findings: list[Finding] = []

    def add(self, file: str, where: str, v: Violation, example: str = "") -> None:
        self.findings.append(
            Finding(file, where, v.field, v.rule, v.severity, v.message, example or example_for(v.field, v.rule))
        )

    def error(self, file: str, where: str, field: str, rule: str, message: str, example: str = "") -> None:
        self.add(file, where, _err(field, rule, message), example)

    def warn(self, file: str, where: str, field: str, rule: str, message: str, example: str = "") -> None:
        self.add(file, where, _warn(field, rule, message), example)

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == ERROR]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == WARNING]


# --- tolerant field readers -----------------------------------------------------------------------
# WHY: a value of the wrong JSON type degrades to empty here so the ordinary required/format rule
# fires with a message that names the field, instead of the script dying on a TypeError.


def _s(rec: dict[str, Any], key: str) -> str:
    v = rec.get(key)
    return v if isinstance(v, str) else ""


def _strs(rec: dict[str, Any], key: str) -> list[str]:
    v = rec.get(key)
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def _dicts(rec: dict[str, Any], key: str) -> list[dict[str, Any]]:
    v = rec.get(key)
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _obj(rec: dict[str, Any], key: str) -> dict[str, Any]:
    v = rec.get(key)
    return v if isinstance(v, dict) else {}


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


# --- loading --------------------------------------------------------------------------------------


def scan_data_dir(rep: Report) -> dict[str, Any]:
    """Parse every *.json under data/. Returns {relative path: parsed}; unparseable files are
    reported and omitted."""
    parsed: dict[str, Any] = {}
    if not DATA.is_dir():
        rep.error("data/", "-", "<dir>", "missing-dir", f"No data directory at {DATA}.", "algorithm-catalog/data/")
        return parsed
    for path in sorted(DATA.rglob("*")):
        if path.is_dir():
            continue
        name = rel(path)
        if path.suffix != ".json":
            if path.name != ".gitkeep":
                rep.warn(name, "-", "<file>", "not-json", "Unexpected non-JSON file under data/.", "*.json")
            continue
        try:
            parsed[name] = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            rep.error(name, "-", "<file>", "json-parse", f"Invalid JSON: {e.msg} (line {e.lineno}, column {e.colno}).")
        except OSError as e:
            rep.error(name, "-", "<file>", "unreadable", f"Could not read the file: {e}.")
    return parsed


def records(parsed: dict[str, Any], name: str, rep: Report, required: bool = True) -> list[dict[str, Any]]:
    """Pull one dataset out of the parse cache as a list of dicts, reporting anything else."""
    if name not in parsed:
        if (ROOT / name).exists():
            return []  # already reported as a parse error by scan_data_dir
        if required:
            rep.error(name, "-", "<file>", "missing-file", f"Expected data file is missing: {ROOT / name}.")
        return []
    value = parsed[name]
    if not isinstance(value, list):
        rep.error(name, "-", "<file>", "shape", f"Must be a JSON array; got {type(value).__name__}.")
        return []
    out: list[dict[str, Any]] = []
    for i, item in enumerate(value):
        if isinstance(item, dict):
            out.append(item)
        else:
            rep.error(name, f"[{i}]", "<record>", "shape", f"Entry must be an object; got {type(item).__name__}.")
    return out


def dup_check(rep: Report, file: str, recs: list[dict[str, Any]], key: str, label: str) -> None:
    seen: dict[str, int] = {}
    for i, r in enumerate(recs):
        v = _s(r, key)
        if not v:
            rep.error(file, f"[{i}]", key, "required", f"{label} is missing a {key}.")
            continue
        if v in seen:
            rep.error(file, f"[{i}] {key}={v}", key, "duplicate", f'Duplicate {label} {key} "{v}" (first seen at [{seen[v]}]).')
        else:
            seen[v] = i


# --- per-dataset checks ---------------------------------------------------------------------------


def check_hazard_vocabulary(rep: Report, hazards: list[dict[str, Any]]) -> None:
    file = "data/hazards.json"
    dup_check(rep, file, hazards, "id", "Hazard")
    dup_check(rep, file, hazards, "token", "Hazard")
    for i, h in enumerate(hazards):
        where = f"[{i}] id={_s(h, 'id') or '?'}"
        token = _s(h, "token")
        # types.ts: the token goes in slot 2 of a STAC name, which upstream matches with [^_]+.
        if token and "_" in token:
            rep.error(
                file, where, "token", "underscore",
                f'Hazard token "{token}" must not contain an underscore — use CamelCase, e.g. TropicalCyclone.',
            )
        if _s(h, "id") and "_" in _s(h, "id"):
            rep.error(file, where, "id", "underscore", f'Hazard id "{_s(h, "id")}" must not contain an underscore.')


def check_algorithms(rep: Report, algorithms: list[dict[str, Any]], hazard_ids: set[str]) -> None:
    file = "data/algorithms.json"
    dup_check(rep, file, algorithms, "id", "Algorithm")
    for i, a in enumerate(algorithms):
        aid = _s(a, "id")
        where = f"[{i}] id={aid or '?'}"

        start = _s(a, "temporalStart")
        if not start:
            rep.error(file, where, "temporalStart", "required", "temporalStart is required (YYYY-MM-DD).")
        elif not matches(_ISO_DATE, start):
            rep.error(file, where, "temporalStart", "format", f'temporalStart "{start}" must be YYYY-MM-DD.')

        thumb = _s(a, "thumb")
        if not thumb:
            rep.error(file, where, "thumb", "required", "thumb is required.")
        else:
            # thumb is a site-absolute URL ("/thumbs/x.png") served out of public/.
            on_disk = PUBLIC / thumb.lstrip("/")
            if not on_disk.is_file():
                rep.error(
                    file, where, "thumb", "missing-file",
                    f'thumb "{thumb}" has no file at {rel(on_disk)}.',
                )

        products = _dicts(a, "products")
        # A "utility" algorithm (list_dates) is a DISCOVERY tool — it lists what a vendor bucket
        # holds and writes a CSV, it generates no COG — so an empty products array is correct data
        # for it and only for it. Anything else with no products can never be requested.
        if not products and _s(a, "modality") != "utility":
            rep.error(
                file, where, "products", "required",
                'Algorithm declares no products, so nothing can be requested from it. '
                'Only modality "utility" may have an empty products array.',
                example=ALGORITHM_PRODUCT_EXAMPLE,
            )
        for p in products:
            pid = _s(p, "id")
            pwhere = f"{where} product={pid or '?'}"
            if not pid:
                rep.error(file, pwhere, "products", "required", "Product is missing an id.",
                          example=ALGORITHM_PRODUCT_EXAMPLE)
            for hz in _strs(p, "hazards"):
                if hz not in hazard_ids:
                    rep.error(
                        file, pwhere, "hazards", "vocabulary",
                        f'Product hazard "{hz}" is not a hazard id in data/hazards.json.',
                    )
            # primaryHazards drives the Submit form's auto-selection and MUST be a subset of
            # hazards — otherwise the form would propose a product for a hazard the catalog's
            # own filter says it isn't suited to, and the two views would disagree.
            broad = set(_strs(p, "hazards"))
            for hz in _strs(p, "primaryHazards"):
                if hz not in hazard_ids:
                    rep.error(
                        file, pwhere, "primaryHazards", "vocabulary",
                        f'Product primaryHazard "{hz}" is not a hazard id in data/hazards.json.',
                    )
                elif hz not in broad:
                    rep.error(
                        file, pwhere, "primaryHazards", "not-a-subset",
                        f'Product primaryHazard "{hz}" is not listed in the same product\'s '
                        f'"hazards". primaryHazards must always be a subset of hazards.',
                    )


def check_events(
    rep: Report,
    events: list[dict[str, Any]],
    hazards: list[dict[str, Any]],
    products_by_algorithm: dict[str, set[str]],
) -> None:
    file = "data/events.json"
    dup_check(rep, file, events, "id", "ActivationEvent")
    for i, e in enumerate(events):
        eid = _s(e, "id")
        where = f"[{i}] id={eid or '?'}"

        # THE STANDARD, applied to committed history. This is the whole point of the app: today
        # nothing checks, which is why Fire/Wildfire and Quake/Earthquake both exist in the wild.
        for v in check_name(_s(e, "name")):
            rep.add(file, where, v)
        for v in check_stac_name(_s(e, "stacName"), hazards, _strs(e, "hazards")):
            rep.add(file, where, v)
        for v in check_dates(_s(e, "start"), _s(e, "end")):
            rep.add(file, where, v)
        for v in check_hazards(_strs(e, "hazards"), hazards):
            rep.add(file, where, v)
        for v in check_locations(_strs(e, "locations")):
            rep.add(file, where, v)
        for v in check_bbox(_s(e, "bbox")):
            rep.add(file, where, v)

        # types.ts: ActivationEvent.id == stacName.
        stac = _s(e, "stacName")
        if eid and stac and eid != stac:
            rep.error(file, where, "id", "event-id-mismatch", f'id "{eid}" must equal stacName "{stac}".')

        check_layers(rep, file, where, "layers", _dicts(e, "layers"), products_by_algorithm)


def check_layers(
    rep: Report,
    file: str,
    where: str,
    field: str,
    layers: list[dict[str, Any]],
    products_by_algorithm: dict[str, set[str]],
) -> None:
    """Referential integrity for {algorithm, product} pairs — shared by events and requests."""
    for layer in layers:
        alg = _s(layer, "algorithm")
        prod = _s(layer, "product")
        if not alg or not prod:
            rep.error(file, where, field, "required", f'Layer needs both "algorithm" and "product"; got {layer!r}.')
            continue
        if alg not in products_by_algorithm:
            rep.error(
                file, where, field, "algorithm-ref",
                f'"{alg}" is not an algorithm id in data/algorithms.json.',
            )
            continue
        if prod not in products_by_algorithm[alg]:
            known = ", ".join(sorted(products_by_algorithm[alg])) or "(none)"
            rep.error(
                file, where, field, "product-ref",
                f'Algorithm "{alg}" has no product "{prod}". Its products are: {known}.',
            )


def check_requests(
    rep: Report,
    parsed: dict[str, Any],
    hazards: list[dict[str, Any]],
    products_by_algorithm: dict[str, set[str]],
) -> None:
    """Every submission under data/requests/ (and the compacted data/requests.json, if present)."""
    files = sorted(f for f in parsed if f.startswith("data/requests/") and f.endswith(".json"))
    if "data/requests.json" in parsed:
        files.append("data/requests.json")

    for file in files:
        value = parsed[file]
        # A submission file holds one request; data/requests.json (written by scripts/compact.mjs)
        # holds an array of them. Accept either.
        docs = value if isinstance(value, list) else [value]
        for i, doc in enumerate(docs):
            if not isinstance(doc, dict):
                rep.error(file, f"[{i}]", "<record>", "shape", f"Request must be an object; got {type(doc).__name__}.")
                continue
            rid = _s(doc, "id")
            where = f"[{i}] id={rid or '?'}" if isinstance(value, list) else f"id={rid or '?'}"

            if _s(doc, "kind") != "algorithm-request":
                rep.error(file, where, "kind", "kind", 'kind must be "algorithm-request".')
            if not rid:
                rep.error(file, where, "id", "required", "Request id is required (compact.mjs upserts by id).")
            if not _s(doc, "ts"):
                rep.error(file, where, "ts", "required", "Request ts is required (compact.mjs resolves conflicts by ts).")

            event = _obj(doc, "event")
            shape = {
                "name": _s(event, "name"),
                "stacName": _s(event, "stacName"),
                "start": _s(event, "start"),
                "end": _s(event, "end"),
                "hazards": _strs(event, "hazards"),
                "locations": _strs(event, "locations"),
                "bbox": _s(event, "bbox"),
                "products": _dicts(doc, "products"),
            }
            for v in validate_request(shape, hazards):
                rep.add(file, where, v)

            check_layers(rep, file, where, "products", _dicts(doc, "products"), products_by_algorithm)


# --- driver -----------------------------------------------------------------------------------------


def run() -> Report:
    rep = Report()
    parsed = scan_data_dir(rep)

    hazards = records(parsed, "data/hazards.json", rep)
    algorithms = records(parsed, "data/algorithms.json", rep)
    events = records(parsed, "data/events.json", rep)

    hazard_ids = {_s(h, "id") for h in hazards if _s(h, "id")}
    products_by_algorithm = {
        _s(a, "id"): {_s(p, "id") for p in _dicts(a, "products") if _s(p, "id")}
        for a in algorithms
        if _s(a, "id")
    }

    check_hazard_vocabulary(rep, hazards)
    check_algorithms(rep, algorithms, hazard_ids)
    check_events(rep, events, hazards, products_by_algorithm)
    check_requests(rep, parsed, hazards, products_by_algorithm)
    return rep


# --- reporting ---------------------------------------------------------------------------------------


def print_text(rep: Report, quiet: bool) -> None:
    shown = rep.errors if quiet else rep.findings
    if not quiet:
        print(f"Algorithm Catalog data validation — {ROOT}")
        print()

    current = None
    for f in shown:
        if f.file != current:
            current = f.file
            print(f"{f.file}")
        tag = "ERROR" if f.severity == ERROR else "WARN "
        print(f"  {tag}  {f.where}  {f.field}  [{f.rule}]")
        print(f"         {f.message}")
        if f.example:
            print(f"         valid example: {f.example}")
    if shown:
        print()

    n_err, n_warn = len(rep.errors), len(rep.warnings)
    if n_err:
        print(f"FAILED — {n_err} error(s), {n_warn} warning(s).")
    elif not quiet:
        print(f"OK — 0 errors, {n_warn} warning(s). Data matches THE STANDARD (src/rules.ts).")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Validate algorithm-catalog data against THE STANDARD (mirror of src/rules.ts).",
    )
    ap.add_argument("--json", action="store_true", help="machine-readable output on stdout")
    ap.add_argument("--quiet", action="store_true", help="print errors only; print nothing when clean")
    args = ap.parse_args(argv)

    rep = run()
    if args.json:
        print(
            json.dumps(
                {
                    "ok": not rep.errors,
                    "root": str(ROOT),
                    "counts": {"errors": len(rep.errors), "warnings": len(rep.warnings)},
                    "findings": [f.as_dict() for f in rep.findings],
                },
                indent=2,
            )
        )
    else:
        print_text(rep, args.quiet)
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
