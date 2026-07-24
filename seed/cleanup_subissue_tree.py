#!/usr/bin/env python3
"""Tear down the sub-issue tree + PRs created by seed_subissue_tree.py.

Reads seed/subissue_seed.json (written at seed time) and removes, in a safe order,
ACROSS EVERY repo the seed touched (each issue/PR carries its own repo):
  1. PRs      (close them)
  2. branches (delete refs/heads/seed/close-*)
  3. board    (remove the root objectives from the project)
  4. issues   (deepest first, to avoid orphaned-link noise)

Safe by default: prints what it would do unless --close or --delete is given.
Falls back to the `subissue-seed` label with --by-label if there's no tracking file.

Examples:
  python seed/cleanup_subissue_tree.py                 # dry-run
  python seed/cleanup_subissue_tree.py --close         # close PRs + issues, drop board items, delete branches
  python seed/cleanup_subissue_tree.py --delete        # permanently DELETE issues (+ close PRs, delete branches)
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(__file__)
LABEL = "subissue-seed"


def gh(args, check=True):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r


def gh_json(args):
    return json.loads(gh(args).stdout)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state", default=os.path.join(HERE, "subissue_seed.json"))
    ap.add_argument("--by-label", action="store_true", help="target the subissue-seed label instead of the state file")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--close", action="store_true", help="close issues (keep them)")
    g.add_argument("--delete", action="store_true", help="permanently delete issues")
    args = ap.parse_args()

    state = json.load(open(args.state, encoding="utf-8")) if os.path.exists(args.state) else None
    if state is None and not args.by_label:
        sys.exit(f"no tracking file at {args.state}; use --by-label")

    issue_action = "delete" if args.delete else "close" if args.close else "dry-run"
    act = issue_action != "dry-run"

    if args.by_label or state is None:
        repos = (state or {}).get("repos") or [gh_json(["repo", "view", "--json", "nameWithOwner"])["nameWithOwner"]]
        issues, prs, branches, items, proj = [], [], [], [], {}
        for r in repos:
            for i in gh_json(["issue", "list", "--repo", r, "--label", LABEL,
                              "--state", "all", "--json", "number", "--limit", "500"]):
                issues.append({"number": i["number"], "repo": r, "depth": 0})
    else:
        issues = state.get("issues", [])
        prs = state.get("prs", [])
        branches = [(p["repo"], p["branch"]) for p in prs if p.get("branch")]
        items = [(e["item_id"], e["repo"], e["number"]) for e in issues if e.get("item_id")]
        proj = state.get("project", {})
        repos = state.get("repos", [state.get("repo")])

    print(f"Repos: {', '.join(r for r in repos if r)}  |  action: {issue_action}")
    print(f"  PRs: {len(prs)}  branches: {len(branches)}  board items: {len(items)}  issues: {len(issues)}")
    if not act:
        print("\n(dry-run) pass --close or --delete to act.")
        return

    for p in prs:
        try:
            gh(["pr", "close", str(p["number"]), "--repo", p["repo"]])
            print(f"closed PR {p['repo']}#{p['number']}")
        except Exception as e:
            print(f"WARN pr {p.get('repo')}#{p['number']}: {e}")

    for repo, br in branches:
        try:
            gh(["api", "-X", "DELETE", f"repos/{repo}/git/refs/heads/{br}"])
            print(f"deleted branch {repo}:{br}")
        except Exception as e:
            print(f"WARN branch {repo}:{br}: {e}")

    for item_id, repo, number in items:
        if not proj.get("number"):
            break
        try:
            gh(["project", "item-delete", str(proj["number"]), "--owner", proj["owner"], "--id", item_id])
            print(f"removed {repo}#{number} from board")
        except Exception as e:
            print(f"WARN board item for {repo}#{number}: {e}")

    for e in sorted(issues, key=lambda e: -(e.get("depth", 0))):   # children (deepest) first
        cmd = ["issue", issue_action, str(e["number"]), "--repo", e["repo"]]
        if args.delete:
            cmd.append("--yes")
        try:
            gh(cmd)
            print(f"{issue_action}d {e['repo']}#{e['number']}")
        except Exception as ex:
            print(f"WARN issue {e['repo']}#{e['number']}: {ex}")


if __name__ == "__main__":
    main()
