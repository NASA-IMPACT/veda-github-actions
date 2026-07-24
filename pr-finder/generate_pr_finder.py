#!/usr/bin/env python3
"""Find the pull requests that close the sub-issues under each Objective on a board.

Starting from the "Objective" issues on a GitHub Projects v2 board, this walks each
objective's **sub-issue hierarchy down to N levels deep** (default 5) across repos/orgs
(read-only) and collects the pull requests that **close** those issues (GraphQL
`closedByPullRequestsReferences` — closing PRs only, not mere cross-references).

Output (to --out-dir), named by a PI/Sprint slug (e.g. `pr_finder_pi-27.2_sprint-5.*`, or
`pr_finder_all.*` when unfiltered): `<base>.csv` (one row per issue/closing-PR), `<base>.md`
(GitHub-flavored: an H2 per objective, then a list of its PRs), `<base>.html` (self-contained,
USWDS-styled), `<base>_stats.json`, plus a fixed `pr_finder_manifest.json` (slug + file map + stats)
so the action/dashboard can locate the slugged files.

Traversal is an iterative BFS by level with GraphQL alias-batching (<=20 parents per
request) — never a single deep-nested query (which would blow up GraphQL node cost).
Each node carries its own `repository.nameWithOwner`, so the crawl spans repos/orgs
naturally; repos we cannot read degrade gracefully (per-alias FORBIDDEN/NOT_FOUND ->
empty children, keep going).

Inputs (pick one):
  --project-url URL         board URL (.../orgs|users/<owner>/projects/<n>)
  --owner OWNER --number N  board owner + number (already parsed, e.g. by the action)
  --tree-json FILE          offline: a pre-crawled {"board_title","roots":[...]} tree

Standard library only; deterministic ordering for clean diffs. Auth is via `gh`
(set GH_TOKEN / GITHUB_TOKEN); the token needs repo + read:org + project scope.
"""
import argparse
import csv
import json
import html
import os
import re
import subprocess
import sys
import time

WEB_URL_RE = re.compile(r"github\.com/([^/]+)/([^/]+)/issues/(\d+)")
PROJECT_URL_RE = re.compile(r"/(orgs|users)/([^/]+)/projects/(\d+)")
NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
SUBISSUES_PAGE = 50
PRS_PAGE = 20


# ---------------------------------------------------------------- gh subprocess layer

def gh(args, retries=4):
    """Run a gh command, retrying transient network/5xx errors with backoff."""
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


def gh_graphql(query, variables=None, retries=6):
    """POST a GraphQL query via `gh api graphql`. Returns (data, errors).

    GitHub returns `data` and `errors` together for partial failures (e.g. one
    alias FORBIDDEN); callers inspect both. Retries RATE_LIMITED / transient errors
    with capped backoff.
    """
    args = ["api", "graphql", "-f", f"query={query}"]
    for k, v in (variables or {}).items():
        flag = "-F" if isinstance(v, int) and not isinstance(v, bool) else "-f"
        args += [flag, f"{k}={v}"]

    last = ""
    for attempt in range(1, retries + 1):
        r = subprocess.run(["gh", *args], capture_output=True, text=True)
        out, err = r.stdout or "", r.stderr or ""
        last = err or out
        body = {}
        if out.strip():
            try:
                body = json.loads(out)
            except json.JSONDecodeError:
                body = {}
        data = body.get("data")
        errors = body.get("errors") or []
        combined = (err + " " + out).lower()

        rate_limited = (any((e.get("type") or "") == "RATE_LIMITED" for e in errors)
                        or "rate limit" in combined
                        or "submitted too quickly" in combined
                        or "secondary rate" in combined)
        if rate_limited and attempt < retries:
            wait = min(2 ** attempt, 5) + 0.5
            sys.stderr.write(f"[pr-finder] rate limited; waiting {wait:.1f}s (attempt {attempt})\n")
            time.sleep(wait)
            continue

        transient = (data is None and r.returncode != 0
                     and any(s in combined for s in
                             ("timeout", "timed out", "502", "503", "connection reset",
                              "eof", "i/o timeout")))
        if transient and attempt < retries:
            time.sleep(2 * attempt)
            continue

        if data is None and not errors:
            raise RuntimeError(f"gh api graphql failed:\n{last}")
        return data or {}, errors
    raise RuntimeError(f"gh api graphql: exhausted retries:\n{last}")


