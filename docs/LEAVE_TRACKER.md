# Leave Tracker — data model & gotchas

Turns the team leave-tracker spreadsheet into normalized data + an interactive Netlify calendar
(who's out, build-your-own calendar by person, high-risk teams). Action: [`leave/`](../leave/);
dashboard: [`leave-dashboard/`](../leave-dashboard/); workflow:
[`.github/workflows/leave-tracker.yml`](../.github/workflows/leave-tracker.yml).

## The source is a color-coded calendar (not a table)
`leave/source/DSE Leave Tracker - 26.4.xlsx` is a matrix: **one team tab per team**, a **person per
row**, a **day per column**, and a person's status on a day is the **cell FILL COLOR** — the day cells
contain no text. A plain CSV export would be blank. The generator reads the `.xlsx` directly with the
Python **standard library** (`zipfile` + `xml.etree`), no `openpyxl`, no pip deps.

### Tab layout (per team tab)
| Row | Contents |
|---|---|
| 1 | `UNAVAILABLE` legend cell (fill `FFFF0000`) |
| 2 | `LIMITED AVAILABILITY` legend cell (fill `FFFFFF00`) |
| 3 | Sprint/week markers (merged): `PI Planning`, `Sprint 1 Week 1`, `Flex Week`, … |
| 4 | Month labels — **sparse** (only at some columns), carried forward |
| 5 | `Date` + day-of-month numbers (stored as floats, e.g. `6.0`) |
| 6 | `Day` / `Team` + weekday names |
| 7+ | **data**: col A = person, col B = team/role token, cols C… = per-day colored cells |

Tabs **`Conferences`**, **`Meetings`**, and **`LEAVE TEMPLATE`** are skipped (the template's colors
define the legend, but it holds no people).

### Color → category (overridable via `leave/colors.json`)
| Fill (ARGB) | Category | OUT? / weight |
|---|---|---|
| `FFFF0000`, `FFF4CCCC` | `unavailable` | OUT · 1.0 |
| `FFFFFF00`, `FFFCE5CD` | `limited` | partial · 0.5 |
| `FFE6B8AF` | `holiday` | OUT · 1.0 |
| `FFD9D2E9` | `planned_time_off` | OUT · 1.0 |
| `FFFFF2CC` | `work_travel` | available · 0.0 |
| `FFD9EAD3` | `wfh` | available · 0.0 |
| `FFC9DAF8` | `other` | available · 0.0 |
| `FF999999` | weekend shading | ignored |
| `FFD9D9D9`, `FFCCCCCC`, white/none/theme0 | grid / empty | ignored |

Unknown non-ignored fills are added to `warnings[]` and treated as available (fail-open, surfaced in
the action summary + a dashboard banner).

### Dates & notes
- Year isn't in the sheet → inferred from the PI (`26.4` → 2026); `--year` overrides. The month
  **advances when the day number wraps** (31→1), because a weekend can fall under the previous month's
  merged label. (This file is Jul 6 → Oct 25 2026, no Dec→Jan rollover — keep `--year` for PIs that
  cross year-end.)
- Reasons come from `xl/threadedComments/*` (e.g. "half day", "Pod week"), attached to the day and
  shown on hover. The legacy `xl/comments1.xml` holds only Excel boilerplate and is ignored.

## Outputs
`slug` comes from the PI (`26.4` → `leaves_26.4.*`; empty → `all`).

| File | Shape |
|---|---|
| `leaves_<slug>.csv` | `team,person,person_slug,role,date,weekday,iso_week,status,out,out_weight,note,source` |
| `leaves_<slug>.json` | `{meta, people:[{slug,name,team,role,leaves:[{date,status,out,weight,note,source}]}], warnings}` — dashboard primary |
| `leave_coverage_<slug>.json` | per-team-per-day `{team_size,out_count,out_weight,out_pct,people_out,limited}` |
| `leave_manifest.json` | fixed name — `{slug,pi,year,generated,files,stats}` (action outputs + dashboard entry point) |

Verified live against the real workbook: **70 people** (DevSeed 31, UAH 25, 2i2c 7, DSE-Manage 6,
MSFC 1), span **2026-07-06 → 2026-10-25**, Fanny Casal `unavailable` Jul 13–17, 0 warnings.

## Overrides — add/correct people without editing the workbook
Per-person JSON files in [`leave/overrides/`](../leave/overrides/) layer on top of the xlsx; overrides
win per (person, date). A file may hold **one person** (object) or **several** (array / `{"people":[…]}`)
so one PR can add many. A new person's `team` counts toward that team's size; a team not on the sheet
**creates a new team**. `{"status":"available"}` is a tombstone that clears an xlsx leave. Schema and
examples: [`leave/overrides/README.md`](../leave/overrides/README.md).

The dashboard's **Add person** button builds a prefilled GitHub PR that creates such a file (no
backend), and can **preview** the additions on the calendar before you open the PR.

## Dashboard (Pattern B)
Features: a **month calendar** of who's out, a **person multi-select** ("build a calendar"), team/status
filters, and a **team-risk heatmap** with a live % threshold. Plus: **Export PNG** (3× render of the
current calendar + legend), **Copy link** (encodes the filtered view — people/teams/statuses/month/
view/threshold — in the URL hash so it reopens exactly), and an **Add-person** modal that toggles
between **existing person** (autocompletes a name → merges new leave dates onto their slug) and
**new person** (with a brand-new team), batching everyone into one prefilled PR and previewing them
on the calendar first.

`leave-dashboard/` is its own Netlify site (base dir = `leave-dashboard`, its own `netlify.toml`). At
runtime it fetches `leave_manifest.json` → the slugged JSONs from the `leave-tracker/report` branch —
the branch name is slashed, so the raw URL needs the **`/refs/heads/`** form:
`https://raw.githubusercontent.com/NASA-IMPACT/veda-github-actions/refs/heads/leave-tracker/report/reports`.
If that 404s (branch not seeded / offline) it falls back to the bundled `public/data/` snapshot and
shows a `● Snapshot` badge. Until the workflow seeds `leave-tracker/report` once, the site serves the
snapshot — same bootstrapping as `pr-dashboard`.

## Run / test
```bash
# Live parse of the real workbook:
python leave/generate_leave_tracker.py \
  --xlsx "leave/source/DSE Leave Tracker - 26.4.xlsx" --pi 26.4 --out-dir reports --now "$(date -u +%FT%TZ)"

# Offline (no workbook), deterministic:
python leave/generate_leave_tracker.py --from-json leave/fixtures/leaves_sample.json --pi sample --out-dir /tmp/leave

# Dashboard:
cd leave-dashboard && npm ci && npm run typecheck && npm run build && npm run dev
```

## Gotchas
- **Names have trailing whitespace** in the sheet ("Kiri Carini ", "Zac Deziel ") → `.strip()` for
  identity/slug, raw kept for display.
- **`DSE - Manage`** is treated as a team (managers count toward coverage); exclude via `--teams`.
- **`MSFC`** has one person, so its risk % is 0% or 100% — no divide-by-zero (team_size ≥ 1).
- **Risk % is weighted** (limited = 0.5); the coverage JSON also carries raw `out_count` if you want
  a headcount view instead.
- **Netlify Deploy Previews** of an overrides-only PR still show old data — the report regenerates only
  when the workflow runs after merge. Use the in-app **Preview** to see additions pre-merge.
