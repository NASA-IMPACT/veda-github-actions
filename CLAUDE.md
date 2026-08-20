# Project Guide — veda-github-actions

A **test station for VEDA GitHub Actions + Projects-v2 board seeds** — a safe place to iterate on
reusable Actions and board seed data. It ships **three reusable composite actions** plus seed tooling
and Netlify dashboards.

## The three actions (one repo can expose many via subfolders)
| Action | Path | What it does |
|---|---|---|
| **FTE Capacity Report** | root `action.yml` → `uses: NASA-IMPACT/veda-github-actions@v1` | Reads a board's Objective issues, joins each issue's `## LOE/FTE` body table with its PI/date board fields, writes CSVs + `fte_summary.md`. |
| **PR Finder** | `pr-finder/` → `uses: NASA-IMPACT/veda-github-actions/pr-finder@v1` | Crawls each Objective's **sub-issue tree (to 5 levels, cross-repo/org)** and lists the PRs that **close** those issues → CSV + H2-per-objective Markdown + USWDS HTML. |
| **Leave Tracker** | `leave/` → `uses: NASA-IMPACT/veda-github-actions/leave@v1` | Parses a **color-coded leave-tracker `.xlsx`** (status = cell FILL COLOR, no text) into `leaves_<slug>.{csv,json}` + `leave_coverage_<slug>.json` (who's out, high-risk teams). No token/network. |

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
  publish `.`). Reads `reports/index.json` from the `pr-finder/report` branch (accumulated, PI/sprint-named
  reports published by `.github/workflows/pr-finder.yml`) into a report picker; falls back to the bundled
  `pr-dashboard/index.snapshot.json` + snapshot HTML.
- `leave-dashboard/` — Vite React SPA; `leave-dashboard/netlify.toml` (base=`leave-dashboard`, build,
  publish `dist`). Reads `leave_manifest.json` → `leaves_<slug>.json` + `leave_coverage_<slug>.json` at
  runtime from the `leave-tracker/report` branch (slashed → raw URL needs the `/refs/heads/` form); falls
  back to the bundled `leave-dashboard/public/data/` snapshot. Month **calendar** of who's out, a
  **person multi-select** ("build a calendar"), a **team-risk heatmap** with a live % threshold, and an
  **Add-person** form that opens a **prefilled PR** creating `leave/overrides/<slug>.json` (one file may
  hold several people → one PR) with an in-app **preview** before the PR.
- `dse-hub/` — Vite React SPA; `dse-hub/netlify.toml` (base=`dse-hub`, build, publish `dist`); live at
  `veda-dse-hub.netlify.app`. A **tabbed hub** (header tabs + subtabs via `src/tabs.ts`): **Meetings →
  Meeting Tracker** (List / month **Calendar** with sprint bands / **Categories** views; search + team +
  sprint/PI filters; timezone-aware times) and **Sprints & PIs → PI Roadmap**. **USWDS palette, light-only**
  (no dark theme). **No generator/Action** — data is hand-entered JSON bundled at BUILD via
  `import.meta.glob` (no runtime fetch). Source of truth = compact **`data/meetings.json` + `data/pis.json`**
  arrays; adds/edits (meetings **and** PIs) stage in an in-app **Changes cart** → **one prefilled new-file
  PR** creating `dse-hub/data/changes/<ts>.json` (array of `ChangeDoc`), which the loaders **merge** over the
  canonical arrays at load (upsert by id, newest `ts` wins) — token-free, conflict-free (unique filenames),
  same idea as leave-dashboard overrides. `dse-hub/scripts/compact.mjs` +
  `.github/workflows/dse-hub-compact.yml` fold change files back into the canonical arrays on merge.
  **Recurrence** (`src/meetings/recurrence.ts`): weekly/monthly/sprint/sprint-week/tbd → real dates against
  the sprint calendar in `data/pis.json` (whose dates are **placeholders** — 3-week sprints from 2026-07-13;
  replace with the real PI schedule). **Timezone**: per-meeting `schedule.tz` + a global **view-tz** header
  picker (`src/TzContext.tsx`, `localStorage dse-hub:viewTz`) converts all times via `src/tz.ts` (stdlib
  `Intl`, two-pass DST). See `docs/DSE_HUB.md`.