def sanitize(name):
    """Guard owner/repo before interpolating into an alias query (injection defense)."""
    if not NAME_RE.match(name or ""):
        raise ValueError(f"unsafe GitHub name: {name!r}")
    return name


def log_errors(errors):
    for e in errors or []:
        typ = e.get("type") or "ERROR"
        path = ".".join(str(p) for p in (e.get("path") or []))
        msg = e.get("message") or ""
        sys.stderr.write(f"[pr-finder] graphql {typ} at {path}: {msg}\n")


# ---------------------------------------------------------------- board read

def is_objective(title):
    return "objective" in (title or "").lower()


def parse_issue_url(url):
    m = WEB_URL_RE.search(url or "")
    return (m.group(1), m.group(2), int(m.group(3))) if m else None


def resolve_owner_number(args):
    if args.owner and args.number:
        return sanitize(args.owner), int(args.number)
    if args.project_url:
        m = PROJECT_URL_RE.search(args.project_url)
        if not m:
            sys.exit(f"error: could not parse --project-url '{args.project_url}'")
        return sanitize(m.group(2)), int(m.group(3))
    sys.exit("error: provide --project-url, --owner/--number, or --tree-json")


def get_board_title(owner, number):
    try:
        data = gh_json(["project", "view", str(number), "--owner", owner, "--format", "json"])
        return data.get("title") or f"project #{number}"
    except Exception:
        return f"project #{number}"


def _norm_field_val(s):
    """Normalize a board field value / filter for comparison: drop a leading label word
    (PI/Sprint/Iteration) and all spaces, lowercase. So 'PI 27.2' == '27.2'."""
    s = (s or "").strip().lower()
    s = re.sub(r"^(pi|sprint|iteration|cycle)\s+", "", s)
    return s.replace(" ", "")


def _field_title(v):
    """Value of a board field cell — iteration fields are dicts (title), the rest strings."""
    if isinstance(v, dict):
        return v.get("title") or v.get("name") or ""
    if isinstance(v, (str, int, float)):
        return str(v)
    return ""


def _pi_of(item):
    for k, v in item.items():
        nk = re.sub(r"[^a-z0-9]", "", k.lower())
        if nk == "pi" or "programincrement" in nk:
            return _field_title(v)
    return None


def _sprint_of(item):
    for k, v in item.items():
        nk = re.sub(r"[^a-z0-9]", "", k.lower())
        if ("sprint" in nk or nk == "iteration") and "point" not in nk:  # skip 'Sprint Points'
            return _field_title(v)
    return None


def read_objectives(owner, number, only_objectives, pi="", sprint="", limit=2000):
    """Return objective refs from the board. Reads content.url + content.title, and —
    only when a --pi/--sprint filter is set — the Program Increment / Sprint board fields.
    Any other board fields are ignored (tolerant of concurrent schema changes)."""
    data = gh_json(["project", "item-list", str(number), "--owner", owner,
                    "--format", "json", "--limit", str(limit)])
    objs, saw_pi, saw_sprint = [], False, False
    for it in data.get("items", []):
        content = it.get("content") or {}
        if content.get("type") not in (None, "Issue"):
            continue
        title = content.get("title") or ""
        if not is_objective(title):
            continue
        if pi.strip():
            val = _pi_of(it)
            saw_pi = saw_pi or val is not None
            if _norm_field_val(val) != _norm_field_val(pi):
                continue
        if sprint.strip():
            val = _sprint_of(it)
            saw_sprint = saw_sprint or val is not None
            if _norm_field_val(val) != _norm_field_val(sprint):
                continue
        ref = parse_issue_url(content.get("url") or "")
        if not ref:
            sys.stderr.write(f"[pr-finder] skip un-parseable objective url: {content.get('url')}\n")
            continue
        o, n, num = ref
        objs.append({"owner": o, "name": n, "number": num, "title": title,
                     "url": content.get("url") or ""})
    if only_objectives.strip():
        wanted = [s.strip().lower() for s in only_objectives.split(",") if s.strip()]
        objs = [o for o in objs if any(w in o["title"].lower() for w in wanted)]
    if pi.strip() and not saw_pi:
        sys.stderr.write("[pr-finder] warning: --pi set but no 'Program Increment' field on the board\n")
    if sprint.strip() and not saw_sprint:
        sys.stderr.write("[pr-finder] warning: --sprint set but no 'Sprint' field on the board\n")
    objs.sort(key=lambda o: o["number"] or 0)
    return objs


