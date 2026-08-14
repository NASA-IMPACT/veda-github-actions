// Turning staged requests into ONE prefilled-PR file.
//
// GitHub's `new/<branch>?filename=&value=` route creates a single new file on a fresh branch and
// offers a PR — no backend, no OAuth, no token. Every staged request goes into that one file, so
// one trip to GitHub = one PR, and the filename is unique (timestamp-stamped) so two people
// submitting at once never conflict.

import type { AlgorithmRequest } from "./types";
import { slugify } from "./request/drafts";

export const REPO = "NASA-IMPACT/veda-github-actions";
export const BASE_BRANCH = "main";

/**
 * How long a prefilled-PR URL may get before GitHub (and the browser) choke on it.
 *
 * cost-dashboard uses the same 190000; dse-hub's ChangesCart uses 7500, which is far too small
 * here — one request over a broad hazard set can carry 40+ products and blow past 7500 on its own.
 * Above the limit the PR button is disabled and the user is told to use "Copy JSON" instead.
 */
export const URL_LIMIT = 190000;

/** Directory the compactor folds back into the canonical data. Repo-root relative. */
export const REQUEST_DIR = "algorithm-catalog/data/requests";

/**
 * Build the filename + JSON body for a bundle of staged requests.
 *
 * Filename is REPO-ROOT relative (that is what the GitHub `new/` route wants) — do NOT build it in
 * request/drafts.ts; dse-hub grew a vestigial second path constant by doing exactly that.
 * Stamp = the newest `ts` in the bundle with every non-alphanumeric replaced by "-", which keeps
 * the name sortable, unique, and safe on every filesystem.
 */
export function buildRequestFile(items: AlgorithmRequest[]): { filename: string; json: string } {
  const maxTs = items.reduce((m, r) => (r.ts > m ? r.ts : m), "");
  const stamp = maxTs.replace(/[^a-zA-Z0-9]/g, "-");
  const newest = items.find((r) => r.ts === maxTs) ?? items[0];
  const base = newest ? slugify(newest.event.stacName || newest.event.name) : "request";
  const slug = items.length > 1 ? `${base}-plus-${items.length - 1}` : base;
  return {
    filename: `${REQUEST_DIR}/${stamp}-${slug}.json`,
    json: JSON.stringify(items, null, 2),
  };
}

/** The prefilled "create a new file" URL. `path` is repo-root relative. */
export function ghNewFileUrl(path: string, content: string): string {
  return `https://github.com/${REPO}/new/${BASE_BRANCH}?filename=${encodeURIComponent(
    path,
  )}&value=${encodeURIComponent(content)}`;
}
