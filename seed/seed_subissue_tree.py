#!/usr/bin/env python3
"""Seed a deep sub-issue tree + closing PRs so the pr-finder crawler has real data.

Builds, in repos YOU OWN, a small tree that is `--depth` levels deep (a spine that reaches
the target depth, plus optional branch leaves), links each parent->child as a GitHub
**sub-issue**, adds the root objective(s) to a project board, and opens sample PRs that
**close** the sub-issues (a mix of OPEN/CLOSED/MERGED).

CROSS-ORG: pass `--hop-repo OWNER/NAME --hop-at-depth D` and every node at depth >= D is
created in the hop repo instead of `--repo`. GitHub sub-issues link by global node id, so a
parent in one org can own a child in another. One crawl then proves depth AND cross-org.

Shape (--depth 5 --branch-factor 1): 1 root + 5 spine = 6 issues; a closing PR on each
sub-issue (depths 1..5). With --hop-at-depth 3, depths 3..5 (issues + PRs) land in the hop repo.

Progress is persisted to seed/subissue_seed.json after every mutation, so the script is
resumable/idempotent (re-run with the SAME args to continue). Use --dry-run to preview.

Examples:
  python seed/seed_subissue_tree.py --repo you/main-repo --dry-run
  python seed/seed_subissue_tree.py --repo org/dead-repo \\
    --hop-repo you/hop-repo --hop-at-depth 3 \\
    --project-owner org --project-number 5 --objectives 1 --depth 5 --branch-factor 1
Cleanup:
  python seed/cleanup_subissue_tree.py --delete
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(__file__)
LABEL = "subissue-seed"
PR_STATES = ["MERGED", "OPEN", "CLOSED"]
TOPICS = ["COG pipeline hardening", "Disaster dashboard redesign", "S3 ingestion API v2",
          "Tile server autoscaling", "STAC catalog cleanup", "Auth token rotation"]


# ---------------------------------------------------------------- gh layer

def gh(args, retries=4):
    for attempt in range(1, retries + 1):
        r = subprocess.run(["gh", *args], capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout
        err = (r.stderr or "").lower()
        transient = any(s in err for s in
                        ("timed out", "timeout", "connection reset", "eof",
                         "502", "503", "temporarily", "i/o timeout"))
        if transient and attempt < retries:
            time.sleep(2 * attempt)
            continue
        raise RuntimeError(f"gh {' '.join(args)}\n{r.stderr}")
    raise RuntimeError(f"gh {' '.join(args)}: exhausted retries")


def gh_json(args):
    return json.loads(gh(args))


def gh_graphql(query, variables=None):
    args = ["api", "graphql", "-f", f"query={query}"]
    for k, v in (variables or {}).items():
        flag = "-F" if isinstance(v, int) and not isinstance(v, bool) else "-f"
        args += [flag, f"{k}={v}"]
    out = gh(args)
    body = json.loads(out) if out.strip() else {}
    return body.get("data") or {}, body.get("errors") or []


# ---------------------------------------------------------------- plan

def node_repo(depth, main_repo, hop_repo, hop_at_depth):
    if hop_repo and hop_at_depth is not None and depth >= hop_at_depth:
        return hop_repo
    return main_repo


def build_plan(num_objectives, depth, branch, main_repo, hop_repo, hop_at_depth):
    """A spine reaching `depth`, with (branch-1) leaf children at each spine level.

    Returns an ordered list of node dicts (parents always precede children); each node
    carries its own `repo` (main below the hop depth, hop repo at/after it).
    """
    nodes, counter, pr_i = [], [0], [0]

    def add(parent, d, path, kind, title):
        lid = counter[0]
        counter[0] += 1
        # Every worked sub-issue (spine + leaf) gets a closing PR; the objective root
        # does not (a PR shouldn't close the objective itself). So a depth-5 chain yields
        # a PR at each level 1..5 — including one genuinely 5 deep.
        gets_pr = kind in ("spine", "leaf")
        pr_state = None
        if gets_pr:
            pr_state = PR_STATES[pr_i[0] % len(PR_STATES)]
            pr_i[0] += 1
        nodes.append({"local": lid, "parent_local": parent, "depth": d, "path": path,
                      "kind": kind, "title": title, "gets_pr": gets_pr, "pr_state": pr_state,
                      "repo": node_repo(d, main_repo, hop_repo, hop_at_depth)})
        return lid

    for i in range(num_objectives):
        topic = TOPICS[i % len(TOPICS)]
        root = add(None, 0, f"O{i + 1}", "root", f"[Seed]-[Objective {i + 1}]: {topic}")
        prev = root
        for d in range(1, depth + 1):
            spine = add(prev, d, f"O{i + 1}.L{d}", "spine", f"L{d} sub-issue for objective {i + 1}")
            for b in range(branch - 1):
                add(prev, d, f"O{i + 1}.L{d}.b{b + 1}", "leaf",
                    f"L{d} branch {b + 1} (leaf) for objective {i + 1}")
            prev = spine
    return nodes


def issue_body(node):
    return (f"Seed sub-issue (`{node['path']}`, depth {node['depth']}, kind {node['kind']}).\n\n"
            f"Created by seed/seed_subissue_tree.py to exercise pr-finder. Safe to delete.")


# ---------------------------------------------------------------- state

def load_state(path):
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    return {"repo": None, "repos": [], "project": {}, "args": {}, "issues": [], "links": [], "prs": []}


def save_state(state, path):
    json.dump(state, open(path, "w", encoding="utf-8"), indent=2)


def by_local(state):
    return {e["local"]: e for e in state["issues"]}


# ---------------------------------------------------------------- sub-issue linking

def link_subissue(parent_repo, parent_entry, child_entry):
    """Link child under parent as a sub-issue. addSubIssue is repo-agnostic (global node
    ids), so this works cross-repo/org; REST fallback posts to the PARENT's repo."""
    try:
        _, errors = gh_graphql(
            "mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p, subIssueId:$c})"
            "{issue{number} subIssue{number}}}",
            {"p": parent_entry["node_id"], "c": child_entry["node_id"]})
        if errors:
            raise RuntimeError(errors[0].get("message", "addSubIssue error"))
        return "addSubIssue"
    except Exception as e:
        sys.stderr.write(f"[seed] addSubIssue fell back to REST ({e})\n")
        gh(["api", "-X", "POST", f"repos/{parent_repo}/issues/{parent_entry['number']}/sub_issues",
            "-F", f"sub_issue_id={child_entry['db_id']}"])
        return "rest"


