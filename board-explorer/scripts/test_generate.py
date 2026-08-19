#!/usr/bin/env python3
"""Offline golden test for generate_board_export.py — no network, no token, stdlib only.

Two layers, deliberately:
  1. Named invariants, each asserting one thing the flattener must never get wrong. These are
     the reason the test exists; a diff alone would tell you *that* something moved, not what.
  2. A full golden diff against fixtures/expected_board.json, which catches everything the
     named checks did not think to look for.

Run:  python3 board-explorer/scripts/test_generate.py
      python3 board-explorer/scripts/test_generate.py --update    # re-freeze the golden
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_board_export import build_export, write_json  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "fixtures", "board_graphql.json")
GOLDEN = os.path.join(HERE, "fixtures", "expected_board.json")
NOW = "2026-01-21T00:00:00Z"

failures = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'}  {name}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(name)


def by_id(doc, item_id):
    return next((i for i in doc["items"] if i["id"] == item_id), None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true", help="rewrite the golden from this run")
    args = ap.parse_args()

    with open(FIXTURE, encoding="utf-8") as fh:
        bundle = json.load(fh)
    doc = build_export(bundle, NOW, body_chars=600)

    if args.update:
        write_json(GOLDEN, doc)
        print(f"golden updated: {GOLDEN}")
        return 0

    # ---- 1. named invariants -----------------------------------------------------------
    names = [f["name"] for f in doc["fields"]]
    check("builtin fields are dropped from the field schema",
          not ({"Title", "Assignees", "Labels", "Repository", "Created"} & set(names)),
          f"kept {names}")
    check("author-defined fields survive",
          names == ["Status", "Sprint", "Points", "Notes", "Start Date"], str(names))
    check("single-select options keep their GitHub color enum",
          doc["fields"][0].get("options") == [
              {"name": "Todo", "color": "GREEN"},
              {"name": "In Progress", "color": "YELLOW"},
              {"name": "Done", "color": "PURPLE"}])
    check("iteration config merges completed + upcoming iterations",
          [i["title"] for i in doc["fields"][1]["iterations"]] == ["Sprint 0", "Sprint 1"])

    check("a redacted item is skipped rather than exported empty",
          len(doc["items"]) == 7 and by_id(doc, "PVTI_redacted") is None,
          f"{len(doc['items'])} items")
    check("items from every page are concatenated",
          by_id(doc, "PVTI_archived_issue") is not None)

    merged = by_id(doc, "PVTI_merged_pr")
    closed_pr = by_id(doc, "PVTI_closed_pr")
    draft_pr = by_id(doc, "PVTI_draft_pr")
    draft_item = by_id(doc, "PVTI_draft_item")
    open_issue = by_id(doc, "PVTI_open_issue")
    closed_issue = by_id(doc, "PVTI_closed_issue")

    check("a merged PR is 'merged', not 'closed'", merged["state"] == "merged", merged["state"])
    check("a closed-unmerged PR is 'closed'", closed_pr["state"] == "closed", closed_pr["state"])
    check("a draft PR stays OPEN with a draft flag (so is:open still finds it)",
          draft_pr["state"] == "open" and draft_pr["draft"] is True,
          f"state={draft_pr['state']} draft={draft_pr['draft']}")
    check("a draft item is kind=draft, state=open",
          draft_item["kind"] == "draft" and draft_item["state"] == "open" and draft_item["draft"] is True)
    check("stateReason is normalized to lowercase",
          closed_issue["state_reason"] == "not_planned", str(closed_issue["state_reason"]))
    check("mergedAt wins over closedAt for the closed timestamp",
          merged["closed"] == "2026-01-12T12:00:00Z", str(merged["closed"]))

    check("every field-value union member is flattened",
          open_issue["fields"] == {
              "Status": "In Progress",
              "Sprint": {"title": "Sprint 1", "startDate": "2026-01-19", "duration": 14},
              "Points": 5,
              "Notes": "needs review from infra",
              "Start Date": "2026-01-19"},
          json.dumps(open_issue["fields"], sort_keys=True))
    check("the Title field value is not duplicated into fields",
          "Title" not in open_issue["fields"])
    check("iteration values keep their window for the timeline",
          open_issue["fields"]["Sprint"]["startDate"] == "2026-01-19")

    check("assignees, labels and milestone come off content",
          open_issue["assignees"] == ["octocat", "hubot"]
          and open_issue["labels"] == ["bug", "infra"]
          and open_issue["milestone"] == "Q1 hardening")
    check("sub-issue progress survives", open_issue["sub"] == {"total": 3, "completed": 1})
    check("a zero-total sub-issue summary is omitted", "sub" not in closed_issue)
    check("parent issue survives", open_issue["parent"]["number"] == 2)
    check("PR diffstat + review decision survive",
          merged["diff"] == {"additions": 120, "deletions": 8, "files": 4}
          and merged["review_decision"] == "approved")
    check("issues carry no diffstat", "diff" not in open_issue)
    check("archived items are flagged, not dropped",
          by_id(doc, "PVTI_archived_issue")["archived"] is True)

    check("people are deduped and sorted by login",
          [p["login"] for p in doc["people"]] == ["hubot", "octocat"])
    check("a person with no display name falls back to their login",
          next(p for p in doc["people"] if p["login"] == "hubot")["name"] == "hubot")
    check("labels are deduped and keep their GitHub hex",
          doc["labels"] == [{"name": "bug", "color": "d73a4a"},
                            {"name": "infra", "color": "0e8a16"}])
    check("repos are collected and sorted",
          doc["repos"] == ["Test-Org/repo-a", "Test-Org/repo-b"])
    check("stats add up",
          doc["stats"] == {"items": 7, "issues": 3, "prs": 3, "drafts": 1, "open": 3, "closed": 4},
          json.dumps(doc["stats"], sort_keys=True))
    check("items are ordered deterministically by (repo, number)",
          [(i["repo"], i["number"]) for i in doc["items"]]
          == [("", None), ("Test-Org/repo-a", 1), ("Test-Org/repo-a", 9), ("Test-Org/repo-a", 12),
              ("Test-Org/repo-b", 30), ("Test-Org/repo-b", 31), ("Test-Org/repo-b", 32)])

    # ---- 2. full golden diff -----------------------------------------------------------
    if not os.path.exists(GOLDEN):
        check("golden exists", False, f"{GOLDEN} missing — run with --update")
    else:
        with open(GOLDEN, encoding="utf-8") as fh:
            expected = json.load(fh)
        same = json.dumps(doc, sort_keys=True) == json.dumps(expected, sort_keys=True)
        check("output matches the golden byte-for-byte", same,
              "" if same else "run with --update after reviewing the diff")
        if not same:
            for key in sorted(set(doc) | set(expected)):
                if json.dumps(doc.get(key), sort_keys=True) != json.dumps(expected.get(key), sort_keys=True):
                    print(f"        differs at: {key}")

    print(f"\n{len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
