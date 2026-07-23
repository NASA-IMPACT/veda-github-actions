#!/usr/bin/env python3
"""Create the 6 board fields on the test Project v2 (idempotent).

Fields: **Program Increment** (single-select), **Start Date** / **End Date** (DATE), and
**Project** / **Initiative** / **Team** (single-select). Option sets come from
`generate_sample_issues.py` so the board matches the seed exactly.

Run once after `gh project create` (project number below). Then `setup_project.py` and
`setup_board_grouping.py` populate the fields. Re-running is safe (existing fields are skipped).
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from generate_sample_issues import PIS, PROJECTS, INITIATIVES, TEAMS  # noqa: E402

OWNER = "kyle-lesinger"
PROJECT_NUMBER = 2


def gh(args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)}\n{r.stderr}")
    return r.stdout


def existing_field_names():
    data = json.loads(gh(["project", "field-list", str(PROJECT_NUMBER), "--owner", OWNER,
                          "--format", "json", "--limit", "100"]))
    return {f["name"] for f in data.get("fields", [])}


def ensure(name, data_type, options=None, have=frozenset()):
    if name in have:
        print(f"= {name} already exists")
        return
    args = ["project", "field-create", str(PROJECT_NUMBER), "--owner", OWNER,
            "--name", name, "--data-type", data_type]
    if options:
        args += ["--single-select-options", ",".join(options)]
    gh(args)
    print(f"+ created {name} ({data_type})")


def main():
    have = existing_field_names()
    ensure("Program Increment", "SINGLE_SELECT", [p[0] for p in PIS], have)
    ensure("Start Date", "DATE", None, have)
    ensure("End Date", "DATE", None, have)
    ensure("Project", "SINGLE_SELECT", sorted(set(PROJECTS)), have)
    ensure("Initiative", "SINGLE_SELECT", sorted(set(INITIATIVES)), have)
    ensure("Team", "SINGLE_SELECT", sorted(set(TEAMS)), have)
    print(f"\nBoard fields ready on {OWNER}/projects/{PROJECT_NUMBER}.")


if __name__ == "__main__":
    main()
