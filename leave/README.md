# Leave Tracker action

> 🗓️ **Live dashboard →** https://veda-leave-dashboard.netlify.app — filterable calendar of who's out + high-risk teams.

Turn the team **leave tracker** spreadsheet into normalized data (CSV + JSON) so anyone can see
**who is out**, build a **calendar from a chosen set of people**, and spot **high-risk teams**
(too many people out on the same day).

## The catch: the status is in the CELL COLORS
The source `.xlsx` is a **calendar matrix**, not a tidy table — each team tab has a person per row
and a day per column, and a person's status on a day is encoded by the **cell fill color** (the day
cells hold no text). A plain CSV export of the workbook would be blank. So this action reads the
`.xlsx` **directly** with the Python **standard library** (`zipfile` + `xml.etree` — no `openpyxl`,
no pip deps), decoding fill colors → leave categories via the [color map](#color-map).

- **Tabs used:** every team tab; `Conferences`, `Meetings`, and the `LEAVE TEMPLATE` helper are skipped.
- **Notes:** cell comments (e.g. "half day", "Pod week") are attached to the matching day for hover text.
- **Dates:** reconstructed from the header rows (month + day-of-month), with the year inferred from `pi`.

## Setup

### Use it in another repo
```yaml
# .github/workflows/leave-tracker.yml in the consuming repo
jobs:
  leave:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: NASA-IMPACT/veda-github-actions/leave@v1
        id: leave
        with:
          xlsx-path: leave/source/DSE Leave Tracker - 26.4.xlsx   # the workbook in your repo
          pi: "26.4"
          # risk-threshold: "0.30"   # optional: default % of a team OUT to flag
          # teams: ""                # optional: comma list of tabs (empty = all)
          # out-dir: reports         # optional
      # report is now in ${{ steps.leave.outputs.report-dir }}:
      #   leaves_<slug>.csv/.json, leave_coverage_<slug>.json (+ leave_manifest.json)
```

### Inputs
| Input | Required | Default | Description |
|---|---|---|---|
| `xlsx-path` | | `leave/source/DSE Leave Tracker - 26.4.xlsx` | Path to the workbook (in the repo, or fetched first). |
| `pi` | | `""` | PI label, e.g. `26.4` — drives the filename slug + year inference. |
| `year` | | `""` | Override the inferred calendar year. |
| `teams` | | `""` | Comma-separated team tabs to include (empty = all). |
| `overrides-dir` | | `leave/overrides` | Per-person override JSON files layered on top of the xlsx. |
| `colors` | | `""` | Optional JSON color→category overrides (else the built-in map). |
| `risk-threshold` | | `0.30` | Default fraction of a team OUT that flags a high-risk day. |
| `out-dir` | | `reports` | Where the report files are written. |

### Outputs
| Output | Description |
|---|---|
| `report-dir` | Directory containing the report files. |
| `people` | Number of people found across the team tabs. |
| `teams` | Number of team tabs parsed. |
| `leave-days` | Total person-days flagged OUT. |

## Outputs (files)
| File | What |
|---|---|
| `leaves_<slug>.csv` | One row per person/day/status (`team,person,person_slug,role,date,weekday,iso_week,status,out,out_weight,note,source`). |
| `leaves_<slug>.json` | `{meta, people:[{slug,name,team,role,leaves:[…]}], warnings}` — the dashboard's primary source. |
| `leave_coverage_<slug>.json` | Per-team-per-day `{out_count, out_weight, out_pct, people_out, limited}`; the dashboard applies the risk threshold live. |
| `leave_manifest.json` | Fixed name — maps the slugged files + holds `stats` (used by the action outputs + dashboard). |

`<slug>` comes from `pi` (`26.4` → `leaves_26.4.json`; empty → `all`).

## OUT definition & risk
`out` (weight 1.0) = **Unavailable + Planned Time Off + Holidays**. **Limited** counts as 0.5.
**WFH** and **Work Travel** are available (0.0). A team-day is **high-risk** when the OUT fraction
(`out_weight / team_size`) meets the threshold (default 30%, adjustable live in the dashboard).

## Color map
| Color | Category | OUT? |
|---|---|---|
| `FFFF0000` / `FFF4CCCC` | unavailable | ✅ (1.0) |
| `FFFFFF00` / `FFFCE5CD` | limited | partial (0.5) |
| `FFE6B8AF` | holiday | ✅ (1.0) |
| `FFD9D2E9` | planned_time_off | ✅ (1.0) |
| `FFFFF2CC` | work_travel | — |
| `FFD9EAD3` | wfh | — |
| `FFC9DAF8` | other | — |
| `FF999999` (weekend), grid/white | ignored | — |

Override or extend the map with a `colors` JSON (see `colors.json`). Unknown non-ignored fills are
surfaced in `warnings[]` and treated as available (fail-open).

## Adding / correcting people without editing the workbook
Drop a per-person file in [`overrides/`](overrides/README.md) (the dashboard's **Add person** button
opens a prefilled PR that does exactly this). Overrides win over the xlsx per (person, date); a new
person's team counts toward that team's size.

## Run / test locally
```bash
# Live parse of the real workbook:
python leave/generate_leave_tracker.py \
  --xlsx "leave/source/DSE Leave Tracker - 26.4.xlsx" --pi 26.4 --out-dir reports --now "$(date -u +%FT%TZ)"

# Offline (no workbook) against the fixture:
python leave/generate_leave_tracker.py --from-json leave/fixtures/leaves_sample.json --pi sample --out-dir /tmp/leave
```

Standard library only, deterministic output ordering (clean diffs). See
[`../docs/LEAVE_TRACKER.md`](../docs/LEAVE_TRACKER.md) for the data model + gotchas.