# ---------------------------------------------------------------- node helpers

def make_root(obj):
    return {"owner": obj["owner"], "name": obj["name"], "number": obj["number"],
            "title": obj["title"], "url": obj["url"], "state": "OPEN",
            "depth": 0, "children": [], "prs": []}


def make_node(child, depth):
    repo = (child.get("repository") or {}).get("nameWithOwner") or ""
    owner, _, name = repo.partition("/")
    return {"owner": owner, "name": name, "number": child.get("number"),
            "title": child.get("title") or "", "url": child.get("url") or "",
            "state": child.get("state") or "", "depth": depth, "children": [], "prs": []}


def ref_of(node):
    return (node["owner"], node["name"], node["number"])


def flatten(root):
    """DFS over a tree; a visited set makes it safe even if a node is shared/re-attached."""
    out, seen = [], set()
    stack = [root]
    while stack:
        n = stack.pop()
        r = ref_of(n)
        if r in seen:
            continue
        seen.add(r)
        out.append(n)
        stack.extend(reversed(n["children"]))
    return out


def normalize_node(n, depth=0):
    n.setdefault("owner", "")
    n.setdefault("name", "")
    n.setdefault("number", None)
    n.setdefault("title", "")
    n.setdefault("url", "")
    n.setdefault("state", "")
    n["depth"] = n.get("depth", depth)
    n.setdefault("prs", [])
    n.setdefault("children", [])
    for c in n["children"]:
        normalize_node(c, n["depth"] + 1)


# ---------------------------------------------------------------- crawl (BFS by level)

def subissues_query(batch):
    """batch: list of (node, after_cursor). One aliased request for many parents."""
    parts = []
    for idx, (node, after) in enumerate(batch):
        o, r, n = sanitize(node["owner"]), sanitize(node["name"]), int(node["number"])
        after_arg = f', after: "{after}"' if after else ""
        parts.append(
            f'i{idx}: repository(owner: "{o}", name: "{r}") {{ '
            f'issue(number: {n}) {{ number title state url '
            f'subIssues(first: {SUBISSUES_PAGE}{after_arg}) {{ totalCount '
            f'nodes {{ number title state url repository {{ nameWithOwner }} }} '
            f'pageInfo {{ hasNextPage endCursor }} }} }} }}')
    return "query {\n" + "\n".join(parts) + "\n}"


