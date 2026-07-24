# PR Finder action

Crawl each **Objective** issue on a GitHub Projects v2 board down through its **sub-issue tree
(up to 5 levels, across repos/orgs)** and report the pull requests that **close** those issues —
as a CSV, a GitHub-flavored Markdown list, and a self-contained [USWDS](https://designsystem.digital.gov/)-styled HTML page.

## Purpose
Answer *"what PRs are landing under each objective?"* Objectives rarely have PRs directly — the work
lives in nested sub-issues several levels down. This action follows GitHub's native **sub-issue**
hierarchy from each objective and collects the closing PRs (via `closedByPullRequestsReferences` —
the `closes #N` / linked-branch relationship, not loose cross-references), then rolls them up per
objective. It reads only each board item's issue URL + title, so extra board fields never break it.

## Setup

### Use it in another repo
```yaml
# .github/workflows/pr-finder.yml in the consuming repo
jobs:
  prs:
    runs-on: ubuntu-latest
    steps:
      - uses: NASA-IMPACT/veda-github-actions/pr-finder@v1
        id: find
        with:
          project-url: https://github.com/orgs/YOUR-ORG/projects/5   # your board
          token: ${{ secrets.PROJECT_TOKEN_FOR_BOARD_READS }}        # PAT: repo+read:org+project (or an App token)
          # max-depth: "5"            # optional (0-5, default 5)
          # only-objectives: ""       # optional: comma-separated title substrings
          # out-dir: reports          # optional
      # report is now in ${{ steps.find.outputs.report-dir }}: pr_finder.csv / .md / .html
```

### Inputs
| Input | Required | Default | Description |
|---|---|---|---|
| `project-url` | ✅ | — | Board URL, e.g. `.../orgs/ORG/projects/5` or `.../users/USER/projects/2`. |
| `token` | ✅ | — | Projects v2 + issue read: classic PAT `repo+read:org+project`, fine-grained, or App token. |
| `max-depth` | | `5` | Sub-issue levels to crawl below each objective (`0`–`5`). |
| `max-api-calls` | | `400` | GraphQL request budget; if hit, the report is flagged `truncated` (not failed). |
| `only-objectives` | | `""` | Comma-separated objective-title substrings to include (empty = all). |
| `pi` | | `""` | Only objectives in this **Program Increment** board field, e.g. `PI 27.2` (the `PI ` prefix is optional). Empty = all. |
| `sprint` | | `""` | Only objectives in this **Sprint** board field (prefix optional). Empty = all. |
| `out-dir` | | `reports` | Where to write `pr_finder.csv` / `.md` / `.html`. |

### Outputs
`report-dir`, `objectives`, `issues-crawled`, `prs-found`, `truncated`.

### Run locally (no Action)
```bash
export GH_TOKEN=<PAT repo+read:org+project>
python pr-finder/generate_pr_finder.py \
  --project-url https://github.com/users/kyle-lesinger/projects/2 \
  --max-depth 5 --out-dir reports
open reports/pr_finder.html
```
Offline against a canned tree (no network):
```bash
python pr-finder/generate_pr_finder.py --tree-json seed/sample_tree.json --out-dir reports
```
The board is flat by default — see [`docs/PR_FINDER.md`](../docs/PR_FINDER.md) to **seed** a real
5-level sub-issue tree + sample PRs with `seed/seed_subissue_tree.py`.

## Output examples

**`pr_finder.md`** (an `H2` per objective, then a list of its PRs):
```markdown
# PR Finder — VEDA Actions Test — FTE

_2 objectives · 8 issues crawled · 3 closing PRs · depth 5_

## [Platform]-[Objective 1]: COG pipeline hardening [#101](…/issues/101)
- [kyle-lesinger/other-owned-repo#42](…/pull/42) — Shared schema v2 · **CLOSED**  _(closes #107)_
- [kyle-lesinger/veda-subissue-seed#900](…/pull/900) — Umbrella: pipeline hardening · **OPEN**  _(closes #101)_
- [kyle-lesinger/veda-subissue-seed#910](…/pull/910) — Add BACKOFF_JITTER env var · **MERGED**  _(closes #106)_

## [Comms]-[Objective 2]: Disaster dashboard redesign [#201](…/issues/201)
- _No closing PRs found_
```

**`pr_finder.csv`** (one row per issue/closing-PR):
```csv
objective_number,objective_title,objective_repo,issue_number,issue_title,issue_repo,depth,pr_number,pr_title,pr_repo,pr_state,pr_url
101,[Platform]-[Objective 1]: COG pipeline hardening,kyle-lesinger/veda-subissue-seed,106,L5: env var plumbing (leaf),kyle-lesinger/veda-subissue-seed,5,910,Add BACKOFF_JITTER env var,kyle-lesinger/veda-subissue-seed,MERGED,https://github.com/kyle-lesinger/veda-subissue-seed/pull/910
101,[Platform]-[Objective 1]: COG pipeline hardening,kyle-lesinger/veda-subissue-seed,107,L2: cross-repo data model,kyle-lesinger/veda-subissue-seed,2,42,Shared schema v2,kyle-lesinger/other-owned-repo,CLOSED,https://github.com/kyle-lesinger/other-owned-repo/pull/42
```

**`pr_finder.html`** — a USWDS-styled page: a summary box (objectives · issues crawled · closing PRs
· max depth, with a `truncated` warning tag when a limit was hit), then per objective an `H2` and an
unordered list of PRs, each with a colored state tag (🟩 MERGED · 🟥 CLOSED · 🟦 OPEN) linking to the PR.

## How it works (short)
Iterative **BFS by level** over the GraphQL `subIssues` connection, alias-batched (≤20 parents per
request), paginated via `pageInfo`; then closing PRs fetched the same way. Cross-repo/org is
automatic (each node carries its repo); unreadable repos degrade gracefully to empty children.
Standard-library Python + `gh` CLI only. Full detail: [`docs/PR_FINDER.md`](../docs/PR_FINDER.md).
