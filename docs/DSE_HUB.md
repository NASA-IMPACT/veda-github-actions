# DSE Hub (`dse-hub/`)

A tabbed **hub** app (Vite + React + TS, USWDS palette, light-only) for the DSE group. Its own Netlify
site (Pattern B, base dir = `dse-hub`), live at <https://veda-dse-hub.netlify.app>. Unlike the three
composite actions, it has **no generator/Action** — data is hand-entered JSON, edited entirely through
in-app **prefilled PRs** (no backend, no token, no runtime fetch).

## Shell
- Header tabs + subtabs are a config array in `dse-hub/src/tabs.ts`; `src/App.tsx` switches on state +
  URL hash (`#/<tab>/<sub>`). Adding a tab = one entry + a component. Current tabs: **Meetings → Meeting
  Tracker**, **Sprints & PIs → PI Roadmap**.
- The shell reads the hash **only at mount** (no `hashchange` listener) — tab switches happen via clicks;
  changing the hash programmatically needs a reload.

## Data model (GitHub-only, merged at BUILD)
- Source of truth = compact **`data/meetings.json`** and **`data/pis.json`** (single JSON arrays, empty
  optional fields omitted). Bundled at build via `import.meta.glob` — no runtime fetch, no CDN staleness.
- Every add/edit/**delete** (meeting or PI) is a **`ChangeDoc`** `{ kind:"meeting"|"pi", op:"upsert"|"delete", ts, data, label }`
  staged in the in-app **Changes cart** (`src/ChangesContext.tsx`, `localStorage dse-hub:changes`). A
  **delete** keeps the full record in `data` so loaders/compact can read its `id`; the "🗑 Delete meeting"
  button (shared `MeetingDetail`) stages one after a confirm.
- **Submit PR** builds ONE file `data/changes/<ts>-<n>.json` (array of ChangeDocs) and opens the prefilled
  `github.com/NASA-IMPACT/veda-github-actions/new/main?filename=&value=` page — the same token-free flow as
  leave-dashboard's overrides. The user just clicks *commit* on GitHub.
- Loaders (`src/meetings/data.ts`, `src/pi/data.ts`) import the canonical arrays + glob `data/changes/*.json`
  (`src/changesData.ts`) and **merge** by `data.id`, newest `ts` wins: `upsert` sets the record, `delete`
  removes it. So a merged PR shows up on the next Netlify build.
- `scripts/compact.mjs` + `.github/workflows/dse-hub-compact.yml` **fold** change files back into the
  canonical arrays on merge to `main` (and delete the folded files) — keeps `data/changes/` small at scale.
- **Why single canonical files, not one-per-record:** scales to hundreds without hundreds of files, and gzip
  already erases the key-repetition (the whole meetings set is ~2 KB gzipped). Edits stay conflict-free
  because they land in **uniquely-named** change files, never the canonical file. (CSV was rejected: the
  recurrence rule is structured and doesn't flatten cleanly.)

## Recurrence → real dates (`src/meetings/recurrence.ts`)
Rule union on `schedule.rule.freq`:
- `weekly` — `byday[]`, `interval` (2 = every other, needs an `anchor` date), 
- `monthly` — nth weekday of the month (`setpos`, -1 = last),
- `sprint` — nth weekday **within a sprint** (`setpos` list, e.g. `[2,3]`),
- `sprint-week` — weekday of the Nth calendar week of a sprint,
- `tbd` — unscheduled (shown in a tray, never placed on a date).

Sprint-relative rules resolve against the sprint windows in `data/pis.json`. `schedule.text` always keeps
the original human phrasing so nothing is lost even when the structured rule is approximate.
**The PI 26.4 sprint dates are placeholders** (3-week sprints from 2026-07-13) — replace with the real
schedule (via the app: **Sprints & PIs → Edit → Add to changes → Submit PR**).

## Timezones (`src/tz.ts`, `src/TzContext.tsx`)
- Each meeting stores a **source** timezone (`schedule.tz`, default `America/Chicago`).
- A global **view timezone** header picker (persisted `localStorage dse-hub:viewTz`, default = the browser
  tz) converts **every** displayed time from its source tz using stdlib `Intl.DateTimeFormat` with a
  **two-pass DST-safe** offset (`convertHHMM`/`tzAbbrev`/`formatRangeInTz`).
- The add/edit form uses **pill time pickers** (`src/meetings/TimePicker.tsx`) + a per-meeting tz select.

## Gotchas
- **Root `.gitignore` has `*.json`** → `git add dse-hub` silently skips `package.json`, the tsconfigs, and
  `data/*.json`. Force them: `git add -f dse-hub/package.json dse-hub/package-lock.json
  dse-hub/tsconfig*.json dse-hub/data/*.json`. (leave-dashboard has the same footgun.)
- Calendar **sprint bands** use an inset `box-shadow` (not a `border`) so cells keep equal width; day cells
  have a fixed `min-height` (128px) so every week row is the same height — don't switch the band back to a
  border or the columns go ragged.
- Netlify: set **base directory = `dse-hub`**; the first deploy fails if run before `dse-hub/` exists on the
  built branch ("base directory not found") — deploy after the merge lands on `main`.
- **Light-only ⇒ pin native controls.** `<meta name="color-scheme" content="light">` (index.html) +
  `:root { color-scheme: light }` (styles.css) stop a dark-mode OS from rendering `<select>`/date-picker
  popups dark. The native **`<datalist>` popup ignores `color-scheme` in Chrome** (renders dark + misaligned),
  so Team/Category use a custom light **`Combobox`** (`src/meetings/Combobox.tsx`) instead — free text still
  allowed. If you add another autocomplete, use `Combobox`, not `<datalist>`.
- **Deleting a meeting is a press-and-HOLD (2s) gesture** (`src/meetings/HoldToDelete.tsx`), not a click —
  a fill bar sweeps in `--hold-ms`; releasing early aborts. It only *stages* a `delete` ChangeDoc in the
  Changes cart (reviewable, PR-gated), never an instant removal.

## Run / test
```bash
cd dse-hub
npm install
npm run dev        # local dev
npm run typecheck  # tsc --noEmit
npm run build      # vite build -> dist/
node scripts/compact.mjs   # fold data/changes/*.json into the canonical arrays
```
