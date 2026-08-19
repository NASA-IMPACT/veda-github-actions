# Board Explorer (`board-explorer/`)

A Vite + React + TS app that makes a GitHub Projects v2 board **searchable, filterable and
scannable**. Its own Netlify site (Pattern B, base dir = `board-explorer`). Light/dark, default dark.

**Live:** <https://veda-projectboard-dashboard.netlify.app>
Board it mirrors: <https://github.com/orgs/Disasters-Learning-Portal/projects/5> (~410 items).

## Why it exists
GitHub's Projects UI hides its filter vocabulary behind one opaque box, has no free-text search
over item bodies, shows per-person workload only if somebody hand-builds a view, and produces no
shareable URL. This app keeps GitHub's *vocabulary* (so muscle memory transfers) and adds
discoverability, three purpose-built views, and links you can paste into Slack.

---

## Data pipeline

```
board  --(Action, PROJECT_TOKEN_FOR_BOARD_READS)-->  board-explorer/data branch  --(runtime fetch)-->  SPA
                                                                                       └─ falls back to public/data/
```

Projects v2 **cannot be read without a token** — and not with the default `GITHUB_TOKEN` either,
which lacks `read:project`. A static site can't hold a token, so the read happens in CI and the app
only ever fetches public JSON. See `docs/DECISIONS.md` for why this beat a browser-side PAT.

### `scripts/generate_board_export.py`
Stdlib-only Python 3.12 + `gh` as a subprocess (repo convention). Two GraphQL queries: the field
schema, then the items, paginated 50 at a time.

**Not `gh project item-list`.** The two older board readers in this repo use it, but its flattened
output carries only `content.{type,title,url,number,body}` — no state, no `merged`, no label
colours, no avatars, no milestone, no timestamps, no sub-issue progress. This app needs all of
those, so it talks GraphQL directly. It still reuses `pr-finder`'s `gh()`/`gh_graphql()`/`sanitize()`
wrappers and `aws-pricing`'s `write_json`/`--reindex-only`.

```bash
# offline, against the canned fixture (no token, no network)
python3 board-explorer/scripts/generate_board_export.py \
  --graphql-json board-explorer/scripts/fixtures/board_graphql.json --out-dir /tmp/out

# live (needs a token with read:project — see Auth below)
python3 board-explorer/scripts/generate_board_export.py \
  --project-url https://github.com/orgs/Disasters-Learning-Portal/projects/5 \
  --out-dir board-explorer/public/data --now "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# rebuild index.json from the board_*.json already on disk (no network)
python3 board-explorer/scripts/generate_board_export.py --reindex-only reports
```

**Auth.** A classic PAT with `repo + read:org + project`. Locally the quickest route is
`gh auth refresh -h github.com -s read:project`; without it every field comes back
`INSUFFICIENT_SCOPES`. In CI it is `secrets.PROJECT_TOKEN_FOR_BOARD_READS`.

### Output shape
`board_<slug>.json` (slug = `<owner>-<number>`, lowercased) plus an `index.json` manifest keyed by
slug. Deterministic ordering throughout — items by `(repo, number)`, vocabularies alphabetical — so
a re-run produces a clean diff on the data branch. ~600 KB raw, ~76 KB gzipped for 408 items.

**Fields are discovered, never hardcoded.** Whatever the board defines lands in `fields[]`, and the
SPA builds one filter picker per field. Adding a column to the board needs no code change here or
in the app. Only author-defined types survive (`text`, `number`, `date`, `single_select`,
`iteration`); GitHub's built-in columns — Assignees, Labels, Milestone, Repository, Sub-issues
progress, Created/Updated/Closed — are dropped from `fields[]` because their values arrive off
`content` instead and are already top-level keys on each item. Emitting them too would give the UI
a second, permanently empty picker for each.

**State normalization.** `state` is `open | closed | merged`. Draftness is a separate `draft` flag,
*not* a state: a draft PR is still an open PR on GitHub, so folding it into `state` would make
`is:open` skip it.

## The query language

A subset of **GitHub's own Projects filter syntax** — the same grammar `gh project item-list --query`
takes. One query string is the single source of truth: the pickers, quick pills and chips all read
their state out of it and write changes back into it, so the box and the chips cannot drift apart.

| Syntax | Meaning |
|---|---|
| `is:open` `is:closed` `is:merged` | state |
| `is:issue` `is:pr` `is:draft` | type |
| `assignee:` `author:` `label:` `milestone:` `repo:` `type:` `reason:` | the usual qualifiers |
| `Status:Done`, `"Program Increment":"PI 26.4"` | **any board field, by its own name** |
| `no:assignee` / `has:assignee` | absence / presence (`-no:assignee` == `has:assignee`) |
| `-label:bug` | negation |
| `label:a,b` | comma = **OR** |
| `label:a label:b` | repeating = **AND** |
| `updated:>@today-7d`, `Start Date:<=2026-01-31` | date comparison: `>` `>=` `<` `<=` |
| `portal hosting` | plain words over title, body excerpt, number, repo, people, labels |

