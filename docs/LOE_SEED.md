# LOE capacity report — seed & data model

The first test module. Reports team staffing capacity from **Objective** issues + a
**Projects v2** board. FTE is summed per person **per Program Increment (PI)**; > 1.0 =
over-allocated. A duration-**weighted FTE** adjusts for objectives that cover only part of a PI.

## Data split (important)
- **Issue body** holds the `## LOE/FTE` table — `| Person | Role | FTE | Notes |`. Roles are a
  fixed set (PM, Frontend, Backend, Geospatial, Data Curator, Comms, ML, Designer, Jupyterhub);
  any other role or non-numeric FTE is skipped + warned.
- **Board fields** hold everything else, **per objective**: **Program Increment**, **Start/End
  dates**, and **Project / Initiative / Team**. The generator joins body + board by issue number.

## Board fields (created by `seed/bootstrap_board.py`)
| Field | Type | Notes |
|---|---|---|
| Program Increment | single-select | `PI 26.4`, `PI 27.2` — add more to test PI changes. Windows come from `PI_WINDOWS` in the generator; the parser also handles a real **iteration** PI field. |
| Start Date / End Date | date | the objective's own window inside the PI |
| Project / Initiative / Team | single-select | grouping fields; **Initiative** drives the dashboard's Capacity Matrix grouping |

## Seed order (`seed/`)
`generate_sample_issues.py` (→ `sample_issues.json`) → `create_issues.py` (real issues) →
`setup_project.py` (add to board + PI/Start/End) → `setup_board_grouping.py` (Project/Initiative/Team).
Tracking files (`created_issues.json`, `project_items.json`) stay in `seed/`. Board = the personal
project **`kyle-lesinger/projects/2`** (isolated from the org project list).

## Generator + workflow
`.github/scripts/generate_loe_report.py` (stdlib) accepts `--project-json` (board JSON),
`--issues-json` (offline sample), or `--from-dir`; `--pi "PI 26.4"` filters. It emits
`loe_allocations.csv` (with `project,initiative,team`), `loe_by_person.csv`, `loe_by_role.csv`,
and `loe_summary.md`. The workflow `loe-report.yml` runs it against the board and publishes to
`loe-report/<pi>` (+ artifact + run summary). Adding a board field ⇒ no code change: the parser
reads any field generically via `_item_field(it, "<name>")`.

## Reconciliation invariant (tested)
Σ allocation FTE == Σ by_person == Σ by_role, per PI, for both raw and weighted (weighted is
rounded per-allocation, so it reconciles to the cent). Sample assignment of PI / Initiative /
Project / Team is **deterministic** (seeded + index-based) so reports diff cleanly across runs.

## Gotchas
- **`PROJECT_TOKEN`** (repo secret) = **classic PAT** `repo` + `read:org` + `project`. The default
  `GITHUB_TOKEN` cannot read Projects v2. `unknown owner type` from `gh project` ⇒ missing `read:org`.
- **GraphQL rate limit is 5,000/hr** — a full reseed makes 150+ board mutations; space them out or
  you'll get throttled (the Action's board read will then fail until the hour resets).
- Dashboard reads the **public** `loe-report/all-pis` branch at runtime (`loe-dashboard/src/data.ts`
  `RAW_BASE`), with the bundled `public/data/` snapshot as fallback.

Full dashboard internals: source repo `Disasters-Learning-Portal/disasters-aws-conversion`, PR #74.