- `cost-dashboard/` — Vite React SPA; `cost-dashboard/netlify.toml` (base=`cost-dashboard`, build,
  publish `dist`). An **AWS cost calculator**: add EC2/S3/RDS/Lambda resources (each with an editable
  **name**), tune inputs, get a live per-card + **grand total** (monthly & annual) + **CSV export**.
  Reads `index.json` → `pricing_<region>.json` at runtime from the **`aws-pricing/data`** branch
  (commit-SHA raw URL to dodge the ~5 min CDN cache → branch path → bundled `public/data/` snapshot).
  Prices are **On-Demand only**, pulled with **no AWS creds** from the public Price List Bulk API by
  `aws-pricing/generate_aws_pricing.py` (stdlib urllib; streams the ~473 MB EC2 region file; offline
  golden test `aws-pricing/test_generate.py` proves the filters reject decoy SKUs) and published by
  `.github/workflows/aws-pricing.yml` (weekly + dispatch; regions accumulate). A "Where these prices
  come from" panel hyperlinks every service to its AWS pricing page + raw price list + version. See
  `docs/AWS_PRICING.md`.
- `algorithm-catalog/` — Vite React SPA; `algorithm-catalog/netlify.toml` (base=`algorithm-catalog`,
  build, publish `dist`). A catalog of the **NASA Disasters product algorithms** (from
  `Disasters-Learning-Portal/disasters-product-algorithms@dev`). **HDS (NASA Horizon Design System)
  over USWDS, light-only.** Three tabs: **📝 Submit** (the request form, default landing),
  **🌀 Events** (event catalog = canonical `events.json` + submitted requests), **🛰 Algorithms**
  (filter by hazard / sensor / product / modality / date / event / AOI, via two entry modes —
  "start from hazard" vs "start from sensor & product" — sharing one filter state). **No
  generator/Action** — data is hand-curated `data/{algorithms,events,hazards}.json` bundled at BUILD
  (plus `data/requests/*.json` overlaid via `import.meta.glob`, dse-hub's merge pattern). Submitting
  opens a **prefilled new-file PR** (`new/main?filename=&value=`), same as leave-dashboard/dse-hub.
  **The standard is enforced automatically**: `src/rules.ts` holds the rules (the
  `YYYYMM_Hazard_Location` regex is lifted verbatim from upstream `dps/_validate.sh:29-36`),
  mirrored 1:1 in `scripts/validate_data.py`, kept honest by `scripts/rules_parity_test.py`, and
  gated in CI by `.github/workflows/algorithm-catalog-validate.yml`. See `docs/ALGORITHM_CATALOG.md`.
- `board-explorer/` — Vite React SPA; `board-explorer/netlify.toml` (base=`board-explorer`, build,
  publish `dist`). Makes a **Projects v2 board searchable**: free-text search plus **GitHub's own
  Projects filter grammar made clickable**, over **Table / By-assignee / Timeline** views. Reads
  `index.json` → `board_<slug>.json` at runtime from the **`board-explorer/data`** branch
  (commit-SHA raw URL → branch path → bundled `public/data/` snapshot), published 6-hourly by
  `.github/workflows/board-explorer.yml` from `board-explorer/scripts/generate_board_export.py`
  (stdlib Python + `gh`; **raw ProjectV2 GraphQL**, NOT `gh project item-list`, which exposes no
  state/merged/label-colours/avatars/timestamps/sub-issue-progress). **Board fields are discovered,
  never hardcoded** — one filter picker per field; GitHub's built-in columns are dropped since their
  values already ride on each item. **ONE query string is the source of truth**: pickers/pills/chips
  read from it and write back into it (a deliberate departure from algorithm-catalog's
  "fully-selected = unfiltered" model — wrong for 33 sprints and 22 people). **Comma = OR, repeated
  qualifier = AND**, so `is:open is:closed` correctly returns nothing. See `docs/BOARD_EXPLORER.md`.
- `app-catalog/` — **the front door to this repo, and the ONLY app here that is not Vite+React.**
  **Astro 5 (static, no adapter) + `@astrojs/mdx` + Pagefind 1.x, Node 24 (`.nvmrc`)**;
  `app-catalog/netlify.toml` (base=`app-catalog`, build, publish `dist`); live at
  `veda-app-catalog.netlify.app`. One entry = one MDX file in
  `src/content/catalog/`; filename = slug = route. **`src/content.config.ts` is the single source of
  truth** for entry fields (Zod) and owns `ENTRY_TYPES` + `TYPE_HUES`. Modelled on
  `NASA-IMPACT/odsi-app-catalog`. **Two fields are REQUIRED and build-gated: `limitations` (min 1)
  and `solves`** — `astro build` fails on a missing/empty one, so "every entry says what it costs you
  and what it removes" is enforced, not reviewed. Search = **Pagefind** (full-text, build-only) +
  **DOM** (type/tag facets, always work); only detail pages are indexed (`data-pagefind-body`), and
  the Limitations panel is `data-pagefind-ignore`. See `docs/APP_CATALOG.md`.

## Theming (light/dark — the fte / leave / pr / board-explorer dashboards; dse-hub + algorithm-catalog are light-only)
Each dashboard themes through **CSS custom properties**: light values live in `:root`, a
`:root[data-theme="dark"]` block overrides them, and an attribute on `<html>` (`data-theme`) switches
modes. **Default is dark**; a manual toggle is remembered in `localStorage` under a per-app key
(`fte-theme` / `leave-theme` / `pr-theme` / `board-theme`). Each `index.html` has a tiny inline **no-FOUC script** that
sets the attribute before first paint + `<meta name="color-scheme" content="dark light">`.
- **Only chrome adapts. Data colors stay fixed** — the person/status palettes (`leave-dashboard/src/colors.ts`)
  and the USWDS PR tag colors (merged/closed/open) carry meaning and must NOT invert.
- **React apps** (fte, leave): `src/theme.ts` holds `getInitialTheme()`/`applyTheme()`; `App` owns the
  state, `Header` renders the sun/moon toggle. Recharts (fte Trends) grid/axis/tooltip colors point at
  the theme vars. `leave` PNG **export matches the theme** (`exportImage.ts` reads the resolved `--bg`,
  not a hardcoded white); `RiskView` heatmap uses `color-mix(... var(--red) ...)` so it tracks the theme.
- **pr-dashboard crosses the iframe boundary.** The shell loads report HTML into an iframe via `srcdoc`,
  so before assigning it, the shell **injects** dark var overrides + a `postMessage` listener into the
  report HTML and sets `data-theme` on its `<html>`. This themes **historical** reports (they predate the
  dark CSS) and lets the toggle re-theme the live iframe via `postMessage` (no reload). The generator
  (`pr-finder/generate_pr_finder.py` `CSS`) and the bundled snapshot (`pr-dashboard/pr_finder_all.html`)
  also carry a `:root[data-theme="dark"]` block + a `prefers-color-scheme: dark` fallback for standalone
  reports — **keep those two in sync** (the snapshot duplicates the generator's CSS).

## Gotchas
- **Issue-triggered run-storms:** the FTE action deployed in another repo with `on: issues:` runs on
  every issue open/edit/close. This repo's `fte-report.yml` keeps that trigger **commented out** on
  purpose so a seed run doesn't cause a storm. (Seeding into such a repo will flood *its* Actions tab.)
- **Merging seed PRs** can be blocked by a base-branch policy → the seeder warns and leaves the PR OPEN.
- **Shared working directory:** if multiple agents/sessions share this checkout, `git commit` lands on
  whatever branch is currently checked out — watch which branch HEAD is on before committing.
- **Cross-repo sub-issue REST fallback** posts to the *parent's* repo with the *child's* `databaseId`.
- **Leave status = cell FILL COLOR, not text.** A CSV export of the leave xlsx is blank; the generator
  parses fills with stdlib `zipfile`+`xml.etree`. `FF999999` gray = weekend (ignore); notes live in
  `xl/threadedComments/*`, not `comments1.xml`. OUT = unavailable+PTO+holiday; limited = 0.5.
- **Root `.gitignore` has `*.json`.** `git add <dir>` **silently skips** needed JSON — each dashboard's
  `package.json`/`tsconfig*.json`, `dse-hub/data/*.json`, `leave-dashboard/public/data/*.json`. You must
  **`git add -f`** them (that's how the sibling dashboards' JSON got committed). A `dse-hub` change touching
  data won't be in the commit unless force-added. **Exception: `algorithm-catalog/` and `board-explorer/`
  have explicit `!` negation lines** in the root `.gitignore`, so a plain `git add <app>/` does pick their
  JSON up — prefer that route for new apps. **`git check-ignore` misleads twice:** plain `git check-ignore`
  lies about already-tracked files, and even `--no-index -v` **exits 0 when ANY rule matches, negations
  included** — so an exit-status test calls a correctly re-included file "IGNORED". Read the rule it prints
  (a leading `!` = included); the unambiguous check is `git add --dry-run <dir>`.
- **Netlify base dir: blank fails GREEN, and "Deploy Preview canceled" is usually correct.** With no
  base directory, Netlify reads no `netlify.toml` (there is none at the repo root, by design), logs
  `Detected 0 framework(s)` / `Starting to deploy site from '/'`, uploads the raw repo, and reports a
  **successful** deploy that 404s — there is no "base directory not found" error. Set base dir in the UI;
  leave build command and publish dir EMPTY (`publish` in the toml is relative to the base dir, the UI
  field to the repo root — filling both gives `<app>/<app>/dist`). Separately, a base dir earns an
  implicit build skip when a commit/PR touched nothing under it, so a **docs-only PR cancels the preview
  on all eight sites** — that is expected, and it happens with or without an `ignore` filter.
- **The Netlify MCP server cannot connect a repo to a site.** Creating the 8th site proved it: the
  whole write surface is `create-new-project` (**`name` + `teamSlug` only**), rename, env vars, access
  controls and forms — **no operation for the repo link, branch, base directory or build settings**,
  and `get-project` can't read them back either. An agent can create a bare project and nothing more;
  the repo connection is a UI step, which is also where it belongs (it must be the **GitHub App** — an
  API/deploy-key connection silently yields no PR Deploy Previews). The MCP is still useful for
  deploys, env vars and reading site state. Team is `kyle-lesinger` ("Data Systems Evolution").
- **`app-catalog/` is Astro, and two things there bite that never bite in the Vite apps.** (1) **MDX
  parses markdown inside your inline SVG**: bare text with a leading-space `_` opens an emphasis span
  and `[^x]` reads as a footnote reference, which **silently truncates the rest of the `<svg>`** — no
  error, the figure just ends early. Wrap such text in a `{"string literal"}`. Catch it by comparing
  `grep -c '<text' <entry>.mdx` against the built `dist/catalog/<slug>/index.html`. (2) **Astro scopes
  component styles**, so a rule in one component that targets elements rendered by another silently
  does not apply — `[data-entry].is-hidden` (in CatalogGrid) lost to EntryCard's own
  `.card{display:flex}`, leaving the filter applying classes while hiding nothing. Cross-component
  rules live in `src/styles/global.css`. **Assert computed `display`/`opacity`, never just the class.**
- **STAC event names need EXACTLY 2 underscores, and the catalog is deliberately stricter than
  upstream here.** Upstream `dps/_validate.sh:29-36` ends its regex with `.+`, so the LOCATION slot
  swallows extra underscores: `202501_Tropical_Cyclone_CA` passes there but silently parses as
  hazard=`Tropical`, location=`Cyclone_CA`, and writes a wrong `HAZARD` GeoTIFF tag.
  `algorithm-catalog/src/rules.ts` ends with `_[^_]+$` instead, so 3+ underscores is a hard **error**
  (rule `underscore-count`) and the form won't submit. This also rejects `202501_Flood_CA_extra`,
  which upstream `tests/integration/test_dps_validate.sh:41-48` explicitly accepts — a knowing
  divergence, and the safe direction: everything we accept, DPS accepts too. Multi-word hazards and
  locations are CamelCase (`TropicalCyclone`, `WinterWx`). The catalog serializes hazard **ids**
  (= those tokens), never display labels.

## Key files
`action.yml`, `pr-finder/action.yml`, `pr-finder/generate_pr_finder.py`,
`.github/scripts/generate_fte_report.py`, `leave/generate_leave_tracker.py`, `leave/action.yml`,
`seed/seed_subissue_tree.py`, `seed/cleanup_subissue_tree.py`,
`.github/workflows/{fte-report,pr-finder,leave-tracker}.yml`,
`docs/{FTE_SEED,PR_FINDER,LEAVE_TRACKER}.md`, `docs/DECISIONS.md`.
Theming: `{fte,leave}-dashboard/src/theme.ts`, each `*/src/styles.css` (`:root[data-theme="dark"]`),
each `index.html` (no-FOUC script), `leave-dashboard/src/exportImage.ts`.
DSE Hub: `dse-hub/src/{App,tabs,tz,TzContext,ChangesContext,changes,changesData}.{tsx,ts}`,
`dse-hub/src/meetings/{MeetingTracker,MeetingCalendar,recurrence,drafts,data}.{tsx,ts}`,
`dse-hub/src/pi/{PiRoadmap,data,pi}.{tsx,ts}`, `dse-hub/data/{meetings,pis}.json`,
`dse-hub/scripts/compact.mjs`, `.github/workflows/dse-hub-compact.yml`, `docs/DSE_HUB.md`.
Algorithm Catalog: `algorithm-catalog/src/{types,rules,data,tabs,App}.{ts,tsx}`,
`algorithm-catalog/src/{filters,catalog,events,request}/`, `algorithm-catalog/data/*.json`,
`algorithm-catalog/scripts/{validate_data.py,rules_parity_test.py,compact.mjs}`,
`.github/workflows/algorithm-catalog-{validate,compact}.yml`, `docs/ALGORITHM_CATALOG.md`.
Board Explorer: `board-explorer/src/{types,data,search,filter,urlState,colors,csv,theme,App}.{ts,tsx}`,
`board-explorer/src/components/{FilterBar,MultiPicker,Chips,ItemDetail,Header}.tsx`,
`board-explorer/src/views/{Table,Assignee,Timeline}View.tsx`,
`board-explorer/scripts/{generate_board_export.py,test_generate.py,test_search.ts,e2e.mjs}`,
`.github/workflows/board-explorer{,-validate}.yml`, `docs/BOARD_EXPLORER.md`.
App Catalog (Astro, not React): `app-catalog/src/content.config.ts` (Zod schema + `ENTRY_TYPES` +
`TYPE_HUES` — the single source of truth), `app-catalog/src/content/catalog/*.mdx` (one file per
entry), `app-catalog/src/components/{CatalogGrid,EntryCard,TypeBadge,TagChip}.astro`,
`app-catalog/src/layouts/{BaseLayout,EntryLayout}.astro`,
`app-catalog/src/pages/{index.astro,catalog/[id].astro}`, `app-catalog/src/styles/global.css`
(cross-component rules + the `.solves-fig` figure/animation primitives),
`app-catalog/scripts/new-entry.mjs`, `.github/workflows/app-catalog-validate.yml`,
`docs/APP_CATALOG.md`.
