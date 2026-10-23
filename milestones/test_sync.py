#!/usr/bin/env python3
"""Offline test for sync_milestones.py — NO network.

Checks deadline parsing on every phrasing in the FY27 canvas, the HTML table reader (rowspanned
Project column, <br>/<p> breaks, entities) on fixtures/canvas_table.html, and that the
"Disasters" filter picks exactly the nine Disasters PORTAL rows of fixtures/fy27_milestones.csv.

Run:  python3 milestones/test_sync.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sync_milestones as sm  # noqa: E402

DUE = {
    "October 2026": "2026-10-31",
    "Jan 2027": "2027-01-31",
    "Dec 2027": "2027-12-31",
    "February 2027": "2027-02-28",
    "October 1, 2026": "2026-10-01",
    "October 26, 2026": "2026-10-26",
    "Iteratively through FY27": "2027-09-30",
    "Q1 FY27 - December 2026": "2026-12-31",
    "Q3 FH27 - June 2027 ? (TBD with stakeholders)": "2027-06-30",
    "Dec 2026, Depends on Users": "2026-12-31",
    "January 2027 (contingent on plan being done in October 2026)": "2027-01-31",
    "~Dec / Jan 2027 (exact date TBD)": "2027-01-31",
    "~September 2027": "2027-09-30",
    "Sept 2027": "2027-09-30",
    "Iteratively through FY": None,
    "Late 2027": None,
    "TBD": None,
    "XXX": None,
    "Completed, this feature is called Org/Team Buckets": None,
    "Depends on when Roses call is released": None,
    "": None,
}


def check(label, got, want):
    if got != want:
        print(f"FAIL {label}: got {got!r}, want {want!r}", file=sys.stderr)
        sys.exit(1)


def main():
    for text, want in DUE.items():
        d = sm.parse_due(text)
        check(f"parse_due({text!r})", d.isoformat() if d else None, want)

    rows = sm.milestone_rows(sm.read_tables(os.path.join(HERE, "fixtures", "canvas_table.html"), ""))
    check("html row count", len(rows), 6)
    check("html rowspan project", [r["project"] for r in rows],
          ["VEDA core", "VEDA core", "Disasters PORTAL", "Disasters PORTAL", "Disasters PORTAL", "MAAP"])
    check("html <p> lines", rows[2]["task"],
          ["Disasters Portal Beta Release", "(includes: NextJS site w/o CMS)"])
    check("html &nbsp;", rows[3]["owner"], "Fanny (design) / Simi (eng)")
    check("html <br> + &amp;", rows[5]["task"], ["MAAP User Meeting", "with ESA & NASA"])

    rows = sm.milestone_rows(sm.read_tables(os.path.join(HERE, "fixtures", "fy27_milestones.csv"), ""))
    check("csv row count", len(rows), 58)
    dis = [sm.desired(r, "fixtures") for r in rows if "disasters" in r["project"].lower()]
    check("disasters titles", [w["title"] for w in dis], [
        "Disasters Portal Beta Release",
        "Disasters Portal Features (post-Hard Launch requests)",
        "Portal site CMS integration",
        "HDS compliance final",
        "Disasters staff task ownership handoff complete",
        "DAAC datasets integrated into Disasters STAC",
        "New Disasters visualization components released",
        "Workflow automations implemented",
        "CSDA tasking data integration",
        "Disasters Portal Features (pre- Hard Launch requests)",
    ])
    check("beta description", dis[0]["description"],
          "Project: Disasters PORTAL\nOwner: Kyle (PM) / Simi / Alexandra / Fanny\n"
          "Deadline (as written): October 2026\n"
          "(includes: NextJS site w/o CMS, Search and Filters, MVP HDS compliance)")

    have = {"HDS compliance final": {"number": 1, "description": dis[3]["description"],
                                     "due_on": "2027-01-31T12:00:00Z", "state": "open"},
            "Portal site CMS integration": {"number": 2, "description": "old",
                                            "due_on": None, "state": "open"}}
    actions = [s[0] for s in sm.plan(dis, have)]
    check("plan", actions, ["create", "create", "update", "unchanged", *["create"] * 6])
    print("ok: milestones sync — deadlines, canvas HTML, Disasters selection, plan")


if __name__ == "__main__":
    main()
