# veda-github-actions

**A test station for reusable VEDA GitHub Actions, Projects-v2 board seeds, and Netlify dashboards.**
One repo where we iterate safely on reusable Actions, their seed/generator tooling, and the SPAs that
render the output — without touching production. It currently ships **three composite actions**, an
**AWS pricing data generator**, and **five dashboards**. Intentionally open — it grows to host new
VEDA Actions experiments.

## 📋 Project board → https://github.com/users/kyle-lesinger/projects/2

### APPS !!!
### 📊**FTE Dashboard:** https://veda-github-actions.netlify.app
### 🔀 **PR Finder Dashboard:** https://veda-pr-dashboard.netlify.app
### 🗓️ **Leave Dashboard:** https://veda-leave-dashboard.netlify.app
### 🧭 **DSE Hub:** https://veda-dse-hub.netlify.app
### 💵 **AWS Cost Calculator (Disasters Hub):** https://veda-aws-dashboard.netlify.app

## Reusable actions
Each action is a **composite** you import with `uses:`. One repo exposes many via subfolders.

| Action | Import (`uses:`) | What it does |
|---|---|---|
| **FTE Capacity Report** | `NASA-IMPACT/veda-github-actions@v1` | Reads a board's Objective issues, joins each issue's `## LOE/FTE` table with its PI/date board fields → per-PI CSVs + `fte_summary.md`. |
| **PR Finder** | `NASA-IMPACT/veda-github-actions/pr-finder@v1` | Crawls each Objective's sub-issue tree (5 levels, cross-repo/org) → the PRs that **close** those issues → CSV + Markdown + USWDS HTML. |
| **Leave Tracker** | `NASA-IMPACT/veda-github-actions/leave@v1` | Parses a color-coded leave `.xlsx` (status = cell **fill color**, no text) → `leaves_<slug>.{csv,json}` + coverage. No token/network. |

- **Generators are stdlib-only Python 3.12 + the `gh` CLI** (no pip deps).
- Board-reading actions need a project-read token — `PROJECT_TOKEN_FOR_BOARD_READS` (classic PAT
  `repo+read:org+project`, or an App token). The default `GITHUB_TOKEN` **cannot** read Projects v2.
- Inputs and copy-paste workflow snippets live in each module's doc under [`docs/`](docs/).

## Dashboards & apps
Each dashboard is its **own Netlify site** ("Pattern B": one site per folder, base directory = that
folder, its own `netlify.toml`). Live links are in [APPS](#apps-) above.

| App | Folder | What it shows |
|---|---|---|
| FTE Dashboard | [`fte-dashboard/`](fte-dashboard/) | Capacity matrix + what-if PI editor; fetches report CSVs at runtime. |
| PR Finder Dashboard | [`pr-dashboard/`](pr-dashboard/) | Renders accumulated PR-per-Objective reports with a report picker. |
| Leave Dashboard | [`leave-dashboard/`](leave-dashboard/) | Calendar of who's out, person-picker, team-risk heatmap, add-person-via-PR. |
| DSE Hub | [`dse-hub/`](dse-hub/) | Tabbed hub: meeting tracker (list / calendar / categories, timezone-aware) + PI roadmap; edits stage in a Changes cart → one prefilled PR. |
| AWS Cost Calculator | [`cost-dashboard/`](cost-dashboard/) | EC2/S3/RDS/Lambda cost calculator on live AWS On-Demand prices + CSV export. |

## Repo layout
| Path | Role |
|---|---|
| [`action.yml`](action.yml), [`pr-finder/`](pr-finder/), [`leave/`](leave/) | the three reusable composite actions |
| [`.github/scripts/`](.github/scripts/), [`aws-pricing/`](aws-pricing/), [`seed/`](seed/) | generators + seed/bootstrap tooling (stdlib Python) |
| [`.github/workflows/`](.github/workflows/) | self-consumer workflows that run each action/generator and publish to a report branch |
| `*-dashboard/`, [`dse-hub/`](dse-hub/) | the Netlify SPAs above |
| [`docs/`](docs/) | per-module deep-dives |

## Per-module docs
- **FTE Capacity Report** — seed, PI-change test loop, reset/reseed, board fields: [`docs/FTE_SEED.md`](docs/FTE_SEED.md)
- **PR Finder** — crawl model, seed harness, gotchas: [`docs/PR_FINDER.md`](docs/PR_FINDER.md)
- **Leave Tracker** — color map, overrides, gotchas: [`docs/LEAVE_TRACKER.md`](docs/LEAVE_TRACKER.md)
- **DSE Hub** — tabs, recurrence, timezone, Changes cart: [`docs/DSE_HUB.md`](docs/DSE_HUB.md)
- **AWS pricing generator** — Price List API pull, weekly review: [`docs/AWS_PRICING.md`](docs/AWS_PRICING.md)
- **Design decisions log**: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Conventions (non-obvious)
- Generators are **stdlib-only Python 3.12 + `gh` subprocess** — no `requests`, no pip deps.
- **"Objective"** = the issue title contains `"objective"` (case-insensitive). Shared by the actions.
- **One Netlify site per dashboard; no root `netlify.toml`** — a root config (and its `base` key)
  applies to *every* site connected to the repo and would hijack the others into building the wrong app.
- Root `.gitignore` has `*.json`, so `git add <dir>` silently skips needed JSON (each dashboard's
  `package.json`/`tsconfig*.json`, data JSON) — you must **`git add -f`** them.

---
Ported from `Disasters-Learning-Portal/disasters-aws-conversion` (PR #74). See [`docs/FTE_SEED.md`](docs/FTE_SEED.md).