def crawl_all(objectives, max_depth, max_api, batch_size, budget, stats):
    """One global BFS over ALL objectives, alias-batched across objectives per level.

    GitHub sub-issues form a strict tree (each issue has at most one parent), so a single
    `node_by_ref`/`seen` set across all objectives is both correct and efficient — the
    top-level frontier (every objective root) batches into ceil(N/batch_size) requests
    instead of one request per objective.
    """
    roots, node_by_ref = [], {}
    frontier = []
    for obj in objectives:
        root = make_root(obj)
        roots.append(root)
        ref = ref_of(root)
        if ref not in node_by_ref:          # dedupe duplicate board items
            node_by_ref[ref] = root
            frontier.append(root)

    depth = 0
    while frontier and depth < max_depth:
        next_frontier = []
        pending = [(p, None) for p in frontier]   # (parent, after_cursor)
        while pending:
            if budget[0] >= max_api:
                stats["truncated"] = True
                return roots
            batch = pending[:batch_size]
            pending = pending[batch_size:]
            budget[0] += 1
            data, errors = gh_graphql(subissues_query(batch))
            log_errors(errors)
            for idx, (parent, _after) in enumerate(batch):
                issue = ((data or {}).get(f"i{idx}") or {}).get("issue")
                if not issue:
                    continue
                sub = issue.get("subIssues") or {}
                for child in (sub.get("nodes") or []):
                    node = make_node(child, parent["depth"] + 1)
                    cref = ref_of(node)
                    if not (node["owner"] and node["name"] and node["number"]):
                        continue
                    existing = node_by_ref.get(cref)
                    if existing is not None:   # already placed (or is an objective root)
                        parent["children"].append(existing)   # attach ref; don't re-descend
                        continue
                    node_by_ref[cref] = node
                    parent["children"].append(node)
                    next_frontier.append(node)
                    stats["max_depth_reached"] = max(stats["max_depth_reached"], node["depth"])
                page = sub.get("pageInfo") or {}
                if page.get("hasNextPage"):
                    pending.append((parent, page.get("endCursor")))
        frontier = next_frontier
        depth += 1
    return roots


# ---------------------------------------------------------------- closing PRs

def prs_query(batch):
    parts = []
    for idx, (ref, after) in enumerate(batch):
        o, r, n = sanitize(ref[0]), sanitize(ref[1]), int(ref[2])
        after_arg = f', after: "{after}"' if after else ""
        parts.append(
            f'i{idx}: repository(owner: "{o}", name: "{r}") {{ '
            f'issue(number: {n}) {{ '
            # includeClosedPrs surfaces closed-but-unmerged linked PRs too (merged/open are always in).
            f'closedByPullRequestsReferences(first: {PRS_PAGE}{after_arg}, includeClosedPrs: true) {{ totalCount '
            f'nodes {{ number title url state repository {{ nameWithOwner }} }} '
            f'pageInfo {{ hasNextPage endCursor }} }} }} }}')
    return "query {\n" + "\n".join(parts) + "\n}"


def unique_refs(roots):
    seen, order = set(), []
    for root in roots:
        for n in flatten(root):
            ref = ref_of(n)
            if ref not in seen and all(ref):
                seen.add(ref)
                order.append(ref)
    return order


def fetch_closing_prs(refs, batch_size, max_api, budget, stats):
    pr_map = {}
    pending = [(ref, None) for ref in refs]
    while pending:
        if budget[0] >= max_api:
            stats["truncated"] = True
            break
        batch = pending[:batch_size]
        pending = pending[batch_size:]
        budget[0] += 1
        data, errors = gh_graphql(prs_query(batch))
        log_errors(errors)
        for idx, (ref, _after) in enumerate(batch):
            block = (data or {}).get(f"i{idx}")
            issue = (block or {}).get("issue")
            if not issue:
                continue
            conn = issue.get("closedByPullRequestsReferences") or {}
            bucket = pr_map.setdefault(ref, [])
            for pr in (conn.get("nodes") or []):
                bucket.append({
                    "number": pr.get("number"),
                    "title": pr.get("title") or "",
                    "url": pr.get("url") or "",
                    "state": pr.get("state") or "",
                    "repo": (pr.get("repository") or {}).get("nameWithOwner") or "",
                })
            page = conn.get("pageInfo") or {}
            if page.get("hasNextPage"):
                pending.append((ref, page.get("endCursor")))
    return pr_map


def attach_prs(roots, pr_map):
    for root in roots:
        for n in flatten(root):
            n["prs"] = pr_map.get(ref_of(n), [])


def finalize_stats(roots, stats):
    stats["objectives"] = len(roots)
    uniq_issues, uniq_prs, md = set(), set(), 0
    for root in roots:
        for n in flatten(root):
            uniq_issues.add(ref_of(n))
            md = max(md, n.get("depth", 0))
            for pr in n.get("prs", []):
                uniq_prs.add((pr.get("repo"), pr.get("number")))
    stats["issues_crawled"] = len(uniq_issues)
    stats["prs_found"] = len(uniq_prs)
    stats["max_depth_reached"] = max(stats.get("max_depth_reached", 0), md)


