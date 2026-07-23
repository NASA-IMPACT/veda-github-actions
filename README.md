# veda-github-actions

**A test station for VEDA GitHub Actions + Projects-v2 board seeds.** A safe place to iterate on
Actions and board seed data without touching production. First module: the **LOE capacity report**
(team staffing per Program Increment), so we can experiment with **PI changes** and see the report
diff. Intentionally open — it will grow to host other VEDA Actions experiments.

> ## 📋 Project board → https://github.com/users/kyle-lesinger/projects/2
> 📊 **Dashboard:** _Netlify — add the URL here once the site is connected._

## What's here
| Path | Role |
|---|---|
| `.github/workflows/loe-report.yml` | the Action: read the board → join each Objective's LOE table with its PI/dates → write a per-PI report to `loe-report/<pi>` (+ artifact + run summary) |
| `.github/scripts/generate_loe_report.py` | the generator (Python **stdlib only**) |
| `seed/` | recreate the demo: sample issues → real issues → board fields → populate |
| `loe-dashboard/` | React SPA (Netlify) — Capacity Matrix + what-if editor |
| `docs/LOE_SEED.md` | data model, board fields, gotchas |

## Quickstart

**Offline (no board / no network) — runs the generator on synthetic data:**
```bash
python seed/generate_sample_issues.py
python .github/scripts/generate_loe_report.py \
  --issues-json seed/sample_issues.json --out-dir reports --now "$(date -u +%FT%TZ)"
# → reports/loe_allocations.csv (+ loe_by_person.csv, loe_by_role.csv, loe_summary.md)
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
gh secret set PROJECT_TOKEN --repo NASA-IMPACT/veda-github-actions   # classic PAT: repo+read:org+project
gh workflow run loe-report.yml -f pi="All PIs"
```

## PI-change test loop (the point of this repo)
1. Change PIs: edit `PIS` in `seed/generate_sample_issues.py` and/or `PI_WINDOWS` in
   `.github/scripts/generate_loe_report.py`; or add a PI option on the board + in the workflow's
   `pi` dropdown.
2. Re-seed (or edit the board directly) and re-run the Action.
3. Diff the report on `loe-report/<pi>` to see the effect.

## Reset / reseed
```bash
python seed/cleanup_issues.py --delete    # remove the demo issues (dry-run without a flag)
```
Delete/recreate the board in the GitHub UI for a fully clean slate.

## Dashboard + Netlify
Static Vite + React SPA. Connect a Netlify site to this repo on `main` (**base** `loe-dashboard`,
**publish** `dist` — see `netlify.toml`). Because the repo is public, the deployed SPA fetches
`loe-report/all-pis` at runtime, so new reports appear on reload with **no redeploy**. Local dev:
```bash
cd loe-dashboard && npm ci && npm run dev
```

---
Ported from `Disasters-Learning-Portal/disasters-aws-conversion` (PR #74). See `docs/LOE_SEED.md`.
