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

## Event pages (website text + algorithm layers, one record)
An event also carries the text of its public page on science.data.nasa.gov — `page` on
`ActivationEvent` / `AlgorithmRequest` (`src/types.ts`). That page used to be written from the
hand-kept `hazard_event_info.xlsx`; the Submit form's **2 · Page content** section replaces it.

| Sheet 1 column | Portal page | Field |
|---|---|---|
| Title | masthead title | `name` |
| STAC event name | — | `stacName` |
| Sub-title | masthead description | `page.subtitle` (→ portal `description`) |
| US-gov link | "What the U.S. government is doing" | `page.govLink` (https only) |
| Intro paragraph | Overview | `page.intro` (blank line = paragraph) |
| Start date | Start Date | `start` |
| End date | — (the portal records none) | `end` — **optional**; blank = ongoing (shown "– ongoing", never filtered out) |
| Need/Theme | Need | `page.needs` — the portal's theme **ids** `prepare/respond/recover/resilience` |
| Hazards | Hazard / categories | `hazards` → `hazards.json` `portal` (its `CONTENT_CATEGORIES`) |
| Locations | Region | `locations` (+ `places`), or `page.region` override |
| Layers | Event Data Gallery | `layers` → `algorithms.json` product `portalData` (its `DATA__*` cards) |

- **Merge rule:** page text is **newest-wins** — `loadEventCatalog` shows the newest submission's
  `page` over the published one (Events → **Edit page** submits a request for an existing event).
  Layers stay published-owns-row.
- **Live preview — as it will look ON the portal:** `src/events/PortalPage.tsx` replicates the
  portal page (its header, hero masthead, sidebar tags, Overview, Event Data Gallery; fonts, colors
  and proportions measured off the live California page) at its 1280px desktop width, and
  `<PortalFrame>` scales it to fit. It is docked beside the Submit form (👁 **Live preview**, sticky,
  remembered per browser in `localStorage algorithm-catalog:livePreview`; default open ≥1200px) and
  updates on every keystroke; Events → event → **Page preview** shows the same. Text goes through
  `src/portal.ts` `typographic()` — the same transform the generated file uses — so the preview
  shows exactly what the portal will (curly quotes included).
- **The gallery shows the portal's REAL cards** (title, description, tags, thumbnail) for each
  product's `portalData`, snapshotted by `scripts/sync_portal_cards.py <portal checkout>` into
  `data/portal-cards.json` + `public/portal/` (thumbnails downsized with macOS `sips`). Re-run it
  when the portal's cards change or a `portalData` mapping is added. Layers with no portal card are
  listed under the preview, since the real page will not show them.
- **Export:** **Copy Markdown**, **Page JSON** (`src/pageExport.ts`).
- **One optional image after the intro** (`page.image`), as on the Venezuela / Typhoon Sinlaku
  pages: a Google Drive **file** link + alt text (required) + optional caption (end it with the
  credit). It becomes the portal's `image` block between the Overview text and the Event Data
  Gallery. There is **no masthead option** — every generated page uses the portal's default event
  image (`/img/event/template-hero.webp`) for the hero and card thumbnail. `rules.ts` `DRIVE_FILE_RE`
  accepts `/file/d/<id>`, `open?id=` and `uc?…id=`; a `/drive/folders/` link gets its own error.
  The preview loads it through Drive's thumbnail endpoint (caption styled as measured on the live
  portal: 12px, base-dark, narrow measure) and says plainly when it can't — the file isn't shared
  "Anyone with the link". `portal_pr.mjs` downloads it to `public/img/event/<id>__overview.<ext>`,
  **sniffs the bytes** (an unshared file comes back as an HTML page, so the content type can't be
  trusted), reads the real width/height the `image` block requires (PNG/JPEG/WebP/GIF, stdlib) and
  then brings it to the **portal's image standard** (below). A failed download never breaks the PR:
  it is listed in the PR body and as a comment in the page file. `DRIVE_DOWNLOAD_URL` overrides the
  endpoint for testing.