# ---------------------------------------------------------------- reporting

def objective_prs(root):
    """Unique closing PRs anywhere in an objective's tree, each with the issues it closes."""
    seen, order = {}, []
    for node in flatten(root):
        for pr in node.get("prs", []):
            key = (pr.get("repo"), pr.get("number"))
            if key not in seen:
                seen[key] = {**pr, "closes": []}
                order.append(key)
            seen[key]["closes"].append(node["number"])
    prs = [seen[k] for k in order]
    prs.sort(key=lambda p: (p.get("repo") or "", p.get("number") or 0))
    return prs


def fname_slug(pi="", sprint=""):
    """Filename slug from the PI/Sprint filters: 'pi-27.2_sprint-5', 'pi-27.2', 'sprint-5', or 'all'.
    Strips a leading PI/Sprint label so both 'PI 27.2' and '27.2' → 'pi-27.2'."""
    parts = []
    for label, val in (("pi", pi), ("sprint", sprint)):
        v = re.sub(r"^(pi|sprint|iteration)\s+", "", (val or "").strip(), flags=re.IGNORECASE)
        v = re.sub(r"[^A-Za-z0-9._-]+", "-", v).strip("-").lower()
        if v:
            parts.append(f"{label}-{v}")
    return "_".join(parts) or "all"


def write_csv(roots, path, only_with_prs):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["objective_number", "objective_title", "objective_repo",
                    "issue_number", "issue_title", "issue_repo", "depth",
                    "pr_number", "pr_title", "pr_repo", "pr_state", "pr_url"])
        for root in roots:
            orepo = f"{root['owner']}/{root['name']}"
            for n in flatten(root):
                irepo = f"{n['owner']}/{n['name']}"
                prs = sorted(n.get("prs", []), key=lambda p: (p.get("repo") or "", p.get("number") or 0))
                if prs:
                    for pr in prs:
                        w.writerow([root["number"], root["title"], orepo,
                                    n["number"], n["title"], irepo, n["depth"],
                                    pr.get("number"), pr.get("title"), pr.get("repo"),
                                    pr.get("state"), pr.get("url")])
                elif not only_with_prs:
                    w.writerow([root["number"], root["title"], orepo,
                                n["number"], n["title"], irepo, n["depth"], "", "", "", "", ""])


def _stat_line(stats):
    line = (f"_{stats['objectives']} objectives · {stats['issues_crawled']} issues crawled · "
            f"{stats['prs_found']} closing PRs · depth {stats['max_depth_reached']}")
    if stats["truncated"]:
        line += " · ⚠ truncated (raise --max-api-calls)"
    return line + "_"


def render_markdown(roots, stats, board_title, now):
    L = [f"# PR Finder — {board_title}", "", _stat_line(stats), "", f"_Generated: {now}_", ""]
    for root in roots:
        n = root["number"]
        link = f"[#{n}]({root['url']})" if root.get("url") else f"#{n}"
        L.append(f"## {root['title']} {link}")
        prs = objective_prs(root)
        if not prs:
            L += ["- _No closing PRs found_", ""]
            continue
        for pr in prs:
            repo_hash = f"{pr['repo']}#{pr['number']}" if pr.get("repo") else f"#{pr['number']}"
            closes = ", ".join(f"#{c}" for c in pr["closes"])
            L.append(f"- [{repo_hash}]({pr['url']}) — {pr['title']} · **{pr['state']}**  "
                     f"_(closes {closes})_")
        L.append("")
    return "\n".join(L)


