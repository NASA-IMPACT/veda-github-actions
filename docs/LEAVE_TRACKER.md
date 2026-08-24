# Leave Tracker — data model & gotchas

Turns the team leave-tracker spreadsheet into normalized data + an interactive Netlify calendar
(who's out, build-your-own calendar by person, high-risk teams). Action: [`leave/`](../leave/);
dashboard: [`leave-dashboard/`](../leave-dashboard/); workflow:
[`.github/workflows/leave-tracker.yml`](../.github/workflows/leave-tracker.yml).

## How updates reach the live dashboard (the whole flow)
There are exactly **three kinds of change**, and each has one automatic path — no manual steps:

| You change… | What happens | Result |
|---|---|---|
| **The Google Sheet** (where the team actually tracks leave) | Nothing — the **hourly** run re-exports the sheet as `.xlsx`, reparses it, and republishes the report | New data live within the hour |
| **A person / leave / new team** via the dashboard's **Add leave** button (`leave/overrides/**`) | The prefilled PR is validated and **merged automatically** → the push trigger regenerates the report | Live ~2 min after the PR is opened |
| **Dashboard app** (`leave-dashboard/**`) | Merge to `main` → Netlify builds (`netlify.toml` has **no build-ignore**, so it always publishes) | New UI live in ~1 min |

The **PI is inferred from the workbook filename** (`… 26.4.xlsx` → `26.4`), so nothing needs configuring
when a new PI workbook is dropped in. To force a refresh (or override the PI), run it by hand:
`gh workflow run leave-tracker.yml` — or GitHub → Actions → **Leave Tracker** → **Run workflow**.

### Hourly Google Sheets sync
The team edits leave in a Google Sheet. For a long time the only way that reached the dashboard was
**someone downloading the `.xlsx` and committing it by hand** — so the dashboard silently served
month-old data and looked perfectly healthy while doing it. Now the workflow re-exports the sheet
every hour:

- Set the repo **variable** `LEAVE_SHEET_ID` to the sheet's document id. Unset ⇒ the step is skipped
  and the committed workbook is used, exactly as before.
- The export URL is `https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx` and needs **no
  credentials** — the sheet just has to be link-shareable. Google's xlsx export **preserves the cell
  fill colors**, which is the entire data model here (verified: the export parses to byte-identical
  results vs. a hand-downloaded copy).
- The download overwrites the workbook **in the runner's workspace only** — it is never committed, so
  `main` stays clean and the PI keeps being inferred from the committed filename.
- **A sheet that loses link-sharing returns HTTP 200 with an HTML sign-in page**, which `curl -f`
  accepts happily. The step therefore verifies the download is a real zip before trusting it, and
  falls back to the committed workbook with a `::warning::` rather than publishing garbage.
- Scheduled workflows are **disabled by GitHub after 60 days of repo inactivity** — if the dashboard
  goes stale for no obvious reason, check that first.
- An hourly run that finds no new data commits **nothing**: the report manifest's `generated`
  timestamp changes every run, so the publish step explicitly ignores a manifest-only,
  timestamp-only diff. Without that the report branch would collect 24 empty commits a day.

### Auto-merged leave overrides
`.github/workflows/leave-override-automerge.yml` validates and merges the PRs the dashboard's **Add
leave** button opens, so a person's dates go live without anyone approving anything.

A PR is auto-merged **only** when every one of these holds — otherwise it gets a comment saying
exactly what is wrong and stays open:

| Check | Rule |
|---|---|
| Author | has write/maintain/admin on the repo, or is a member of the org |
| Paths | every changed file matches `leave/overrides/<slug>.json` |
| Change type | `added` / `modified` / `removed` only, at most 5 files, ≤ 64 KB each |
| Content | passes [`leave/scripts/validate_overrides.py`](../leave/scripts/validate_overrides.py) |
| State | open, not a draft |

Two non-obvious things about that workflow, both load-bearing:

- It uses **`pull_request_target`**, because a `pull_request` run from a fork gets a read-only token
  and no secrets and could never merge. That is safe here only because the job **never checks out or
  runs the PR head** — it reads the changed-file list and each file's content through the API, and
  refuses anything outside `leave/overrides/`. Override files are inert data.
- It merges with the **PAT, not `GITHUB_TOKEN`**. A push made by `GITHUB_TOKEN` does not trigger
  further workflows, so merging with it would silently fail to fire this workflow's own `push`
  trigger — the PR would merge and the dashboard still would not update. The PAT also satisfies
  `main`'s 1-approving-review rule.

**Submitters need write access** for the smooth path. A read-only user is sent through GitHub's fork
prompt in the web editor, and that is where they tend to abandon — which is precisely how one
person's update went missing for weeks. Their PR still auto-merges if they push through it, as long
as they are an org member.

> The `leave-tracker/report` branch is **machine-managed / publish-only** — never open a PR from it
> into `main` (that just dumps generated report files onto `main`).

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
