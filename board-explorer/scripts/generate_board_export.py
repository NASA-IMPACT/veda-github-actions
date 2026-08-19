#!/usr/bin/env python3
"""Export a GitHub Projects v2 board to one flat JSON document the Board Explorer SPA reads.

WHY THIS IS NOT `gh project item-list`
--------------------------------------
The two older board readers in this repo (`pr-finder/generate_pr_finder.py`,
`.github/scripts/generate_fte_report.py`) both use `gh project item-list --format json`,
which flattens field values but exposes only `content.{type,title,url,number,body}`. It has
no issue/PR **state**, no `merged`, no label colors, no assignee avatars, no milestone, no
timestamps and no sub-issue progress — all of which this app is built to show. So this
generator talks GraphQL directly. The `gh()`/`gh_graphql()`/`sanitize()` wrappers below are
lifted from `pr-finder/generate_pr_finder.py:48-124`; the deterministic `write_json` and the
`--reindex-only` manifest rebuild come from `aws-pricing/generate_aws_pricing.py:350-395`.

FIELD-AGNOSTIC BY DESIGN
------------------------
Board fields are **discovered**, never hardcoded: whatever `fields(first: 60)` returns is
written to `fields` and every item's values land in `items[].fields` keyed by field name.
Adding a column to the board therefore needs no code change here and no code change in the
SPA (which builds one filter picker per discovered field). Same goal `docs/FTE_SEED.md`
states for the FTE parser.

Inputs (pick one):
  --project-url URL     live read of a board (needs a token with `read:project`)
  --owner/--number      same, pre-split
  --graphql-json FILE   offline: a canned {"fields": <resp>, "items": [<resp>, ...]} bundle

Options:
  --out-dir, --body-chars, --now, --reindex-only DIR

Writes <out-dir>/board_<slug>.json + <out-dir>/index.json. Standard library only;
deterministic ordering throughout so branch diffs stay readable.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

PROJECT_URL_RE = re.compile(r"/(orgs|users)/([^/]+)/projects/(\d+)")
NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
ITEMS_PAGE = 50
DEFAULT_BOARD_URL = "https://github.com/orgs/Disasters-Learning-Portal/projects/5"

# Every board also exposes GitHub's built-in columns as "fields". Their values do NOT arrive
# through the `fieldValues` union — they come off `content` (assignees, labels, milestone,
# repository, timestamps, sub-issue progress) and are already top-level keys on each exported
# item. Emitting them into `fields` too would make the SPA build a second, permanently empty
# picker for each. So only the author-defined types below survive into `fields`.
CUSTOM_FIELD_TYPES = {"TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "ITERATION"}


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

    GitHub returns `data` and `errors` together for partial failures, so callers inspect
    both. Retries RATE_LIMITED / transient errors with capped backoff.
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
            sys.stderr.write(f"[board-explorer] rate limited; waiting {wait:.1f}s (attempt {attempt})\n")
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
    """Guard owner before interpolating into a query (injection defense)."""
    if not NAME_RE.match(name or ""):
        raise ValueError(f"unsafe GitHub name: {name!r}")
    return name


def log_errors(errors):
    for e in errors or []:
        typ = e.get("type") or "ERROR"
        path = ".".join(str(p) for p in (e.get("path") or []))
        msg = e.get("message") or ""
        sys.stderr.write(f"[board-explorer] graphql {typ} at {path}: {msg}\n")


# ---------------------------------------------------------------- GraphQL

# `$owner`/`$number` are real GraphQL variables; only the ROOT (organization vs user) is
# interpolated, and it comes from a regex-matched literal, never from free text.
FIELDS_QUERY = """
query($owner: String!, $number: Int!) {
  %(root)s(login: $owner) {
    projectV2(number: $number) {
      id
      number
      title
      url
      shortDescription
      public
      closed
      items { totalCount }
      fields(first: 60) {
        nodes {
          __typename
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField {
            options { id name color description }
          }
          ... on ProjectV2IterationField {
            configuration {
              duration
              startDay
              iterations { id title startDate duration }
              completedIterations { id title startDate duration }
            }
          }
        }
      }
    }
  }
}
"""

# `bodyText` (not `body`) — the search index wants prose, not markdown syntax.
ITEMS_QUERY = """
query($owner: String!, $number: Int!, $cursor: String) {
  %%(root)s(login: $owner) {
    projectV2(number: $number) {
      items(first: %(page)d, after: $cursor) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          type
          isArchived
          createdAt
          updatedAt
          fieldValues(first: 30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldTextValue {
                text
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                optionId
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldIterationValue {
                title
                startDate
                duration
                iterationId
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
          content {
            __typename
            ... on DraftIssue {
              title
              bodyText
              createdAt
              updatedAt
              creator { login }
              assignees(first: 10) { nodes { login name avatarUrl } }
            }
            ... on Issue {
              number title url bodyText state stateReason
              createdAt updatedAt closedAt
              author { login }
              issueType { name }
              milestone { title dueOn }
              repository { nameWithOwner }
              comments { totalCount }
              subIssuesSummary { total completed percentCompleted }
              parent { number title url repository { nameWithOwner } }
              assignees(first: 10) { nodes { login name avatarUrl } }
              labels(first: 20) { nodes { name color } }
            }
            ... on PullRequest {
              number title url bodyText state isDraft merged mergedAt
              createdAt updatedAt closedAt
              additions deletions changedFiles reviewDecision
              author { login }
              milestone { title dueOn }
              repository { nameWithOwner }
              comments { totalCount }
              assignees(first: 10) { nodes { login name avatarUrl } }
              labels(first: 20) { nodes { name color } }
            }
          }
        }
      }
    }
  }
}
""" % {"page": ITEMS_PAGE}


def root_for(owner_type):
    """`/orgs/<x>/projects/N` reads through `organization`, `/users/<x>/...` through `user`."""
    return "organization" if owner_type == "orgs" else "user"


def fetch_board(owner, number, owner_type):
    """Live read: one query for the field schema, then paginate the items."""
    root = root_for(owner_type)
    data, errors = gh_graphql(FIELDS_QUERY % {"root": root},
                              {"owner": owner, "number": number})
    log_errors(errors)
    project = ((data.get(root) or {}).get("projectV2")) or {}
    if not project:
        raise RuntimeError(
            f"board {owner}/{number} returned no data — is the token missing `read:project`?")

    items_query = ITEMS_QUERY % {"root": root}
    pages, cursor = [], None
    while True:
        variables = {"owner": owner, "number": number}
        if cursor:
            variables["cursor"] = cursor
        page, errors = gh_graphql(items_query, variables)
        log_errors(errors)
        conn = (((page.get(root) or {}).get("projectV2")) or {}).get("items") or {}
        pages.append(page)
        info = conn.get("pageInfo") or {}
        if not info.get("hasNextPage"):
            break
        cursor = info.get("endCursor")
        if not cursor:
            break
    return {"fields": data, "items": pages, "root": root}


# ---------------------------------------------------------------- flattening

def _field_name(node):
    return ((node.get("field") or {}).get("name")) or ""


def field_value(node):
    """One `ProjectV2ItemFieldValue` union member -> a plain JSON value.

    Iteration values keep their window (title/start/duration) because the Timeline view
    draws sprint bands from them; everything else collapses to a scalar.
    """
    typ = node.get("__typename") or ""
    if typ == "ProjectV2ItemFieldTextValue":
        return node.get("text")
    if typ == "ProjectV2ItemFieldNumberValue":
        return node.get("number")
    if typ == "ProjectV2ItemFieldDateValue":
        return node.get("date")
    if typ == "ProjectV2ItemFieldSingleSelectValue":
        return node.get("name")
    if typ == "ProjectV2ItemFieldIterationValue":
        return {"title": node.get("title"),
                "startDate": node.get("startDate"),
                "duration": node.get("duration")}
    return None


def flatten_fields(fields_response, root):
    """Board metadata + the discovered field schema."""
    project = ((fields_response.get(root) or {}).get("projectV2")) or {}
    fields = []
    for node in ((project.get("fields") or {}).get("nodes") or []):
        if not node:
            continue
        data_type = node.get("dataType") or ""
        if data_type not in CUSTOM_FIELD_TYPES:
            continue
        entry = {
            "id": node.get("id"),
            "name": node.get("name"),
            "type": data_type.lower(),
        }
        if node.get("options") is not None:
            entry["options"] = [{"name": o.get("name"), "color": o.get("color")}
                                for o in node["options"]]
        config = node.get("configuration")
        if config:
            iters = (config.get("completedIterations") or []) + (config.get("iterations") or [])
            entry["iterations"] = [{"title": i.get("title"),
                                    "startDate": i.get("startDate"),
                                    "duration": i.get("duration")} for i in iters]
        fields.append(entry)
    return project, fields


def normalize_state(content):
    """One state vocabulary — open | closed | merged — across the three content types.

    GitHub reports a merged PR as state MERGED and a closed-unmerged one as CLOSED; an issue
    is OPEN/CLOSED; a draft item has no state at all and reads as open.

    Draftness is deliberately NOT a state. A draft PR is still an *open* PR on GitHub, so
    folding it into `state` would make `is:open` skip it. It travels as the separate `draft`
    flag below, which is what `is:draft` tests (together with kind == "draft").
    """
    typ = content.get("__typename")
    if typ == "DraftIssue":
        return "open"
    if typ == "PullRequest" and content.get("merged"):
        return "merged"
    return (content.get("state") or "open").lower()


KIND_BY_TYPENAME = {"Issue": "issue", "PullRequest": "pr", "DraftIssue": "draft"}


def flatten_item(node, body_chars):
    """One ProjectV2Item -> the flat record the SPA indexes. Returns None for redacted items."""
    content = node.get("content") or {}
    typ = content.get("__typename")
    kind = KIND_BY_TYPENAME.get(typ)
    if not kind:
        return None  # REDACTED items (no permission) carry no content — skip.

    people = [a for a in (((content.get("assignees") or {}).get("nodes")) or []) if a]
    labels = [l for l in (((content.get("labels") or {}).get("nodes")) or []) if l]
    repo = ((content.get("repository") or {}).get("nameWithOwner")) or ""
    body = (content.get("bodyText") or "").strip()

    item = {
        "id": node.get("id"),
        "kind": kind,
        "number": content.get("number"),
        "title": content.get("title") or "",
        "url": content.get("url") or "",
        "repo": repo,
        "state": normalize_state(content),
        "draft": kind == "draft" or bool(content.get("isDraft")),
        "state_reason": (content.get("stateReason") or "").lower() or None,
        "author": ((content.get("author") or content.get("creator") or {}).get("login")) or None,
        "assignees": [a.get("login") for a in people if a.get("login")],
        "labels": [l.get("name") for l in labels if l.get("name")],
        "milestone": ((content.get("milestone") or {}).get("title")) or None,
        "issue_type": ((content.get("issueType") or {}).get("name")) or None,
        "created": content.get("createdAt") or node.get("createdAt"),
        "updated": content.get("updatedAt") or node.get("updatedAt"),
        "closed": content.get("mergedAt") or content.get("closedAt"),
        "comments": ((content.get("comments") or {}).get("totalCount")) or 0,
        "body_excerpt": body[:body_chars],
        "archived": bool(node.get("isArchived")),
        "fields": {},
    }

    summary = content.get("subIssuesSummary") or {}
    if summary.get("total"):
        item["sub"] = {"total": summary.get("total"), "completed": summary.get("completed") or 0}

    parent = content.get("parent")
    if parent:
        item["parent"] = {"number": parent.get("number"),
                          "title": parent.get("title"),
                          "url": parent.get("url")}

    if kind == "pr":
        item["review_decision"] = (content.get("reviewDecision") or "").lower() or None
        item["diff"] = {"additions": content.get("additions") or 0,
                        "deletions": content.get("deletions") or 0,
                        "files": content.get("changedFiles") or 0}

    for value in (((node.get("fieldValues") or {}).get("nodes")) or []):
        if not value:
            continue
        name = _field_name(value)
        resolved = field_value(value)
        # "Title" duplicates content.title on every board; drop it rather than ship it twice.
        if name and name != "Title" and resolved is not None:
            item["fields"][name] = resolved

    return item, people, labels


def build_export(bundle, now, body_chars):
    """The whole document. Deterministic: items by (repo, number); vocabularies sorted."""
    root = bundle.get("root") or "organization"
    project, fields = flatten_fields(bundle["fields"], root)

    items, people, labels, repos = [], {}, {}, set()
    for page in bundle["items"]:
        conn = (((page.get(root) or {}).get("projectV2")) or {}).get("items") or {}
        for node in (conn.get("nodes") or []):
            if not node:
                continue
            flat = flatten_item(node, body_chars)
            if not flat:
                continue
            item, item_people, item_labels = flat
            items.append(item)
            if item["repo"]:
                repos.add(item["repo"])
            for person in item_people:
                login = person.get("login")
                if login and login not in people:
                    people[login] = {"login": login,
                                     "name": person.get("name") or login,
                                     "avatar": person.get("avatarUrl") or ""}
            for label in item_labels:
                name = label.get("name")
                if name and name not in labels:
                    labels[name] = {"name": name, "color": label.get("color") or "888888"}

    items.sort(key=lambda i: (i["repo"], i["number"] if i["number"] is not None else 0, i["title"]))

    counts = {"items": len(items), "issues": 0, "prs": 0, "drafts": 0, "open": 0, "closed": 0}
    for item in items:
        counts["issues" if item["kind"] == "issue" else "prs" if item["kind"] == "pr" else "drafts"] += 1
        counts["closed" if item["state"] in ("closed", "merged") else "open"] += 1

    owner_login, owner_type = bundle.get("owner", ""), bundle.get("owner_type", "orgs")
    return {
        "schemaVersion": 1,
        "generated": now,
        "board": {
            "title": project.get("title") or f"project #{project.get('number')}",
            "url": project.get("url") or "",
            "number": project.get("number"),
            "owner": owner_login,
            "owner_type": "org" if owner_type == "orgs" else "user",
            "short_description": project.get("shortDescription") or "",
            "public": bool(project.get("public")),
            "closed": bool(project.get("closed")),
        },
        "fields": fields,
        "people": sorted(people.values(), key=lambda p: p["login"].lower()),
        "labels": sorted(labels.values(), key=lambda l: l["name"].lower()),
        "repos": sorted(repos),
        "items": items,
        "stats": counts,
    }


# ---------------------------------------------------------------- output

def board_slug(owner, number):
    return re.sub(r"[^a-z0-9._-]+", "-", f"{owner}-{number}".lower()).strip("-")


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, sort_keys=True, ensure_ascii=False)
        fh.write("\n")


def rebuild_index(out_dir, now, default_slug=""):
    """(Re)write index.json from every board_<slug>.json present in out_dir.

    Rebuilt from disk rather than appended to, so the publish workflow can refresh the
    manifest on the data branch with no network (`--reindex-only`).
    """
    boards = {}
    for fn in sorted(os.listdir(out_dir)):
        if not (fn.startswith("board_") and fn.endswith(".json")):
            continue
        with open(os.path.join(out_dir, fn), encoding="utf-8") as fh:
            doc = json.load(fh)
        slug = fn[len("board_"):-len(".json")]
        boards[slug] = {
            "file": fn,
            "title": doc.get("board", {}).get("title", slug),
            "url": doc.get("board", {}).get("url", ""),
            "generated": doc.get("generated", "unknown"),
            "items": doc.get("stats", {}).get("items", 0),
        }
    if default_slug not in boards and boards:
        default_slug = sorted(boards)[0]
    index = {"generated": now, "schemaVersion": 1,
             "defaultBoard": default_slug, "boards": boards}
    write_json(os.path.join(out_dir, "index.json"), index)
    return index


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Export a GitHub Projects v2 board to JSON.")
    ap.add_argument("--project-url", default="", help=f"board URL (default {DEFAULT_BOARD_URL})")
    ap.add_argument("--owner", default="", help="board owner login (with --number)")
    ap.add_argument("--number", default="", help="board number (with --owner)")
    ap.add_argument("--owner-type", default="orgs", choices=["orgs", "users"],
                    help="only needed alongside --owner/--number")
    ap.add_argument("--graphql-json", help="offline: canned {fields, items[]} bundle, no network")
    ap.add_argument("--out-dir", default="reports")
    ap.add_argument("--body-chars", type=int, default=600,
                    help="how much item body to keep for search (default 600)")
    ap.add_argument("--now", default="unknown", help="ISO timestamp stamped into outputs")
    ap.add_argument("--reindex-only", metavar="DIR",
                    help="no fetch: rebuild DIR/index.json from its board_*.json and exit")
    args = ap.parse_args()

    if args.reindex_only:
        index = rebuild_index(args.reindex_only, args.now)
        print(f"reindexed {args.reindex_only}: {len(index['boards'])} board(s)")
        return

    if args.graphql_json:
        with open(args.graphql_json, encoding="utf-8") as fh:
            bundle = json.load(fh)
        bundle.setdefault("root", "organization")
        owner = bundle.get("owner", "offline")
        number = int(bundle.get("number", 0))
    else:
        if args.owner and args.number:
            owner, number, owner_type = sanitize(args.owner), int(args.number), args.owner_type
        else:
            url = args.project_url or DEFAULT_BOARD_URL
            m = PROJECT_URL_RE.search(url)
            if not m:
                sys.exit(f"error: could not parse --project-url '{url}'")
            owner_type, owner, number = m.group(1), sanitize(m.group(2)), int(m.group(3))
        bundle = fetch_board(owner, number, owner_type)
        bundle["owner"], bundle["owner_type"] = owner, owner_type

    doc = build_export(bundle, args.now, args.body_chars)
    slug = board_slug(doc["board"]["owner"] or owner, doc["board"]["number"] or number)

    os.makedirs(args.out_dir, exist_ok=True)
    write_json(os.path.join(args.out_dir, f"board_{slug}.json"), doc)
    rebuild_index(args.out_dir, args.now, slug)

    s = doc["stats"]
    print(f"board_{slug}.json — {s['items']} items "
          f"({s['issues']} issues, {s['prs']} PRs, {s['drafts']} drafts; "
          f"{s['open']} open, {s['closed']} closed) · {len(doc['fields'])} fields")


if __name__ == "__main__":
    main()
