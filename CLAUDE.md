# Project Guide — veda-github-actions

A **test station for VEDA GitHub Actions + Projects-v2 board seeds** — a safe place to iterate on
reusable Actions and board seed data. It ships **two reusable composite actions** plus seed tooling
and Netlify dashboards.

## The two actions (one repo can expose many via subfolders)
| Action | Path | What it does |
|---|---|---|
| **FTE Capacity Report** | root `action.yml` → `uses: NASA-IMPACT/veda-github-actions@v1` | Reads a board's Objective issues, joins each issue's `## LOE/FTE` body table with its PI/date board fields, writes CSVs + `fte_summary.md`. |
| **PR Finder** | `pr-finder/` → `uses: NASA-IMPACT/veda-github-actions/pr-finder@v1` | Crawls each Objective's **sub-issue tree (to 5 levels, cross-repo/org)** and lists the PRs that **close** those issues → CSV + H2-per-objective Markdown + USWDS HTML. |

## Hard conventions (non-obvious)
- **Generators are stdlib-only Python 3.12 + the `gh` CLI as a subprocess.** No `requests`, no pip
  deps. Every script has a retrying `gh()`/`gh_json()` wrapper (see `seed/setup_project.py:25-43`,
  replicated in `pr-finder/generate_pr_finder.py` and `seed/seed_subissue_tree.py`).
- **Auth = `PROJECT_TOKEN_FOR_BOARD_READS`**: a classic PAT with **`repo+read:org+project`** (or a
  fine-grained/App token). The default `GITHUB_TOKEN` **cannot** read Projects v2 (missing `read:org`
  → "unknown owner type"). Exported as `GH_TOKEN`/`GITHUB_TOKEN` for `gh`.
- **"Objective" detection** = the issue title contains `"objective"` (case-insensitive). Shared by
  both actions (`is_objective`).

## Data model the crawler relies on
board → **Objective** issues → **sub-issue** hierarchy → **closing PRs**.
- Sub-issues: GraphQL `subIssues` connection works **without** any `GraphQL-Features` header (verified
  live). Traversal is a single **global BFS**, alias-batched (≤20 parents/request), paginated via
  `pageInfo`. Each node carries `repository.nameWithOwner`, so the crawl spans repos/orgs; unreadable
  repos degrade gracefully (per-alias `FORBIDDEN`/`NOT_FOUND` → empty children, keep going).
- Closing PRs: `closedByPullRequestsReferences(includeClosedPrs: true)` — the `closes #N`/linked-branch
  relationship (NOT cross-references). `includeClosedPrs` also surfaces closed-but-unmerged PRs.

## Run / test
```bash
# PR Finder — offline (no network) against a canned tree:
python pr-finder/generate_pr_finder.py --tree-json seed/sample_tree.json --out-dir reports
# PR Finder — live crawl of a board:
export GH_TOKEN=<PAT repo+read:org+project>
python pr-finder/generate_pr_finder.py --project-url <board-url> --max-depth 5 --out-dir reports
# FTE — offline:
python .github/scripts/generate_fte_report.py --issues-json seed/sample_issues.json --out-dir reports
```
Seeding a crawlable tree (creates real issues/PRs — see `docs/PR_FINDER.md`):
`seed/seed_subissue_tree.py` (build) / `seed/cleanup_subissue_tree.py` (teardown). Cross-org via
`--hop-repo OWNER/NAME --hop-at-depth D`. Sub-issue links use `addSubIssue` (REST fallback needs the
child's **`databaseId`**, not its node id).

## Netlify (multiple sites, one per dashboard — "Pattern B")
Each dashboard is its own Netlify site, connected to this repo with a different **base directory**;
Netlify reads the `netlify.toml` **inside that base dir**, so the sites stay isolated.
- `fte-dashboard/` — Vite React SPA; **root** `netlify.toml` (base=`fte-dashboard`, build, publish `dist`).
  Fetches report CSVs at runtime from the `fte-report/all-pis` branch.
- `pr-dashboard/` — static shell (no build); `pr-dashboard/netlify.toml` (base=`pr-dashboard`,
  publish `.`). Fetches `pr_finder.html` at runtime from the `pr-finder/report` branch (published by
  `.github/workflows/pr-finder.yml`); falls back to the bundled `pr-dashboard/pr_finder.html` snapshot.

## Gotchas
- **Issue-triggered run-storms:** the FTE action deployed in another repo with `on: issues:` runs on
  every issue open/edit/close. This repo's `fte-report.yml` keeps that trigger **commented out** on
  purpose so a seed run doesn't cause a storm. (Seeding into such a repo will flood *its* Actions tab.)
- **Merging seed PRs** can be blocked by a base-branch policy → the seeder warns and leaves the PR OPEN.
- **Shared working directory:** if multiple agents/sessions share this checkout, `git commit` lands on
  whatever branch is currently checked out — watch which branch HEAD is on before committing.
- **Cross-repo sub-issue REST fallback** posts to the *parent's* repo with the *child's* `databaseId`.

## Key files
`action.yml`, `pr-finder/action.yml`, `pr-finder/generate_pr_finder.py`,
`.github/scripts/generate_fte_report.py`, `seed/seed_subissue_tree.py`, `seed/cleanup_subissue_tree.py`,
`.github/workflows/{fte-report,pr-finder}.yml`, `docs/{FTE_SEED,PR_FINDER}.md`, `docs/DECISIONS.md`.
