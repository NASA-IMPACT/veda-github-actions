# veda-github-actions

**A test station for VEDA GitHub Actions + Projects-v2 board seeds.** A safe place to iterate on
Actions and board seed data without touching production. First module: the **FTE capacity report**
(team staffing per Program Increment), so we can experiment with **PI changes** and see the report
diff. Intentionally open — it will grow to host other VEDA Actions experiments.

## 📋 Project board → https://github.com/users/kyle-lesinger/projects/2

### APPS !!!
### 📊**FTE Dashboard:** https://veda-github-actions.netlify.app
### 🔀 **PR Finder Dashboard:** https://veda-pr-dashboard.netlify.app
### 🗓️ **Leave Dashboard:** https://veda-leave-dashboard.netlify.app

## Use this action in another repo
The report is a **reusable composite action** (`action.yml`). Any repo can import it — just point
it at a Projects v2 board and give it a project-read token. Only **two required inputs**; the repo,
owner, and project number are derived:

```yaml
# .github/workflows/fte.yml in the consuming repo
jobs:
  fte:
    runs-on: ubuntu-latest
    steps:
      - uses: NASA-IMPACT/veda-github-actions@v1
        id: report
        with:
          project-url: https://github.com/orgs/YOUR-ORG/projects/5   # your board
          token: ${{ secrets.PROJECT_TOKEN_FOR_BOARD_READS }}        # PAT: repo+read:org+project (or an App token)
          # pi: "PI 27.2"        # optional — default is all PIs
      # report CSVs + summary are now in ${{ steps.report.outputs.report-dir }} (default: reports/)
```

The action reads the board, joins each Objective's `## LOE/FTE` table with its PI/dates, and writes
PI-slugged `fte_allocations_<slug>.csv` (+ `by_person`, `by_role`, `fte_summary_<slug>.md`; slug = `pi-26.4` or `all-pis`). **Publishing the result is the
caller's choice** — this repo's own [`fte-report.yml`](.github/workflows/fte-report.yml) dogfoods the
action (`uses: ./`) and then publishes to a `fte-report/<pi>` branch + opens a living PR.

## What's here
| Path | Role |
|---|---|
| `action.yml` | **the reusable action** (composite): board → report files. Minimal inputs (`project-url`, `token`). |
| `.github/workflows/fte-report.yml` | thin self-consumer of the action (`uses: ./`) that publishes to `fte-report/<pi>` (+ artifact + PR) |
| `.github/scripts/generate_fte_report.py` | the generator the action runs (Python **stdlib only**) |
| `seed/` | recreate the demo: sample issues → real issues → board fields → populate |
| `fte-dashboard/` | React SPA (Netlify) — Capacity Matrix + what-if editor |
| `docs/FTE_SEED.md` | data model, board fields, gotchas |
| `pr-finder/` | **2nd reusable action** (`uses: .../pr-finder@v1`): crawl objectives' sub-issue trees (5 levels, cross-org) → closing PRs (CSV + MD + USWDS HTML) |
| `.github/workflows/pr-finder.yml` | self-consumer that publishes the PR report to the `pr-finder/report` branch |
| `pr-dashboard/` | static Netlify site rendering the PR report — [live](https://veda-pr-dashboard.netlify.app) |
| `docs/PR_FINDER.md` | PR Finder data model, seed harness, gotchas |
| `leave/` | **3rd reusable action** (`uses: .../leave@v1`): parse a color-coded leave `.xlsx` (status = cell fill) → `leaves_<slug>.{csv,json}` + coverage (stdlib, no token) |
| `.github/workflows/leave-tracker.yml` | self-consumer that publishes the leave report to the `leave-tracker/report` branch |
| `leave-dashboard/` | React SPA (Netlify) — calendar of who's out, person-picker, team-risk heatmap, add-person-via-PR — [live](https://veda-leave-dashboard.netlify.app) |
| `docs/LEAVE_TRACKER.md` | Leave Tracker data model, color map, overrides, gotchas |

## Quickstart

**Offline (no board / no network) — runs the generator on synthetic data:**
```bash
python seed/generate_sample_issues.py
python .github/scripts/generate_fte_report.py \
  --issues-json seed/sample_issues.json --out-dir reports --now "$(date -u +%FT%TZ)"
# → reports/fte_allocations_all-pis.csv (+ fte_by_person_all-pis.csv, fte_by_role_all-pis.csv, fte_summary_all-pis.md, fte_manifest.json)
```

**Against the live board (recreate the seed once):**
```bash
python seed/bootstrap_board.py            # create the 6 board fields on projects/2
gh label create Objective && gh label create poc-loe
python seed/generate_sample_issues.py
python seed/create_issues.py              # create the Objective issues in this repo
python seed/setup_project.py              # add to board + set PI / Start / End
python seed/setup_board_grouping.py       # set Project / Initiative / Team
```
Then add the token secret and run the Action:
```bash
gh secret set PROJECT_TOKEN_FOR_BOARD_READS --repo NASA-IMPACT/veda-github-actions   # classic PAT: repo+read:org+project
gh workflow run fte-report.yml -f pi="All PIs"
```

## PI-change test loop (the point of this repo)
1. Change PIs: edit `PIS` in `seed/generate_sample_issues.py` and/or `PI_WINDOWS` in
   `.github/scripts/generate_fte_report.py`; or add a PI option on the board + in the workflow's
   `pi` dropdown.
2. Re-seed (or edit the board directly) and re-run the Action.
3. Diff the report on `fte-report/<pi>` to see the effect.

## Reset / reseed
```bash
python seed/cleanup_issues.py --delete    # remove the demo issues (dry-run without a flag)
```
Delete/recreate the board in the GitHub UI for a fully clean slate.

## Dashboard + Netlify
Static Vite + React SPA. Its build config lives in **`fte-dashboard/netlify.toml`** (base-relative:
build `npm run build`, publish `dist`). Connect a Netlify site to this repo on `main` with
**base directory = `fte-dashboard`**; Netlify reads that folder's `netlify.toml`. Because the repo is
public, the deployed SPA fetches `fte-report/all-pis` at runtime, so new reports appear on reload with
**no redeploy**. Local dev:
```bash
cd fte-dashboard && npm ci && npm run dev
```

**One independent site per dashboard.** This repo is a test station for many Actions, so each
dashboard is its **own** Netlify site: give it its own `<app>/netlify.toml` and connect a new site
with **base directory = that folder**. Keep **no `netlify.toml` at the repo root** — Netlify applies
a root config (and its `base` key) to *every* site connected to the repo, which would hijack the
others into building the wrong app.

---
Ported from `Disasters-Learning-Portal/disasters-aws-conversion` (PR #74). See `docs/FTE_SEED.md`.
