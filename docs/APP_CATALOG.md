# App Catalog

A searchable front door to everything else in this repo. One entry per dashboard and per reference
doc, each linking out to the real thing — the catalog **references, it never hosts or copies**.

Live: <https://veda-app-catalog.netlify.app> · Folder: [`app-catalog/`](../app-catalog/)

Modelled on [`NASA-IMPACT/odsi-app-catalog`](https://github.com/NASA-IMPACT/odsi-app-catalog), which
solves the same problem org-wide.

## Stack — and why it differs from every other app here

**Astro 5 (static, no adapter) + `@astrojs/mdx` + Pagefind 1.x. Node 24 (`.nvmrc`). No React.**

The other six SPAs are Vite + React 18. This one deliberately is not. It is a *content* catalog, not a
data dashboard: entries are prose with typed frontmatter, and the requirement is full-text search over
that prose with zero backend. Astro validates every entry at build via a Zod schema, Pagefind indexes
the built HTML, and the page ships almost no JavaScript. Doing this in the Vite+React house style
would mean hand-rolling routing, MDX rendering and a search index, and shipping a bundle to do it.

## How it works

- **One entry = one MDX file** in `app-catalog/src/content/catalog/`. Filename = slug = route.
- **`src/content.config.ts` is the single source of truth** for entry fields (Zod). It also owns
  `ENTRY_TYPES` and `TYPE_HUES`.
- `src/pages/index.astro` → `src/components/CatalogGrid.astro` — the card grid plus search and facets.
- `src/pages/catalog/[id].astro` → `src/layouts/EntryLayout.astro` — the detail page (Limitations
  panel, optional Developer's suggestion, then the MDX body via `render(entry)`).
- `npm run build` runs `astro build`, then the `postbuild` hook `pagefind --site dist` writes the
  search index into `dist/pagefind/`.

### Search = Pagefind (full-text) + DOM (facets)

Type and tag filtering is pure DOM off the card `data-*` attributes, so it always works — including in
`astro dev`. Free-text uses the Pagefind JS API, with a substring fallback over title/description/tags
when `/pagefind/` is absent.

**Only detail pages are indexed** (`data-pagefind-body`), so a search result maps to an entry rather
than to the grid page. The Limitations panel carries `data-pagefind-ignore="all"` — otherwise every
entry would match on the boilerplate sentence in it.

### Every entry says what it removes

`solves` is a required one-sentence answer to "what problem does this take away?", shown on the grid
card and as a callout on the detail page. Apps additionally carry a `## What it solves` section in the
MDX body with a before/after inline-SVG figure; the seven `docs/` entries are text-only by design, so
the figures mark the apps rather than the reading material.

Figures share primitives from `global.css` (`.solves-fig`, `.fig-flow`, `.fig-grow`, `.fig-pulse`, and
`.fig-d1`–`.fig-d5` for stagger); the SVG itself is bespoke per entry. **All motion sits behind
`prefers-reduced-motion: no-preference`** — the static diagram has to read on its own — and each SVG
carries a real `<title>`/`<desc>`.

### Type is the primary facet

`TYPE_HUES` in `src/content.config.ts` assigns one stable hue per type, and **both** the card badge
(`TypeBadge.astro`) and the Type filter chip (`CatalogGrid.astro`) read it. A filter chip is therefore
always the same colour as the badge it selects. Type chips are larger, carry a count, and sit in their
own raised panel; the tag facet is a collapsed `<details>` so the secondary facet cannot compete with
the primary one. Change a hue in one place and both follow.

## Adding an entry

```bash
cd app-catalog
npm run new-entry     # interactive scaffold — refuses to finish without >=1 limitation
npm run build         # validate
```

Then open a PR. `ENTRY_TYPES` is duplicated in `scripts/new-entry.mjs` — keep it in sync with
`src/content.config.ts`.

## Non-obvious constraints & gotchas

- **`limitations` (min 1) and `solves` are REQUIRED** — an entry with an empty or missing one **fails
  `astro build` and CI**. These are product rules ("every entry must acknowledge ≥1 limitation or
  risk", "every entry must say what it removes"), not style preferences. Don't relax them. Verified:
  a missing `limitations`, an empty `[]`, a missing `solves`, and an unknown `type` each exit
  non-zero.

- **MDX parses markdown inside your inline SVG, and truncates it silently.** In a figure, bare text
  with a leading-space `_` opens an emphasis span and `[^x]` reads as a footnote reference — either
  one **swallows the remainder of the `<svg>`**. There is no error; the figure just ends early and
  looks plausible. (This bit `algorithm-catalog.mdx`, whose `pattern ends _[^_]+$` silently ate the
  three enforcement-layer rows.) Wrap such text in a `{"string literal"}`. Intra-word underscores
  like `202501_Tropical_Cyclone_CA` are safe — CommonMark doesn't open emphasis mid-word. Catch it by
  comparing `grep -c '<text' <entry>.mdx` against the built `dist/catalog/<slug>/index.html`; equal
  counts mean nothing was eaten.

- **Astro scopes component styles, so cross-component rules must live in `global.css`.** A rule
  written in one component that targets elements rendered by another silently does not apply.
  `[data-entry].is-hidden` in `CatalogGrid.astro` tied on specificity with `EntryCard.astro`'s own
  `.card { display: flex }` and lost on source order — the filter applied its class, the count
  updated, and every card stayed on screen. Both that rule and the hover-spotlight
  (`#grid:has([data-entry]:hover)`) now live in `global.css`. **When testing filtering, assert
  computed `display`/`opacity`, never just that the class was added** — that is exactly what let the
  bug through.
- **Pagefind search only works after a build.** `/pagefind/` doesn't exist in `astro dev`. In dev the
  facets still work and free-text degrades to a substring match on card text — which is easy not to
  notice, so CI asserts `dist/pagefind` exists. Use `npm run build && npm run preview` to exercise
  real search.

- **Give the first live search ~3 seconds before calling it broken.** The first query lazily fetches
  `pagefind/pagefind.js` *and* `pagefind-worker.js`; against the deployed site a 1-second wait returns
  "all 14 still showing" and looks exactly like a broken filter. The same query passes on a retry. When
  scripting this check, wait ~3s and confirm both resources appear in
  `performance.getEntriesByType('resource')`.

- **To prove search is really hitting Pagefind, query a word that appears only in an MDX *body*** —
  never in a title, description or tag. Those three are all the substring fallback can see
  (`data-text`), so a body-only term (e.g. `threadedComments` → `docs-leave-tracker`) returns 1 result
  through Pagefind and 0 through the fallback. A term present in a title passes either way and proves
  nothing.
- **Pagefind is imported via a runtime-built string + `/* @vite-ignore */`** in `CatalogGrid.astro`,
  so Vite doesn't try to resolve `/pagefind/pagefind.js` at build time. Keep that pattern.
- **No SPA redirect in `netlify.toml`** — unlike the six Vite siblings. Astro emits a real file per
  route; a `/*` → `/index.html` catch-all would shadow the 404 page and the `/pagefind/` assets.
- **No `ignore` filter in `netlify.toml`** either. A base directory already earns Netlify's implicit
  build skip, and the folder-scoped `git diff` filter has silently dropped merged code elsewhere in
  this repo.
- **Root `.gitignore` negations are mandatory.** The bare `*.json` at root would otherwise silently
  drop `app-catalog/package.json`, `package-lock.json` and `tsconfig.json` from a commit. The
  negation block exists; verify with `git check-ignore --no-index -q <path>` (exit 1 = will commit).
- **`app-catalog/.astro/`** holds generated types — gitignored, never commit it.
- There is **no `video` field**, unlike odsi-app-catalog. Nothing here uses a demo clip yet, so the
  field and its `VideoEmbed` component would be unexercised dead code. Port both from
  odsi-app-catalog when the first real demo lands.

## Deploy

Pattern B, like every other app here: **create a new Netlify site from this repo with base directory
`app-catalog`**, leaving the build command and publish directory **empty** in the UI (`publish` in the
toml is relative to the base dir, the UI field to the repo root — filling both gives
`app-catalog/app-catalog/dist`). Netlify then reads `app-catalog/netlify.toml`.

There is deliberately **no root `netlify.toml`** — a root config's `base` would apply to every site
connected to this repo. See [`DECISIONS.md`](DECISIONS.md).

**The Netlify MCP server cannot do this step — don't burn time trying.** Its write surface is
`create-new-project` (which accepts only `name` and `teamSlug`), rename, env vars, access controls and
forms; there is **no operation for the repository connection, branch, base directory or build
settings**, and `get-project` doesn't read them back either. So an agent can create a bare project and
nothing more — the repo link has to be made in the UI. That is also the *correct* place for it: per
[`DECISIONS.md`](DECISIONS.md) and odsi-app-catalog's own ADR, the connection must be the **Netlify
GitHub App**, because an API/deploy-key connection cannot produce PR Deploy Previews and fails
silently — previews simply never appear.

This site: `veda-app-catalog`, id `419cc3bb-5bfc-4677-b592-2594ae7b30dd`, team `kyle-lesinger`
("Data Systems Evolution").

`astro.config.mjs` derives `site` from `DEPLOY_PRIME_URL || URL`, so canonical URLs are correct in
production, branch deploys and PR previews alike. Don't hardcode a URL.

CI: [`.github/workflows/app-catalog-validate.yml`](../.github/workflows/app-catalog-validate.yml) runs
`npm ci && npm run build` on any PR touching `app-catalog/**` and asserts the Pagefind index was
produced. `astro build` **is** the schema gate.
