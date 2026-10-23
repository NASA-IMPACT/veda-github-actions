#!/usr/bin/env python3
"""Sync a milestone table (a Slack canvas, or a CSV) into GitHub milestones on one repo.

The table needs a header row naming Task and Deadline columns (Project and Owner are optional),
like the "FY27 Milestones" canvas. A blank Project cell inherits the project above it, as the
canvas's merged Project cells read. Each row becomes one milestone:
  title       = first line of Task (the identity: an existing milestone with this exact title is
                updated in place, never duplicated)
  due_on      = parsed from Deadline: "October 1, 2026" -> that day; "Dec 2026" / "Q1 FY27 -
                December 2026" -> last day of that month; "Iteratively through FY27" -> 2027-09-30
                (end of the federal fiscal year); anything else ("TBD", "Late 2027") -> no due date
  description = project, owner, the deadline as written, and the rest of the Task text

Dry-run by default (prints the plan); --apply creates/updates. It never deletes or closes a
milestone, and never clears a due date it can't parse (so a "TBD" edit leaves the old date).

Sources (--source):
  https://<ws>.slack.com/docs/<team>/<F...>  Slack canvas: files.info -> url_private_download
                                             (HTML). Needs SLACK_TOKEN with files:read that can
                                             see the canvas.
  path/to/file.csv | .html                   offline, same table

Standard library only; GitHub calls go through `gh` (GH_TOKEN needs write access to --repo).
"""
import argparse
import calendar
import csv
import datetime
import html.parser
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

CANVAS_RE = re.compile(r"slack\.com/docs/[A-Z0-9]+/(F[A-Z0-9]+)")
MONTH = (r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
         r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?")
DAY_RE = re.compile(MONTH + r"\s+(\d{1,2}),?\s+(\d{4})\b", re.I)
MONTH_RE = re.compile(MONTH + r"\s+(\d{4})\b", re.I)
FY_RE = re.compile(r"\bFY\s?(\d{2})\b", re.I)
MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}


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


# ---------------------------------------------------------------- reading the table

