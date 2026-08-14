# Algorithm Catalog (`algorithm-catalog/`)

A Vite + React + TS app (USWDS palette, **light-only**) cataloguing the NASA Disasters product
algorithms and taking new activation requests. Its own Netlify site (Pattern B, base dir =
`algorithm-catalog`). Like dse-hub it has **no generator/Action** — data is committed JSON edited
entirely through in-app **prefilled PRs** (no backend, no token, no runtime fetch).

## Shell
Three flat header tabs in `src/tabs.ts`, rendered by `src/App.tsx` and synced to the URL hash:
**📝 Submit** (the landing tab), **🌀 Events**, **🛰 Algorithms**. A layer chip on an event jumps to
the Algorithms tab through a parked `NavIntent` on a `window` event — the target tab is unmounted
when the click happens, so a callback cannot reach it. The header also holds the 🧺 **Requests**
cart.

## Two entry modes
- **Browse** — Events and Algorithms answer "what have we run, and what could we run?" Filters are
  hazard / date / sensor / product; AOI deliberately does **not** narrow the catalog, because the
  spatial selectors are mutually incompatible across algorithms (`SpatialSelector` in `types.ts`).
- **Submit** — the form in `src/request/RequestForm.tsx` takes an activation event and turns it into
  a reviewable request. **The user never sees DPS**: no queue, no `run_command`, no `ram_min`, no
  credentials. Picking hazards auto-selects the suited products; an explicit **＋ Add products**
  picker covers everything the hand-built mapping misses (chips are badged `auto` vs `manual`, the
  `via` field). A collapsed **"What this will run"** panel shows the derived DPS inputs read-only, so
  the request is traceable without ever being editable.

## Data model (GitHub-only, merged at BUILD)
- Canonical: **`data/algorithms.json`** (the catalog), **`data/events.json`** (past activations),
  **`data/hazards.json`** (the controlled vocabulary this app *defines* — upstream has none, which
  is why `Fire`/`Wildfire` and `Quake`/`Earthquake` both exist in the wild), and
  **`data/requests.json`** (compacted submissions). All bundled at build via plain imports.
- A submission is an **`AlgorithmRequest`** staged in the cart (`src/RequestsContext.tsx`,
  `localStorage algorithm-catalog:requests`, upsert by `id`).
- **Hazards and products serialize by `id`, never by label** — `Fire`, `TropicalCyclone`, `WinterWx`,
  `swir`, `mndwi`. A payload carrying a display label is a hard validation error.
- `src/data.ts` reads the canonical arrays **and** `import.meta.glob`s `data/requests/*.json`. Both
  are needed: globbing only the directory would make every compacted request vanish the moment the
  compact workflow runs.

## The standards story (three layers, one source of truth)
Every rule is lifted from the real enforcement point in
`Disasters-Learning-Portal/disasters-product-algorithms@dev`, so the app rejects exactly what DPS
rejects at run time — while you type, instead of 40 minutes into a job.
1. **`src/rules.ts`** — THE STANDARD (`STAC_EVENT_RE`, `ISO_DATE_RE`, `checkBbox`, …). The form calls
   `validateRequest()` and renders each `Violation` **inline under its own field**, red for `error`
   and amber for `warning`, naming the rule and giving a worked example. `isSubmittable()` gates the
   submit buttons; **warnings never block**. Violations stay hidden until a field is touched (Submit
   is the landing tab — an untouched form must not open on a wall of red); **"Show all problems"**
   reveals everything, which is the only way a *disabled* button can explain itself.
2. **`scripts/validate_data.py`** — the same rules in stdlib Python, over every committed file, plus
   reference integrity (hazard/product ids resolve, every `thumb` exists on disk).
3. **`.github/workflows/algorithm-catalog-validate.yml`** — runs both scripts on every PR touching
   `algorithm-catalog/**`, plus `scripts/rules_parity_test.py`, which pushes one fixture table
   through **both** rule implementations so the two copies can never silently drift. A second job
   runs `npm ci && npm run typecheck && npm run build` on Node 24.

## Prefilled-PR flow
`src/requests.ts` builds ONE file `algorithm-catalog/data/requests/<ts-stamp>-<slug>.json` (stamp =
newest `ts`, non-alphanumerics → `-`) and opens
`github.com/NASA-IMPACT/veda-github-actions/new/main?filename=&value=`. The user clicks *commit*;
that is the whole flow — no OAuth, no token. **`URL_LIMIT` is 190000**, not dse-hub's 7500: one
request over a broad hazard set easily carries 40+ products. Past the limit the PR button disables
and the cart tells you to use **Copy JSON**. Unique filenames make concurrent submissions
conflict-free. `scripts/compact.mjs` + `.github/workflows/algorithm-catalog-compact.yml` fold merged
request files into `data/requests.json` and delete them, with `[skip ci]` so the fold does not
re-trigger validation.

## Theming
**Light-only USWDS**, like dse-hub — there is no dark toggle and no `data-theme` attribute. Colors
come from custom properties in `src/styles.css`; `src/request.css` holds the request form's own
`.req-`-prefixed classes and reuses the shared house classes (`.btn .panel .field .hint .overlay
.modal .foot .jsonlabel .urlbox .opt .rm .seg .control .popover`) rather than redefining them.
Hazard colors and the `auto`/`manual` product badges carry meaning and are fixed, not themed.

## Gotchas
- **Root `.gitignore` has `*.json`.** Unlike dse-hub (which needs `git add -f`), this app's paths are
  explicitly re-included — `!algorithm-catalog/data/*.json`, `!algorithm-catalog/data/requests/*.json`,
  `package.json`, `package-lock.json`, `tsconfig*.json` — so a plain `git add algorithm-catalog/`
  picks the data up. Add a new JSON path under `algorithm-catalog/` and you must add its negation too.
- **Thumbnails are committed binaries** in `public/thumbs/` (600×400 PNG, ≤150 KB, sources and NASA
  credit lines in `public/thumbs/CREDITS.md`). `validate_data.py` fails if an algorithm's `thumb` has
  no file on disk, so a new algorithm needs its PNG in the same PR.
- Netlify: set **base directory = `algorithm-catalog`**; the first deploy fails if run before
  `algorithm-catalog/` exists on the built branch ("base directory not found") — **deploy after the
  merge lands on `main`**.

## Run / test
```bash
cd algorithm-catalog
npm install
npm run dev            # local dev
npm run typecheck      # tsc --noEmit
npm run build          # vite build -> dist/
node scripts/compact.mjs                    # fold data/requests/*.json into data/requests.json
python3 scripts/validate_data.py            # the standards gate, offline, stdlib only
python3 scripts/rules_parity_test.py        # rules.ts vs validate_data.py must agree
```