> **The comma/repeat distinction is load-bearing.** `label:a,b` is *either*; `label:a label:b` is
> *both*; `is:open is:closed` is a contradiction and correctly returns **nothing**. Internally each
> token becomes its own group and matching requires a hit in every group — flattening them would
> quietly turn that contradiction into "everything".

`repo:` accepts the bare name as well as `owner/name`. Values with spaces or colons are quoted
automatically when a picker writes them (this board has a `owner: Disasters` label, which exercises
both).

**Deliberately not supported** — flagged rather than silently dropped: wildcards (`label:*bug*`),
ranges (`points:1..3`), and the iteration keywords `@current` / `@previous` / `@next`. `@me` is
meaningless here, since the app has no signed-in user. An unrecognized qualifier is reported in the
count strip *and* searched as plain text, so a typo narrows visibly instead of doing nothing.

## The three views

| View | What it answers |
|---|---|
| **Table** | "Show me everything at once." Sortable on any column (blanks always sink), a column picker persisted in `localStorage`, sticky header, CSV export of exactly the rows on screen. |
| **By assignee** | "What is on each person's plate?" One lane per person with open/closed counts and a workload bar, plus an **Unassigned** bucket — 119 of 408 items on the real board have no assignee. An item with two assignees appears in *both* lanes (shared work is on both plates), so lane counts sum to more than the item count; the header says so. Lanes cap at 12 items with a per-lane expander, because the busiest lane holds 172. |
| **Timeline** | "When is the work?" Bars on a month axis with a today marker and PI bands. |

**Timeline date sources.** Only 123 of 408 items carry explicit Start/End dates, so going straight to
created→closed would draw a meaningless chart. Iterations already carry a window (`startDate` +
`duration`), so the default "Auto" source falls back **Start/End → Sprint → Program Increment →
created→closed**, and each bar's tooltip names the source it used. You can pin one source instead.

## Theming
The repo's standard mechanism: `src/theme.ts`, a `:root[data-theme="dark"]` block in `styles.css`,
the no-FOUC inline script in `index.html`, `localStorage` key **`board-theme`**, default dark.

**Only chrome adapts — data colours stay fixed.** The nuance this app adds: a raw GitHub label hex
is often illegible on the opposite background (`#0e8a16` on near-black, `#fbca04` on white). So a
chip keeps its **hue** — the thing that identifies which label it is — while only its **lightness**
adapts, via `color-mix(… var(--ink))` on the text. The e2e suite asserts exactly this: the chip
background is byte-identical across themes while the text colour changes.

## Tests
| Command | Covers |
|---|---|
| `python3 board-explorer/scripts/test_generate.py` | The flattener, against a canned GraphQL bundle: the field-value union, the builtin/custom split, `merged ≠ closed`, drafts, redacted and archived items, pagination. 29 named invariants plus a golden diff. `--update` re-freezes the golden. |
| `node board-explorer/scripts/test_search.ts` | The query grammar and CSV, against the **real** committed board snapshot. Node strips the types itself — no test framework, no dependency. |
| `node board-explorer/scripts/e2e.mjs` | The real UI in a browser. Playwright is deliberately **not** a devDependency and this is **not** in CI; run it by hand before shipping a UI change. Falls back to system Chrome if the bundled Chromium isn't downloaded. `SHOTS=1` writes screenshots. |

The first two run in CI (`.github/workflows/board-explorer-validate.yml`) alongside `npm run
typecheck` and `npm run build`. Both are offline and need no token.

## Gotchas
- **`gh auth status` showing `read:project` is the difference between a working generator and a wall
  of `INSUFFICIENT_SCOPES`.** The default `GITHUB_TOKEN` never has it.
- **The live crawl gets rate-limited.** 408 items over 9 pages of a deep GraphQL query trips the
  secondary limit; `gh_graphql()` backs off and retries, so a run takes ~70 s rather than failing.
- **Root `.gitignore` has a global `*.json`.** `board-explorer/` has explicit `!` negations so a
  plain `git add board-explorer/` picks up config, snapshot and fixtures. Verify with
  `git check-ignore --no-index -v <path>` — and read the **rule it prints**, not the exit code:
  check-ignore exits 0 when *any* rule matches, negations included.
- **Only one runtime cross-module import exists in `src/` (`csv.ts` → `filter.ts`) and it carries an
  explicit `.ts` extension**, because `scripts/test_search.ts` is run by Node, whose ESM resolver
  needs it. Every other cross-module import is `import type`, which erases. Dropping that extension
  breaks the test suite but not the Vite build.
- **Netlify:** base directory `board-explorer`; leave build command and publish dir **empty** in the
  UI. A blank base dir fails *green* — it publishes the repo root and 404s with no error.
