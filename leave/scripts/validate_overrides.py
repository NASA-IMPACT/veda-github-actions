#!/usr/bin/env python3
"""Validate leave override JSON files BEFORE they merge.

`apply_overrides` in generate_leave_tracker.py deliberately SKIPS a malformed override with only
a warning, so one typo can never break the whole report. That is right for the report and wrong
for the person who submitted it: today a bad file merges, is silently ignored, and they never see
their dates. This script turns that silence into a hard failure at PR time.

It imports the generator rather than restating its rules, so the accepted statuses, date handling
and document shapes can never drift from what actually produces the report.

Usage:
  python leave/scripts/validate_overrides.py leave/overrides/jane-doe.json [...]

Exit 0 = every file is valid (a one-line summary per file goes to stdout).
Exit 1 = at least one problem; every problem is printed, not just the first.
"""
import argparse
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATOR = os.path.join(os.path.dirname(HERE), "generate_leave_tracker.py")

# Filenames the dashboard's "Add leave" flow produces: `<slug>.json` / `<slug>-plus-N.json`.
FILENAME_RE = re.compile(r"^[a-z0-9._-]+\.json$")


def load_generator():
    """Import generate_leave_tracker.py by path (it is stdlib-only and __main__-guarded)."""
    spec = importlib.util.spec_from_file_location("generate_leave_tracker", GENERATOR)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import the generator at {GENERATOR}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def people_docs(doc):
    """The three shapes apply_overrides accepts -> a list of person dicts, or None if unusable."""
    if isinstance(doc, list):
        return doc
    if isinstance(doc, dict) and isinstance(doc.get("people"), list):
        return doc["people"]
    if isinstance(doc, dict):
        return [doc]
    return None


def validate_person(gen, ov, where, errors):
    """One person dict -> number of leave days it would produce (0 if it has errors)."""
    known = set(gen.CATEGORY_META) | {"available"}

    name = ov.get("person")
    slug = ov.get("slug")
    if not (isinstance(name, str) and name.strip()) and not (isinstance(slug, str) and slug.strip()):
        errors.append(f"{where}: needs a non-empty \"person\" (or \"slug\")")
        return 0
    if slug is not None:
        if not isinstance(slug, str) or gen.slugify(slug) != slug:
            errors.append(
                f"{where}: \"slug\" must be lowercase/dash-separated "
                f"(got {slug!r}, expected {gen.slugify(slug if isinstance(slug, str) else '')!r})")
    for key in ("team", "role", "pi"):
        if key in ov and not isinstance(ov[key], str):
            errors.append(f"{where}: \"{key}\" must be a string (got {type(ov[key]).__name__})")
    if "include_weekends" in ov and not isinstance(ov["include_weekends"], bool):
        errors.append(f"{where}: \"include_weekends\" must be true/false")

    entries = ov.get("entries")
    if not isinstance(entries, list):
        errors.append(f"{where}: \"entries\" must be a list")
        return 0
    if not entries:
        errors.append(f"{where}: \"entries\" is empty — nothing would change on the calendar")
        return 0

    days = 0
    for i, entry in enumerate(entries):
        at = f"{where} entries[{i}]"
        if not isinstance(entry, dict):
            errors.append(f"{at}: must be an object")
            continue
        status = entry.get("status", "unavailable")
        if status not in known:
            errors.append(
                f"{at}: unknown status {status!r} — use one of {', '.join(sorted(known))}")
        if not entry.get("date") and not entry.get("start"):
            errors.append(f"{at}: needs a \"date\", or a \"start\" (with optional \"end\")")
            continue
        # expand_entry is the generator's own date logic — if it raises here it would have been
        # skipped with a warning at report time, which is exactly what we are catching.
        try:
            expanded = gen.expand_entry(entry, ov.get("include_weekends", False))
        except (ValueError, KeyError, TypeError) as e:
            errors.append(f"{at}: bad dates — {e}")
            continue
        if not expanded:
            errors.append(
                f"{at}: covers no weekdays (an end before the start, or a weekend-only range — "
                f"set \"include_weekends\": true if that is intended)")
            continue
        if status != "available":
            days += len(expanded)
    return days


def validate_file(gen, path, errors):
    base = os.path.basename(path)
    if not FILENAME_RE.match(base):
        errors.append(f"{base}: filename must be lowercase `<slug>.json`")
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except json.JSONDecodeError as e:
        errors.append(f"{base}: not valid JSON — {e}")
        return None
    except OSError as e:
        errors.append(f"{base}: unreadable — {e}")
        return None

    docs = people_docs(doc)
    if docs is None:
        errors.append(f"{base}: must be an object, a list of objects, or {{\"people\": [...]}}")
        return None

    before = len(errors)
    total_days = 0
    names = []
    for i, ov in enumerate(docs):
        where = f"{base}" if len(docs) == 1 else f"{base}[{i}]"
        if not isinstance(ov, dict):
            errors.append(f"{where}: must be an object")
            continue
        total_days += validate_person(gen, ov, where, errors)
        names.append(ov.get("person") or ov.get("slug") or "?")
    if len(errors) > before:
        return None
    return f"{base}: OK — {len(docs)} person(s) ({', '.join(names)}), {total_days} leave day(s)"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", help="override JSON files to validate")
    args = ap.parse_args()

    gen = load_generator()
    errors = []
    for path in args.files:
        summary = validate_file(gen, path, errors)
        if summary:
            print(summary)

    if errors:
        print("", file=sys.stderr)
        for e in errors:
            print(f"ERROR {e}", file=sys.stderr)
        print(f"\n{len(errors)} problem(s) found.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
