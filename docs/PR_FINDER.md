# PR Finder — data model, seed, gotchas

The **pr-finder** action starts from the *Objective* issues on a Projects v2 board, walks each
one's **sub-issue hierarchy down to N levels** (default 5, across repos/orgs, read-only), and lists
the pull requests that **close** those issues.

## Outputs (`out-dir`, default `reports/`)
| File | What |
|---|---|
| `pr_finder.csv` | one row per (issue, closing-PR): `objective_number, objective_title, objective_repo, issue_number, issue_title, issue_repo, depth, pr_number, pr_title, pr_repo, pr_state, pr_url`. Issues with no PR still get a row (blank `pr_*`) unless `--only-with-prs`. |
| `pr_finder.md` | GitHub-flavored: an `H2` per objective, then an unordered list of its PRs. Also appended to the Actions Step Summary. |
| `pr_finder.html` | self-contained, [USWDS](https://designsystem.digital.gov/)-styled (inline CSS, opens offline). |
| `pr_finder_stats.json` | `{objectives, issues_crawled, prs_found, max_depth_reached, api_calls, truncated}` — the action reads this for its step outputs. |

## How the crawl works
- **Objective detection:** a board item is an objective if its issue title contains `"objective"`
  (case-insensitive) — same rule as the FTE report. Seed root titles must include the word.
- **Traversal:** iterative **BFS by level** over the GraphQL `subIssues` connection, alias-batched
  (≤20 parents per request). It never deep-nests a single query (that blows up GraphQL node cost),
  and it paginates `subIssues` / `closedByPullRequestsReferences` via `pageInfo`.
- **Cross-repo/org:** every node carries `repository.nameWithOwner`, so the crawl follows sub-issues
  into other repos and orgs. Repos we can't read degrade gracefully — a per-alias `FORBIDDEN`/
  `NOT_FOUND` logs a warning and yields empty children; the crawl keeps going.
- **PR linkage — closing only:** `closedByPullRequestsReferences(includeClosedPrs: true)`. This is
  the "closes #N" / linked-branch relationship, **not** mere cross-references. `includeClosedPrs`
  surfaces closed-but-unmerged PRs alongside open/merged ones.
- **Budget:** `--max-api-calls` (default 400) caps GraphQL requests; hitting it flags the report
  `truncated` instead of failing. Depth is clamped to `0..5`.
- **Reads only `content.url` + `content.title`** from the board — any extra board fields are ignored,
  so board schema changes can't break it.

## Auth
Same token as the FTE action: a classic PAT with **repo + read:org + project**, a fine-grained PAT,
or a GitHub App token. The action exports it as `GH_TOKEN`/`GITHUB_TOKEN` for `gh`.

## Seeding a crawlable tree
The demo board is **flat** (50 objectives, no sub-issues, no PRs). `seed/seed_subissue_tree.py`
builds real data **in a repo you own** (cross-org depth is simulated there — you can't create issues
in other orgs). Shape per objective (`--depth 5 --branch-factor 2`): 1 root + 5 spine + 5 branch
leaves; PRs land on the leaves, the deepest spine node, and the root, with mixed OPEN/CLOSED/MERGED.

```bash
gh repo create you/veda-subissue-seed --private --add-readme        # a repo you own
python seed/seed_subissue_tree.py --repo you/veda-subissue-seed --dry-run     # preview the plan
python seed/seed_subissue_tree.py --repo you/veda-subissue-seed              # create it
```
Seed order (each step persisted to `seed/subissue_seed.json`, resumable with the SAME args):
1. **create issues** — `gh issue create` (parents first); labeled `subissue-seed`.
2. **backfill ids** — one batched GraphQL pass for each issue's `id` (node) + `databaseId` (REST).
3. **link** — `addSubIssue` GraphQL mutation (parent `issueId`, child `subIssueId`); REST fallback
   `POST /repos/{repo}/issues/{n}/sub_issues` with `sub_issue_id` = child **databaseId** (not node id).
4. **board** — add root objectives to the project (`gh project item-add`).
5. **PRs** — per selected issue: create a branch ref from default HEAD → PUT a scratch file
   (`seed-scratch/close-<n>.md`, base64) → `gh pr create --body "Closes #<n>"`; MERGED/CLOSED targets
   are then merged/closed.

Cleanup: `python seed/cleanup_subissue_tree.py` (dry-run) then `--close` or `--delete`. It removes
PRs → branches → board items → issues (children before parents), from the tracking file (or
`--by-label subissue-seed`).

## Run it
```bash
export GH_TOKEN=<PAT repo+read:org+project>
python pr-finder/generate_pr_finder.py \
  --project-url https://github.com/users/kyle-lesinger/projects/2 \
  --max-depth 5 --out-dir reports
open reports/pr_finder.html
```
Offline (no network), against a canned tree fixture:
```bash
python pr-finder/generate_pr_finder.py --tree-json seed/sample_tree.json --out-dir reports
```

## Gotchas
- **Sub-issue GraphQL** works without any `GraphQL-Features` header (verified on the live board);
  the `addSubIssue` mutation may not — the seeder falls back to REST automatically.
- **REST sub-issue link** needs the child's numeric `databaseId`, **not** the GraphQL node id.
- **Rate limits** (GraphQL 5,000/hr): batching + BFS keep requests low; the crawler backs off on
  `RATE_LIMITED`/secondary limits and, if the budget is exhausted, flags `truncated`.
- **Cycles/diamonds:** a repeat sub-issue ref is not re-descended (guarded by a per-tree seen set).
- **Merging seed PRs** can occasionally fail (branch protection, non-fast-forward) — the seeder warns
  and leaves such a PR open rather than aborting.