- **The portal's image standard** (disasters-portal PRs #556 and #654, applied by
  `portal_pr.mjs` `toPortalWebp`): every image is a **real WebP** (`cwebp -q 80 -m 6 -metadata
  none` — a PNG/JPEG renamed `.webp` was #654's main offender), **≤ 1920px wide**, **< 500 KB**. A
  WebP that already meets it is kept byte for byte (re-encoding lossy WebP only loses quality); one
  still over 500 KB at q80 is stepped down in width (×0.85, floor 640px) rather than dropped below
  q80, as #654 did for `landsat-natural-color`. Body images are **not** capped at 1280px — #654
  dropped that rule because it blurred high-DPI screenshots. GIFs are refused (export PNG/JPEG).
  The PR body lists each conversion (e.g. `11,594 KB PNG → 292 KB WebP (q80, 3943 → 1920px)`). The
  workflow installs `cwebp` (`apt-get install webp`); locally `brew install webp`.
  `sync_portal_cards.py` encodes the preview's card thumbnails the same way (480px WebP).
- **The page address is never asked for.** A new page's id is derived from the event name
  (`derivePortalId`: "Hurricane Isaias October 2026" → `hurricane-isaias-oct-2026`, "U.S." → "us"),
  so once a page is started the name must end "<Month> <YYYY>" (`PORTAL_NAME_RE`, error
  `name.portal-name`; a name/start-date month mismatch warns). Existing portal pages keep their
  recorded `portalId` (set by the import) and are exempt. The form has no address field at all; the
  address appears only in the live preview's header.
- **Import:** `scripts/import_xlsx.py` is **one-time** and reads **sheet 1 only**; the Google Sheet
  is being retired. It reports, never invents: unmapped hazards/locations/layers are listed, a Layers
  cell that only points at another sheet imports no layers. Per-layer pipeline status (STAC / GIBS /
  EGIS / staging) is deferred.

## Every Disasters Portal data product, and its live STAC name
- **All 59 Data Gallery products can be requested.** The 40 with no algorithm here are entries with
  `status: "external"` ("no algorithm yet"), grouped by source (OPERA, UAVSAR, AVIRIS-3, Planet,
  Vantor, SkySat, …). Each links to its real portal card via `portalData`. They are picked by hand
  only: `autoProducts` never selects them from a hazard, and "What this will run" says no DPS job is
  created. `validate_data.py` requires `inputs: []` for them. Modality `"model"` covers GAIA and GPM.
- **"＋ Add products" is a two-column picker** (`src/request/ProductPicker.tsx`, `.req-prodpick`):
  sensors on the left (catalog order, selected/total counts, status badge from a generic
  `STATUS_LABEL` map), the selected sensor's products on the right. Search spans both columns, with
  an "All matches" entry. Keyboard: ↓ into sensors, ↑/↓/Home/End, → or Enter into products, Esc.
  Rows are **toggles** (an added row's ✓ turns into a red − on hover; clicking removes it via the same
  `removeProduct` as the chip ×). The selected list sits ABOVE the picker, so each add/remove made from
  the open picker records its position first and scrolls by the difference after — the picker stays
  under the cursor (e2e asserts 0px drift; without it, 26–66px per add).
- **Nothing picked disappears from the preview.** A product with no Data Gallery card renders in the
  live preview as a dashed draft card stating the published page won't show it — the real page can only
  render existing `DATA__*` cards.
- **`stacAsset` / `stacCollections` are GENERATED from the live Disasters STAC** by
  `scripts/sync_stac_assets.py`, never hand-edited, and the app offers no way to edit them. The
  asset name is the item asset whose roles include `data`; `cog_default` and the
  `rendered_preview_*` / dashboard renders are NOT asset names. Collections are matched to products
  by rule (sensor = algorithm id or named in the card title; asset key = the product token, its
  folder, or named in its card title; or an exact name unique across all of STAC). Claims are
  ranked, a product with its own-sensor collections ignores title-only sensors, and a tie is
  assigned to nobody and reported. The picker shows `stacAsset` as the product token; a product no
  live collection carries shows its own token, dashed. `validate_data.py` checks the shape only (CI
  has no network); `sync_stac_assets.py --check` exits 1 when the file is stale against live STAC.
  The product `id` stays the algorithm's CLI token — the DPS run scripts are demo scaffolding and
  will change, so they are not a naming authority.

## Locations at any level of interest
`src/request/PlacePicker.tsx` over a bundled gazetteer (`src/places.ts`): pick **Alabama**, or
**Narrow** it to *Montgomery, Alabama* (or a county); **Broaden** goes back up. Picking places fills
the bbox (union, padded past the 0.05° Black Marble floor) until you type your own; a union wider
than 180° (antimeridian — Alaska, the whole US) leaves the bbox alone with a warning.
- Data: `data/places.json` (countries + US states/territories + counties, eager) and
  `data/places-cities.json` (~32k US places incl. CDPs, a **lazy** chunk loaded on first search),
  built once by `scripts/build_places.py` from Natural Earth 50m + Census `cb_2023_*_500k`
  (stdlib: a `.shp` record header already holds its bbox). Rows are `[id, name, w, s, e, n]`.
- Ids are hierarchical — `US` › `US-AL` › `US-AL-101` (county) / `US-AL-c51000` (city) — so
  "a place listed with its own ancestor" is a prefix test (`rules.ts` `checkPlaces`, warning).
  `validate_data.py` additionally checks every id exists in the gazetteer.
- `locations` keeps the display strings; its first `places.length` entries are the places' labels
  **in order**, then free text. That ordering is what lets `requestToDraft` rebuild the chips.

## Disasters Portal PR (`.github/workflows/algorithm-catalog-portal-pr.yml`)
A request PR whose file carries a `page` gets a matching PR on
`Disasters-Learning-Portal/disasters-portal` (base `develop`): `app/site-config/event/event__<id>.ts`
plus its import + `EVENTS` entry (newest `startDate` first) in `app/site-config/event/index.ts`.
- **One generator, two callers:** `src/portal.ts` is previewed live in the form (Review → *Portal
  file*) and run by `scripts/portal_pr.mjs` under plain Node (type-only imports, so Node's native
  type stripping runs it — no build step).
- **It can't arrive red:** `portal_pr.mjs` runs `biome check --write` on the touched files, then the
  portal's full `pnpm lint:ci` + `pnpm typecheck` in the checkout; any failure stops before the push.
  The portal's PR checks also skip drafts, so the PR is opened ready-for-review.
- **Portal standards it follows:** theme ids, `CONTENT_CATEGORIES`, `DateString` (20xx only — a
  rule in `checkPage`), Biome style (double quotes → straight `"` in prose becomes curly `“ ”`, or
  Biome flips the literal to single quotes and `lint:ci` fails), and the portal's placeholder
  `/img/event/template-hero.webp` for hero + thumbnail (swap before merge).
- **Never clobbers:** a page file without the generator's marker line (all 7 pre-existing portal
  events) is hand-written and is skipped, not overwritten. Only generated files are regenerated.