CSS = """
:root{
  --blue-60v:#005ea2; --blue-warm-70v:#1a4480; --base-lightest:#f0f0f0;
  --base-lighter:#dfe1e2; --base:#71767a; --base-ink:#1b1b1b;
  --green-cool-40v:#00a91c; --red-50v:#d83933; --gold-20v:#ffbe2e;
}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--base-ink);line-height:1.5;
  font-family:"Source Sans Pro","Public Sans",-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:2rem 1.25rem 4rem}
h1{font-size:1.9rem;margin:0 0 1rem;font-weight:700}
h1 .muted{font-weight:400}
a{color:var(--blue-60v);text-decoration:none}
a:hover{text-decoration:underline}
.summary-box{background:var(--base-lightest);border:1px solid var(--base-lighter);
  border-radius:.25rem;padding:1.25rem 1.5rem;margin:0 0 2rem}
.summary-box .stats{list-style:none;display:flex;flex-wrap:wrap;gap:2.25rem;margin:0;padding:0}
.summary-box .stats li{display:flex;flex-direction:column}
.summary-box .stats b{font-size:1.9rem;line-height:1;color:var(--blue-warm-70v)}
.summary-box .stats span{font-size:.78rem;text-transform:uppercase;letter-spacing:.03em;color:var(--base)}
.summary-box .gen{margin:1rem 0 0;font-size:.85rem;color:var(--base)}
.objective{border-top:1px solid var(--base-lighter);padding-top:1rem;margin-top:1.5rem}
.objective h2{font-size:1.25rem;margin:0 0 .5rem}
.objective h2 .num{font-weight:400;font-size:.95rem}
ul.pr-list{margin:.25rem 0 1rem;padding-left:1.25rem}
ul.pr-list li{margin:.35rem 0}
ul.pr-list li.empty{list-style:none;color:var(--base);font-style:italic;margin-left:-1.25rem}
.pr-title{color:var(--base-ink)}
.muted{color:var(--base)}
.closes{font-size:.85rem}
.usa-tag{display:inline-block;border-radius:2px;padding:1px 6px;font-size:.68rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.03em;color:#fff;vertical-align:middle}
.tag-merged{background:var(--green-cool-40v)}
.tag-closed{background:var(--red-50v)}
.tag-open{background:var(--blue-60v)}
.tag-warn{background:var(--gold-20v);color:var(--base-ink)}
"""


def _state_tag(state):
    s = (state or "").upper()
    cls = {"MERGED": "merged", "CLOSED": "closed", "OPEN": "open"}.get(s, "open")
    return f'<span class="usa-tag tag-{cls}">{html.escape(s or "?")}</span>'