class TableParser(html.parser.HTMLParser):
    """Collect every <table> as rows of (text, rowspan, colspan); <br>/<p>/<li>/<div> -> newline."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self.tables.append([])
        elif tag == "tr" and self.tables:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = ([], int(a.get("rowspan") or 1), int(a.get("colspan") or 1))
        elif tag in ("br", "p", "li", "div") and self.cell is not None:
            self.cell[0].append("\n")

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            parts, rs, cs = self.cell
            self.row.append(("".join(parts), rs, cs))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.tables[-1].append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell[0].append(data)


def expand_spans(rows):
    """Lay (text, rowspan, colspan) rows out on a plain grid, copying spanned text into each slot."""
    grid, carry = [], {}  # carry: col -> [rows still covered, text]
    for row in rows:
        out, cells, c = [], list(row), 0
        while cells or any(k >= c for k in carry):
            if c in carry:
                out.append(carry[c][1])
                carry[c][0] -= 1
                if not carry[c][0]:
                    del carry[c]
            elif cells:
                text, rs, cs = cells.pop(0)
                for _ in range(cs):
                    if rs > 1:
                        carry[c] = [rs - 1, text]
                    out.append(text)
                    c += 1
                continue
            else:
                out.append("")
            c += 1
        grid.append(out)
    return grid


def html_tables(text):
    p = TableParser()
    p.feed(text)
    return [expand_spans(t) for t in p.tables]


def fetch_canvas(file_id, token):
    def get(url):
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()

    info = json.loads(get(f"https://slack.com/api/files.info?file={file_id}"))
    if not info.get("ok"):
        sys.exit(f"Slack files.info failed: {info.get('error')} — the token needs files:read and "
                 "access to the canvas (a bot must be in a channel the canvas is shared to).")
    f = info["file"]
    body = get(f.get("url_private_download") or f["url_private"]).decode("utf-8", "replace")
    if "<table" not in body.lower():
        sys.exit("The canvas download has no <table> (a sign-in page, or the canvas has no table).")
    return body


def read_tables(source, slack_token):
    m = CANVAS_RE.search(source)
    if m:
        if not slack_token:
            sys.exit("A Slack canvas source needs SLACK_TOKEN (files:read).")
        return html_tables(fetch_canvas(m.group(1), slack_token))
    with open(source, encoding="utf-8-sig") as fh:
        text = fh.read()
    if source.lower().endswith(".csv"):
        return [list(csv.reader(io.StringIO(text)))]
    return html_tables(text)


def clean(text):
    lines = (" ".join(ln.replace("\xa0", " ").split()) for ln in text.split("\n"))
    return [ln for ln in lines if ln]


def milestone_rows(tables):
    """The first table whose header names Task and Deadline -> [{project, task, owner, deadline}]."""
    for grid in tables:
        for h, header in enumerate(grid):
            names = [" ".join(clean(c)).lower() for c in header]
            col = {k: next((i for i, n in enumerate(names) if n.startswith(k)), None)
                   for k in ("project", "task", "owner", "deadline")}
            if col["task"] is None or col["deadline"] is None:
                continue
            rows, project = [], ""

            def cell(r, k):
                i = col[k]
                return clean(r[i]) if i is not None and i < len(r) else []

            for r in grid[h + 1:]:
                project = " ".join(cell(r, "project")) or project
                task = cell(r, "task")
                if task:
                    rows.append({"project": project, "task": task,
                                 "owner": " ".join(cell(r, "owner")),
                                 "deadline": " ".join(cell(r, "deadline"))})
            return rows
    sys.exit("No table with Task and Deadline header columns found.")


# ---------------------------------------------------------------- deadline -> due date

def parse_due(text):
    if m := DAY_RE.search(text):
        return datetime.date(int(m[3]), MONTHS[m[1][:3].lower()], int(m[2]))
    if m := MONTH_RE.search(text):
        y, mo = int(m[2]), MONTHS[m[1][:3].lower()]
        return datetime.date(y, mo, calendar.monthrange(y, mo)[1])
    if m := FY_RE.search(text):
        return datetime.date(2000 + int(m[1]), 9, 30)
    return None


def desired(row, source):
    lines = [f"Project: {row['project']}" if row["project"] else "",
             f"Owner: {row['owner']}" if row["owner"] else "",
             f"Deadline (as written): {row['deadline'] or '—'}",
             *row["task"][1:],
             f"Source: {source}" if "://" in source else ""]
    due = parse_due(row["deadline"])
    return {"title": row["task"][0], "description": "\n".join(ln for ln in lines if ln),
            "due": due.isoformat() if due else None}


# ---------------------------------------------------------------- plan / apply

def existing_milestones(repo):
    out = gh(["api", "--paginate", f"repos/{repo}/milestones?state=all&per_page=100",
              "--jq", ".[] | {number, title, description, due_on, state}"])
    return {m["title"]: m for m in map(json.loads, out.splitlines())}


def plan(wanted, have):
    steps, seen = [], set()
    for w in wanted:
        if w["title"] in seen:
            steps.append(("skip-duplicate", w, None))
            continue
        seen.add(w["title"])
        m = have.get(w["title"])
        if m is None:
            steps.append(("create", w, None))
            continue
        changed = (m["description"] or "") != w["description"] or (
            w["due"] and (m["due_on"] or "")[:10] != w["due"])
        steps.append(("update" if changed else "unchanged", w, m))
    return steps


def apply(repo, steps):
    for action, w, m in steps:
        if action not in ("create", "update"):
            continue
        args = ["-f", f"title={w['title']}", "-f", f"description={w['description']}"]
        if w["due"]:
            args += ["-f", f"due_on={w['due']}T12:00:00Z"]
        if action == "create":
            gh(["api", "-X", "POST", f"repos/{repo}/milestones", *args])
        else:
            gh(["api", "-X", "PATCH", f"repos/{repo}/milestones/{m['number']}", *args])


def report(repo, steps, applied):
    verb = "Applied" if applied else "Dry run (nothing written)"
    n = {a: sum(1 for s in steps if s[0] == a) for a in ("create", "update", "unchanged")}
    lines = [f"### Milestones → `{repo}` — {verb}", "",
             f"**{n['create']}** create · **{n['update']}** update · **{n['unchanged']}** unchanged", "",
             "| Action | Milestone | Due | Deadline as written |", "|---|---|---|---|"]
    for action, w, _ in steps:
        written = w["description"].split("Deadline (as written): ", 1)[1].split("\n", 1)[0]
        due = w["due"] or "⚠ none (unparsed)"
        lines.append(f"| {action} | {w['title'].replace('|', '/')} | {due} | {written.replace('|', '/')} |")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True, help="Slack canvas URL, or a .csv/.html file")
    ap.add_argument("--repo", required=True, help="OWNER/NAME that receives the milestones")
    ap.add_argument("--project", default="",
                    help="only rows whose Project contains this text (case-insensitive); empty = all")
    ap.add_argument("--apply", action="store_true", help="create/update (default: dry run)")
    ap.add_argument("--offline", action="store_true",
                    help="don't read the repo; plan as if it had no milestones (tests)")
    a = ap.parse_args()

    rows = milestone_rows(read_tables(a.source, os.environ.get("SLACK_TOKEN", "")))
    rows = [r for r in rows if a.project.lower() in r["project"].lower()]
    if not rows:
        sys.exit(f"No rows match project {a.project!r}.")
    wanted = [desired(r, a.source) for r in rows]
    steps = plan(wanted, {} if a.offline else existing_milestones(a.repo))
    if a.apply:
        apply(a.repo, steps)
    md = report(a.repo, steps, a.apply)
    print(md)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as fh:
            fh.write(md)


if __name__ == "__main__":
    main()