- One portal branch per request PR, `veda-catalog/pr-<N>`, force-updated on every push; a comment on
  the request PR links it. Token: `DISASTERS_PORTAL_TOKEN`, else `PROJECT_TOKEN_FOR_BOARD_READS`.
  Fork PRs are skipped (no secrets, and they must not push into another org).
- Dry run against any portal checkout:
  `node algorithm-catalog/scripts/portal_pr.mjs --portal <checkout> --branch test --dry-run <request.json>`

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
- **Netlify: base directory = `algorithm-catalog` is the ONLY field to set in the UI** — leave build
  command and publish directory EMPTY so `algorithm-catalog/netlify.toml` is the single source
  (`command = "npm run build"`, `publish = "dist"`, both resolved relative to the base dir).
  Two ways this goes wrong, both ending in a 404 on `/`:
  - **Base directory left blank** — this fails *silently*, not with "base directory not found".
    Netlify looks for `netlify.toml` at the REPO ROOT, where there deliberately isn't one (a root
    config's `base` would hijack all six sites), so it logs `Detected 0 framework(s)` /
    `No build steps found` / `Starting to deploy site from '/'`, uploads ~192 raw repo files, and
    reports a green deploy that serves no `index.html`. **Read the log for `from '/'`** — a correct
    deploy says `from 'algorithm-catalog/dist'` and uploads ~13 files.
  - **Publish directory also filled in** — `publish` in `netlify.toml` is relative to the base dir
    (`dist`), but the UI field is relative to the repo root. Setting both yields
    `algorithm-catalog/algorithm-catalog/dist`.
  Deploy after the merge lands on `main`, so the base dir exists on the built branch. Netlify
  auto-installs **Node 24** here, matching CI — no `NODE_VERSION` var needed.
- **"Deploy Preview canceled" on a PR is usually correct, not broken.** Because the site has a base
  directory, Netlify applies an implicit skip when the commit/PR touched nothing under
  `algorithm-catalog/` — so a README- or docs-only PR cancels the preview on all six sites. This
  happens whether or not `netlify.toml` sets an `ignore` filter, so omitting `ignore` does **not**
  mean "build on every push". **A deploy preview for this app requires the PR to change a file
  inside `algorithm-catalog/`.** Before debugging Netlify settings, check whether the PR actually
  touched the base dir (`git diff --name-only main... -- algorithm-catalog/`).

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
python3 -I scripts/import_xlsx.py <xlsx> --dry-run   # one-time sheet-1 import (report only)
python3 -I scripts/build_places.py --countries … --states … --counties … --places …  # rebuild gazetteer
python3 -I scripts/sync_stac_assets.py [--check]    # stacAsset/stacCollections from the LIVE STAC
python3 -I scripts/sync_portal_cards.py <portal checkout>   # preview's card snapshot (needs cwebp)
node scripts/portal_pr.mjs --portal <portal checkout> --branch t --dry-run <request.json>
# e2e: playwright is NOT a devDependency, and Node resolves import("playwright") from the SCRIPT's
# folder (not the cwd) — so copy scripts/e2e.mjs into a folder that has playwright installed, run it there:
#   cp scripts/e2e.mjs /tmp/e2e/ && (cd /tmp/e2e && npm i playwright && node e2e.mjs http://localhost:5173)
```