def render_html(roots, stats, board_title, now):
    esc = html.escape
    P = ["<!doctype html>", '<html lang="en"><head><meta charset="utf-8">',
         '<meta name="viewport" content="width=device-width, initial-scale=1">',
         f"<title>PR Finder — {esc(board_title)}</title>",
         "<style>" + CSS + "</style></head><body>", '<main class="wrap">',
         f"<h1>PR Finder <span class='muted'>— {esc(board_title)}</span></h1>"]

    trunc = ' <span class="usa-tag tag-warn">truncated</span>' if stats["truncated"] else ""
    P.append('<div class="summary-box"><ul class="stats">'
             f"<li><b>{stats['objectives']}</b><span>objectives</span></li>"
             f"<li><b>{stats['issues_crawled']}</b><span>issues crawled</span></li>"
             f"<li><b>{stats['prs_found']}</b><span>closing PRs</span></li>"
             f"<li><b>{stats['max_depth_reached']}</b><span>max depth</span></li>"
             f"</ul><p class='gen'>Generated {esc(now)}{trunc}</p></div>")

    for root in roots:
        num = root["number"]
        head = esc(root["title"])
        numlink = (f" <a class='num' target='_blank' rel='noopener' href='{esc(root['url'])}'>#{num}</a>"
                   if root.get("url") else f" <span class='num'>#{num}</span>")
        P.append(f"<section class='objective'><h2>{head}{numlink}</h2>")
        prs = objective_prs(root)
        if not prs:
            P.append("<ul class='pr-list'><li class='empty'>No closing PRs found</li></ul></section>")
            continue
        P.append("<ul class='pr-list'>")
        for pr in prs:
            repo_hash = f"{pr['repo']}#{pr['number']}" if pr.get("repo") else f"#{pr['number']}"
            link = (f"<a target='_blank' rel='noopener' href='{esc(pr['url'])}'>{esc(repo_hash)}</a>"
                    if pr.get("url") else esc(repo_hash))
            closes = ", ".join(f"#{c}" for c in pr["closes"])
            P.append(f"<li>{link} <span class='pr-title'>{esc(pr['title'])}</span> "
                     f"{_state_tag(pr['state'])} "
                     f"<span class='muted closes'>closes {esc(closes)}</span></li>")
        P.append("</ul></section>")

    P.append("</main></body></html>")
    return "\n".join(P)


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project-url", help="board URL (.../orgs|users/<owner>/projects/<n>)")
    ap.add_argument("--owner", help="board owner (with --number)")
    ap.add_argument("--number", type=int, help="board number (with --owner)")
    ap.add_argument("--max-depth", type=int, default=5, help="sub-issue depth (0-5)")
    ap.add_argument("--max-api-calls", type=int, default=400, help="GraphQL request budget")
    ap.add_argument("--batch-size", type=int, default=20, help="aliases per GraphQL request")
    ap.add_argument("--only-objectives", default="", help="comma list of objective title substrings")
    ap.add_argument("--pi", default="", help="only objectives in this Program Increment board field (e.g. 'PI 27.2'); prefix optional")
    ap.add_argument("--sprint", default="", help="only objectives in this Sprint board field; prefix optional")
    ap.add_argument("--only-with-prs", action="store_true", help="omit CSV rows for issues with no PR")
    ap.add_argument("--tree-json", help="offline: pre-crawled {board_title,roots} tree")
    ap.add_argument("--out-dir", default="reports")
    ap.add_argument("--now", default="unknown")
    args = ap.parse_args()

    stats = {"objectives": 0, "issues_crawled": 0, "prs_found": 0,
             "max_depth_reached": 0, "api_calls": 0, "truncated": False}

    if args.tree_json:
        payload = json.load(open(args.tree_json, encoding="utf-8"))
        roots = payload.get("roots", [])
        for root in roots:
            normalize_node(root, 0)
        board_title = payload.get("board_title", "offline")
    else:
        owner, number = resolve_owner_number(args)
        board_title = get_board_title(owner, number)
        objectives = read_objectives(owner, number, args.only_objectives,
                                     pi=args.pi, sprint=args.sprint)
        max_depth = max(0, min(5, args.max_depth))
        budget = [0]
        roots = crawl_all(objectives, max_depth, args.max_api_calls, args.batch_size, budget, stats)
        pr_map = fetch_closing_prs(unique_refs(roots), args.batch_size,
                                   args.max_api_calls, budget, stats)
        attach_prs(roots, pr_map)
        stats["api_calls"] = budget[0]

    finalize_stats(roots, stats)

    os.makedirs(args.out_dir, exist_ok=True)
    slug = fname_slug(args.pi, args.sprint)
    base = f"pr_finder_{slug}"
    files = {"csv": base + ".csv", "md": base + ".md",
             "html": base + ".html", "stats": base + "_stats.json"}

    md = render_markdown(roots, stats, board_title, args.now)
    write_csv(roots, os.path.join(args.out_dir, files["csv"]), args.only_with_prs)
    with open(os.path.join(args.out_dir, files["md"]), "w", encoding="utf-8") as fh:
        fh.write(md + "\n")
    with open(os.path.join(args.out_dir, files["html"]), "w", encoding="utf-8") as fh:
        fh.write(render_html(roots, stats, board_title, args.now) + "\n")
    with open(os.path.join(args.out_dir, files["stats"]), "w", encoding="utf-8") as fh:
        json.dump(stats, fh, indent=2)

    # Fixed-name metadata so the action/workflow/dashboard can locate the slugged files.
    manifest = {"slug": slug, "pi": args.pi, "sprint": args.sprint, "generated": args.now,
                "board_title": board_title, "files": files, "stats": stats}
    with open(os.path.join(args.out_dir, "pr_finder_manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)

    print(md)


if __name__ == "__main__":
    main()