# ---------------------------------------------------------------- PRs

def create_closing_pr(repo, default_branch, base_sha, closes_number, state_target):
    branch = f"seed/close-{closes_number}"
    gh(["api", "-X", "POST", f"repos/{repo}/git/refs",
        "-f", f"ref=refs/heads/{branch}", "-f", f"sha={base_sha}"])
    content = base64.b64encode(f"Closes #{closes_number}\n".encode()).decode()
    gh(["api", "-X", "PUT", f"repos/{repo}/contents/seed-scratch/close-{closes_number}.md",
        "-f", f"message=seed: close #{closes_number}",
        "-f", f"content={content}", "-f", f"branch={branch}"])
    url = gh(["pr", "create", "--repo", repo, "--head", branch, "--base", default_branch,
              "--title", f"Close #{closes_number} (seed)",
              "--body", f"Closes #{closes_number}\n\nSeed PR from seed_subissue_tree.py."]).strip()
    number = int(url.rstrip("/").split("/")[-1])
    if state_target == "MERGED":
        try:
            gh(["pr", "merge", str(number), "--repo", repo, "--merge"])
        except Exception as e:
            sys.stderr.write(f"[seed] could not merge PR #{number} (left open): {e}\n")
    elif state_target == "CLOSED":
        gh(["pr", "close", str(number), "--repo", repo])
    return {"number": number, "url": url, "branch": branch}


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=None, help="owner/name to seed into (default: current repo). Must be one you own.")
    ap.add_argument("--hop-repo", default=None, help="owner/name for nodes at/after --hop-at-depth (cross-org)")
    ap.add_argument("--hop-at-depth", type=int, default=None, help="depth at which the tree hops to --hop-repo")
    ap.add_argument("--project-owner", default="kyle-lesinger", help="board owner (user login or org)")
    ap.add_argument("--project-number", type=int, default=2, help="board number to add roots to (0 = skip board)")
    ap.add_argument("--objectives", type=int, default=1)
    ap.add_argument("--depth", type=int, default=5)
    ap.add_argument("--branch-factor", type=int, default=1)
    ap.add_argument("--no-prs", action="store_true", help="create issues + links only, skip PRs")
    ap.add_argument("--max-issues", type=int, default=60, help="safety cap; abort if the plan exceeds this")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--state", default=os.path.join(HERE, "subissue_seed.json"))
    args = ap.parse_args()

    if args.hop_repo and args.hop_at_depth is None:
        sys.exit("error: --hop-repo requires --hop-at-depth")

    main_repo = args.repo or gh_json(["repo", "view", "--json", "nameWithOwner"])["nameWithOwner"]
    for r in (main_repo, args.hop_repo):
        if r and len(r.split("/")) != 2:
            sys.exit(f"error: repo must be owner/name, got {r!r}")

    plan = build_plan(args.objectives, args.depth, args.branch_factor,
                      main_repo, args.hop_repo, args.hop_at_depth)
    n_issues = len(plan)
    n_links = sum(1 for n in plan if n["parent_local"] is not None)
    n_prs = 0 if args.no_prs else sum(1 for n in plan if n["gets_pr"])
    repos = sorted({n["repo"] for n in plan})
    print(f"Plan: {args.objectives} objectives · depth {args.depth} · branch {args.branch_factor}"
          + (f" · hop -> {args.hop_repo} at depth {args.hop_at_depth}" if args.hop_repo else ""))
    print(f"      {n_issues} issues · {n_links} links · {n_prs} PRs · repos: {', '.join(repos)}")

    if n_issues > args.max_issues:
        sys.exit(f"error: plan has {n_issues} issues > --max-issues {args.max_issues}. "
                 f"Lower --objectives/--depth/--branch-factor or raise --max-issues.")

    if args.dry_run:
        for n in plan:
            indent = "  " * n["depth"]
            pr = f"  [PR:{n['pr_state']}]" if n["gets_pr"] and not args.no_prs else ""
            print(f"  {indent}{n['path']} ({n['kind']}) @{n['repo']}{pr}  {n['title']}")
        print("\n(dry-run) re-run without --dry-run to create.")
        return

    state = load_state(args.state)
    state["repo"] = main_repo
    state["repos"] = repos
    state["project"] = {"owner": args.project_owner, "number": args.project_number}
    state["args"] = {"objectives": args.objectives, "depth": args.depth,
                     "branch": args.branch_factor, "hop_repo": args.hop_repo,
                     "hop_at_depth": args.hop_at_depth}
    created = by_local(state)

    # label (idempotent) in every repo we'll write to
    for r in repos:
        try:
            gh(["label", "create", LABEL, "--repo", r, "--force", "--color", "5319e7",
                "--description", "pr-finder seed sub-issue tree"])
        except Exception as e:
            sys.stderr.write(f"[seed] label create warning ({r}): {e}\n")

    # 1) create issues (parents first — plan is already topological)
    for n in plan:
        if n["local"] in created:
            continue
        url = gh(["issue", "create", "--repo", n["repo"], "--title", n["title"],
                  "--body", issue_body(n), "--label", LABEL]).strip()
        number = int(url.rstrip("/").split("/")[-1])
        entry = {"local": n["local"], "number": number, "url": url, "repo": n["repo"],
                 "depth": n["depth"], "path": n["path"], "kind": n["kind"],
                 "parent_local": n["parent_local"], "is_objective": n["kind"] == "root",
                 "gets_pr": n["gets_pr"], "pr_state": n["pr_state"],
                 "node_id": None, "db_id": None, "item_id": None}
        state["issues"].append(entry)
        created[n["local"]] = entry
        save_state(state, args.state)
        print(f"created {n['repo']}#{number}  {n['path']}  {n['title'][:40]}")

    # 2) backfill node_id + db_id (needed for linking), grouped by repo
    need = [e for e in state["issues"] if not e.get("node_id") or not e.get("db_id")]
    by_repo = defaultdict(list)
    for e in need:
        by_repo[e["repo"]].append(e)
    for r, entries in by_repo.items():
        o, name = r.split("/")
        for i in range(0, len(entries), 20):
            chunk = entries[i:i + 20]
            parts = [f'i{j}: repository(owner:"{o}", name:"{name}")'
                     f'{{ issue(number:{e["number"]}){{ id databaseId }} }}'
                     for j, e in enumerate(chunk)]
            data, _ = gh_graphql("query {\n" + "\n".join(parts) + "\n}")
            for j, e in enumerate(chunk):
                iss = (data.get(f"i{j}") or {}).get("issue") or {}
                e["node_id"] = iss.get("id")
                e["db_id"] = iss.get("databaseId")
            save_state(state, args.state)

    # 3) link parent -> child as sub-issues (works cross-repo/org)
    linked = {(l["parent_local"], l["child_local"]) for l in state["links"]}
    for e in state["issues"]:
        pl = e["parent_local"]
        if pl is None or (pl, e["local"]) in linked:
            continue
        parent = created[pl]
        method = link_subissue(parent["repo"], parent, e)
        state["links"].append({"parent_local": pl, "child_local": e["local"],
                               "parent": parent["number"], "child": e["number"],
                               "parent_repo": parent["repo"], "child_repo": e["repo"], "method": method})
        save_state(state, args.state)
        print(f"linked {e['repo']}#{e['number']} under {parent['repo']}#{parent['number']} ({method})")

    # 4) add root objectives to the board
    if args.project_number:
        for e in state["issues"]:
            if e["kind"] == "root" and not e.get("item_id"):
                item = gh_json(["project", "item-add", str(args.project_number),
                                "--owner", args.project_owner, "--url", e["url"], "--format", "json"])
                e["item_id"] = item["id"]
                save_state(state, args.state)
                print(f"added {e['repo']}#{e['number']} to board {args.project_owner}/{args.project_number}")

    # 5) closing PRs (per node's repo; base branch/SHA cached per repo)
    if not args.no_prs:
        base_cache = {}

        def repo_base(r):
            if r not in base_cache:
                db = gh(["api", f"repos/{r}", "--jq", ".default_branch"]).strip()
                sha = gh(["api", f"repos/{r}/git/ref/heads/{db}", "--jq", ".object.sha"]).strip()
                base_cache[r] = (db, sha)
            return base_cache[r]

        done_pr = {(p.get("repo"), p["closes"]) for p in state["prs"]}
        for e in state["issues"]:
            if not e.get("gets_pr") or (e["repo"], e["number"]) in done_pr:
                continue
            db, sha = repo_base(e["repo"])
            pr = create_closing_pr(e["repo"], db, sha, e["number"], e["pr_state"])
            state["prs"].append({"closes": e["number"], "repo": e["repo"],
                                 "state_target": e["pr_state"], **pr})
            save_state(state, args.state)
            print(f"PR {e['repo']}#{pr['number']} ({e['pr_state']}) closes #{e['number']}")

    print(f"\nDone. repos={repos}  issues={len(state['issues'])}  links={len(state['links'])}  "
          f"prs={len(state['prs'])}  (state: {os.path.relpath(args.state)})")


if __name__ == "__main__":
    main()
