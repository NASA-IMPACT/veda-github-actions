#!/usr/bin/env python3
"""Prove the TypeScript and Python copies of THE STANDARD agree, so they cannot silently drift.

The standard lives twice: `src/rules.ts` (runs in the browser while a responder types) and
`scripts/validate_data.py` (runs in CI over what got committed). Two copies of a rule is two
chances to be wrong, so this test pins them together.

Three checks, in order of how loudly they fail:

1. **Constant parity (text).** Parse the `export const` lines out of `src/rules.ts` and assert the
   pattern/placeholder/threshold text is character-identical to the Python constants (after
   stripping the JS `/.../` delimiters). No Node, no TypeScript toolchain, no transpile step —
   deterministic and CI-safe.
2. **Inline regex parity.** The rules also use regexes that are not exported constants
   (`^[0-9]{6}$`, the bbox number/split patterns). Assert each Python pattern still appears
   verbatim as a JS literal in `src/rules.ts`.
3. **Behavioral fixtures.** ~40 (value, expected pass/fail, expected rule) cases run through the
   Python implementation. These also DOCUMENT the standard's real behavior, including the parts
   that surprise people (see the notes on `202501_Tropical_Cyclone_CA` and `2025-02-30`).

stdlib only. Run:  python3 algorithm-catalog/scripts/rules_parity_test.py
Exit 0 pass / 1 fail.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Import the Python copy of the standard from next door, without leaving a __pycache__ behind.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

from validate_data import (  # noqa: E402
    BBOX_MIN_LAT_SPAN,
    ISO_DATE_RE,
    MGRS_TILE_RE,
    STAC_EVENT_RE,
    STAC_EXAMPLE,
    STAC_PART_COUNT,
    STAC_PLACEHOLDER,
    WRS2_TILE_RE,
    _BBOX_NUMBER,
    _BBOX_SPLIT,
    _MONTH,
    _YEARMONTH,
    ERROR,
    check_bbox,
    check_dates,
    check_hazards,
    check_stac_name,
    parse_stac_name,
)

HERE = Path(__file__).resolve().parent
RULES_TS = HERE.parent / "src" / "rules.ts"

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"  FAIL  {msg}")


# =================================================================================================
# 1. Constant parity — src/rules.ts `export const` text vs the Python constants
# =================================================================================================

# `export const NAME = <value>;` where <value> is a /regex/, a "string", or a number.
_EXPORT = re.compile(
    r'^export const (?P<name>[A-Z_][A-Z0-9_]*) = (?:/(?P<re>.*)/|"(?P<str>.*)"|(?P<num>[0-9.]+));\s*$',
    re.MULTILINE,
)

# Python side, as SOURCE TEXT — this is what must survive a change to either file.
PY_CONSTANTS = {
    "STAC_EVENT_RE": STAC_EVENT_RE,
    "STAC_PART_COUNT": repr(STAC_PART_COUNT),  # "3" — compare as text, not int
    "STAC_PLACEHOLDER": STAC_PLACEHOLDER,
    "ISO_DATE_RE": ISO_DATE_RE,
    "BBOX_MIN_LAT_SPAN": repr(BBOX_MIN_LAT_SPAN),  # "0.05" — compare as text, not float
    "STAC_EXAMPLE": STAC_EXAMPLE,
    "MGRS_TILE_RE": MGRS_TILE_RE,
    "WRS2_TILE_RE": WRS2_TILE_RE,
}


def check_constants() -> None:
    print("1. constant parity (src/rules.ts <-> validate_data.py)")
    if not RULES_TS.is_file():
        fail(f"src/rules.ts not found at {RULES_TS}")
        return

    source = RULES_TS.read_text(encoding="utf-8")
    ts: dict[str, str] = {}
    for m in _EXPORT.finditer(source):
        ts[m.group("name")] = m.group("re") or m.group("str") or m.group("num") or ""

    for name, py in PY_CONSTANTS.items():
        if name not in ts:
            fail(f"{name}: not exported from src/rules.ts (looked for `export const {name} = ...;`)")
            continue
        if ts[name] != py:
            fail(
                f"{name} DIFFERS\n"
                f"          src/rules.ts    : {ts[name]!r}\n"
                f"          validate_data.py: {py!r}"
            )
        else:
            print(f"  ok    {name} = {py!r}")

    extra = sorted(set(ts) - set(PY_CONSTANTS))
    if extra:
        # A new exported constant means a new rule the Python mirror probably has not learned.
        fail(f"src/rules.ts exports constants the Python mirror does not know about: {', '.join(extra)}")


# =================================================================================================
# 2. Inline regex parity — patterns used inside the rule bodies, not exported
# =================================================================================================

INLINE = {
    "yearmonth (checkStacName)": _YEARMONTH.pattern,
    "month (checkStacName)": _MONTH.pattern,
    "bbox number (checkBbox)": _BBOX_NUMBER.pattern,
    "bbox split (checkBbox)": _BBOX_SPLIT.pattern,
}


def check_inline_regexes() -> None:
    print("\n2. inline regex parity")
    if not RULES_TS.is_file():
        return
    source = RULES_TS.read_text(encoding="utf-8")
    for label, pattern in INLINE.items():
        literal = f"/{pattern}/"
        if literal in source:
            print(f"  ok    {label}: {literal}")
        else:
            fail(f"{label}: {literal} no longer appears in src/rules.ts")


# =================================================================================================
# 3. Behavioral fixtures
# =================================================================================================

# A tiny stand-in for data/hazards.json, in the same shape as the real file: the hazard `id` IS the
# CamelCase token, so a request must submit "Fire", never "fire".
VOCAB = [
    {"id": "Fire", "label": "Fire", "token": "Fire", "aliases": ["Wildfire", "Wildfires", "Burn"]},
    {"id": "Flood", "label": "Flood", "token": "Flood", "aliases": ["Flooding", "Inundation"]},
    {"id": "Earthquake", "label": "Earthquake", "token": "Earthquake", "aliases": ["Quake", "Seismic"]},
    {
        "id": "TropicalCyclone",
        "label": "Tropical Cyclone",
        "token": "TropicalCyclone",
        "aliases": ["Hurricane", "Typhoon", "TropicalStorm", "Cyclone"],
    },
]

# (kind, value, should_pass, expected first error rule or None, note)
FIXTURES: list[tuple[str, object, bool, str | None, str]] = [
    # --- STAC event names: the ones that must pass -------------------------------------------------
    ("stac", "202501_Fire_CA", True, None, "the canonical shape"),
    ("stac", "202511_Flood_TX", True, None, "the documented example"),
    ("stac", "202606_Earthquake_Venezuela", True, None, "long location"),
    ("stac", "202604_Typhoon_Sinlaku", True, None, "storm name as location"),
    ("stac", "202604_TropicalCyclone_Guam", True, None, "CamelCase multi-word hazard — the prescribed fix"),
    ("stac", "202112_Volcano_Iceland", True, None, "past year"),
    ("stac", "202501_fire_CA", True, None, "DOCUMENTED: the regex is case-blind; lowercase passes"),
    # --- STAC event names: the ones that must fail -------------------------------------------------
    # Exactly 2 underscores. Both directions are hard errors — this is the STRICTER-THAN-UPSTREAM
    # rule, and the reason the app exists. See the STAC_EVENT_RE docblock in src/rules.ts.
    (
        "stac",
        "202501_Tropical_Cyclone_CA",
        False,
        "underscore-count",
        "3 underscores. Upstream ACCEPTS this and silently reads hazard='Tropical', "
        "location='Cyclone_CA'; we block it. Write 202501_TropicalCyclone_CA.",
    ),
    (
        "stac",
        "202501_Flood_CA_extra",
        False,
        "underscore-count",
        "3 underscores. An EXPLICIT upstream pass case "
        "(tests/integration/test_dps_validate.sh:41-48) that we knowingly refuse — the location "
        "slot may not absorb underscores here.",
    ),
    ("stac", "202512_Hurricane_Gulf_of_Mexico", False, "underscore-count", "5 underscores; use GulfOfMexico"),
    ("stac", "202501_Fire", False, "underscore-count", "1 underscore, no location"),
    ("stac", "202501-Fire-CA", False, "underscore-count", "0 underscores; hyphens are not separators"),
    ("stac", "202513_Fire_CA", False, "month", "month 13"),
    ("stac", "202500_Fire_CA", False, "month", "month 00"),
    ("stac", "YYYYMM_Hazard_Location", False, "placeholder", "the upstream placeholder"),
    ("stac", "2025_Fire_CA", False, "yearmonth", "4-digit year, no month"),
    ("stac", "20250_Fire_CA", False, "yearmonth", "5 digits"),
    ("stac", "2025011_Fire_CA", False, "yearmonth", "7 digits"),
    ("stac", "202501_Fire_", False, "format", "right underscore count, but empty location"),
    ("stac", "202501__CA", False, "format", "right underscore count, but empty hazard"),
    ("stac", "", False, "required", "empty"),
    ("stac", "   ", False, "required", "whitespace only"),
    # --- ISO dates ---------------------------------------------------------------------------------
    ("iso-date", "2025-01-15", True, None, "valid"),
    ("iso-date", "2025-12-31", True, None, "valid end of year"),
    (
        "iso-date",
        "2025-02-30",
        True,
        None,
        "DOCUMENTED: PASSES — upstream checks SHAPE only, there is no calendar check",
    ),
    ("iso-date", "2025-13-01", False, "format", "month 13"),
    ("iso-date", "2025-00-10", False, "format", "month 00"),
    ("iso-date", "2025-01-32", False, "format", "day 32"),
    ("iso-date", "2025-1-5", False, "format", "unpadded"),
    ("iso-date", "20250115", False, "format", "no separators"),
    ("iso-date", "", False, "required", "empty"),
    # --- date ordering -----------------------------------------------------------------------------
    ("date-order", ("2025-01-07", "2025-01-31"), True, None, "start before end"),
    ("date-order", ("2025-01-07", "2025-01-07"), True, None, "single-day event"),
    ("date-order", ("2025-01-31", "2025-01-07"), False, "order", "end before start"),
    # --- bbox --------------------------------------------------------------------------------------
    ("bbox", "", True, None, "bbox is optional"),
    ("bbox", "-120,34,-118,36", True, None, "valid comma-separated"),
    ("bbox", "-120 34 -118 36", True, None, "whitespace-separated is accepted"),
    ("bbox", "-118.9,33.6,-117.6,34.4", True, None, "decimals"),
    ("bbox", "-120,34,-118", False, "count", "3 numbers"),
    ("bbox", "-120,34,-118,abc", False, "numeric", "not a number"),
    ("bbox", "-200,34,-118,36", False, "range", "lon < -180"),
    ("bbox", "-120,34,-118,95", False, "range", "lat > 90"),
    ("bbox", "-118,34,-120,36", False, "order", "min_lon >= max_lon"),
    ("bbox", "-120,34.00,-118,34.02", False, "lat-span", f"lat span < {BBOX_MIN_LAT_SPAN} (Black Marble)"),
    # --- hazard vocabulary --------------------------------------------------------------------------
    ("hazards", ["Fire"], True, None, "known id"),
    ("hazards", ["Fire", "Flood"], True, None, "two known ids"),
    ("hazards", ["TropicalCyclone"], True, None, "CamelCase multi-word id"),
    ("hazards", [], False, "required", "none selected"),
    ("hazards", ["fire"], False, "vocabulary", "ids are case-sensitive — the id is 'Fire'"),
    ("hazards", ["Wildfire"], False, "vocabulary", "an ALIAS is not an id; Wildfire resolves to Fire"),
    ("hazards", ["Tropical_Cyclone"], False, "vocabulary", "unknown AND contains an underscore"),
]

# The soft hazard cross-check: the regex accepts ANY token in slot 2, so the controlled vocabulary
# is the only thing that can catch a semantically wrong (but structurally legal) name. These cases
# must produce NO error and exactly the listed warning rules.
# (value, selected hazard ids, expected warning rules, note)
# NOTE: 202501_Tropical_Cyclone_CA and 202501_Flood_CA_extra used to live here as WARNING cases.
# They are now hard `underscore-count` ERRORS (see FIXTURES) and never reach this cross-check.
WARNING_FIXTURES: list[tuple[str, list[str], list[str], str]] = [
    (
        "202604_TropicalCyclone_Guam",
        ["TropicalCyclone"],
        [],
        "the CamelCase rewrite of the name the standard now blocks — clean, no warning",
    ),
    ("202501_Wildfire_CA", ["Fire"], [], "alias: Wildfire resolves to the Fire hazard"),
    ("202604_Typhoon_Sinlaku", ["TropicalCyclone"], [], "alias: Typhoon resolves to TropicalCyclone"),
    ("202501_Quake_Venezuela", ["Earthquake"], [], "alias: Quake resolves to the Earthquake hazard"),
    ("202501_Fire_CA", ["Flood"], ["hazard-mismatch"], "known token, but that hazard is not selected"),
    ("202501_Sinkhole_FL", ["Fire"], ["hazard-vocabulary"], "token outside the vocabulary"),
]

# parse_stac_name() slotting — the behavior every "why did that pass?" question comes back to.
# It returns None for anything that is not exactly 3 parts — it no longer joins the tail into the
# location slot, which is precisely the upstream behavior the tightened standard exists to prevent.
PARSE_CASES: list[tuple[str, tuple[str, str, str] | None]] = [
    ("202501_Fire_CA", ("202501", "Fire", "CA")),
    ("202604_TropicalCyclone_Guam", ("202604", "TropicalCyclone", "Guam")),
    ("202501_Flood_CA_extra", None),
    ("202501_Tropical_Cyclone_CA", None),
    ("202501_Fire", None),
]


def run_fixture(kind: str, value: object) -> list:
    if kind == "stac":
        # No vocabulary passed: this fixture table tests the STANDARD, not the soft hazard warnings.
        return check_stac_name(str(value))
    if kind == "iso-date":
        # start == end so only the shape rule can fire.
        return check_dates(str(value), str(value))
    if kind == "date-order":
        start, end = value  # type: ignore[misc]
        return check_dates(start, end)
    if kind == "bbox":
        return check_bbox(str(value))
    if kind == "hazards":
        return check_hazards(list(value), VOCAB)  # type: ignore[arg-type]
    raise AssertionError(f"unknown fixture kind {kind!r}")


def check_fixtures() -> None:
    print(f"\n3. behavioral fixtures ({len(FIXTURES)} cases) through the Python rules")
    for kind, value, should_pass, expected_rule, note in FIXTURES:
        violations = run_fixture(kind, value)
        errors = [v for v in violations if v.severity == ERROR]
        passed = not errors
        if passed != should_pass:
            fail(
                f"[{kind}] {value!r}: expected {'PASS' if should_pass else 'FAIL'}, "
                f"got {'PASS' if passed else 'FAIL'} ({note})\n"
                f"          violations: {[(v.rule, v.message) for v in errors] or 'none'}"
            )
            continue
        if expected_rule is not None and errors[0].rule != expected_rule:
            fail(
                f"[{kind}] {value!r}: expected rule {expected_rule!r}, got {errors[0].rule!r} ({note})\n"
                f"          message: {errors[0].message}"
            )
            continue
        verdict = "pass" if should_pass else f"fail[{expected_rule}]"
        print(f"  ok    [{kind}] {value!r} -> {verdict}")

    print("\n   hazard vocabulary cross-check (errors vs warnings)")
    for value, selected, expected_warnings, note in WARNING_FIXTURES:
        violations = check_stac_name(value, VOCAB, selected)
        errors = [v.rule for v in violations if v.severity == ERROR]
        warnings = [v.rule for v in violations if v.severity != ERROR]
        if errors:
            fail(f"[warn] {value!r}: expected NO error, got {errors} ({note})")
        elif warnings != expected_warnings:
            fail(f"[warn] {value!r}: expected warnings {expected_warnings}, got {warnings} ({note})")
        else:
            print(f"  ok    [warn] {value!r} + {selected} -> warnings {warnings or '[]'}")

    print("\n   parse_stac_name() slotting")
    for value, expected in PARSE_CASES:
        got = parse_stac_name(value)
        got_tuple = None if got is None else (got["yearMonth"], got["hazard"], got["location"])
        if got_tuple != expected:
            fail(f"parse_stac_name({value!r}): expected {expected!r}, got {got_tuple!r}")
        else:
            print(f"  ok    parse_stac_name({value!r}) -> {got_tuple!r}")


def main() -> int:
    print(f"THE STANDARD parity test — {RULES_TS}\n")
    check_constants()
    check_inline_regexes()
    check_fixtures()

    print()
    if failures:
        print(f"FAILED — {len(failures)} parity/behavior mismatch(es):")
        for f in failures:
            print(f"  - {f.splitlines()[0]}")
        print("\nThe TS and Python copies of THE STANDARD have drifted. Fix src/rules.ts AND")
        print("scripts/validate_data.py together, then re-run this test.")
        return 1
    print("OK — src/rules.ts and scripts/validate_data.py encode the same standard.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
