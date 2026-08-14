// GitHub-only datastore: every dataset is committed JSON under data/, bundled at BUILD time.
// No runtime fetch, no CDN staleness, no env vars — Netlify rebuilds when a PR merges, and that
// merge is the only thing that changes what this app shows.
//
// Mirrors dse-hub/src/meetings/data.ts: canonical arrays imported directly, plus an
// import.meta.glob overlay of the files that submissions create.

import type {
  ActivationEvent,
  Algorithm,
  AlgorithmRequest,
  EventLayer,
  Hazard,
  Product,
} from "./types";
import algorithmsRaw from "../data/algorithms.json";
import eventsRaw from "../data/events.json";
import hazardsRaw from "../data/hazards.json";
import requestsRaw from "../data/requests.json";

/**
 * Submitted requests arrive as data/requests/<ts>-<slug>.json (one file per PR), and
 * scripts/compact.mjs later folds them into the canonical data/requests.json and DELETES the
 * individual files. Both sources therefore have to be read — globbing only the directory would
 * make every compacted request vanish from the Event Catalog the moment the workflow runs.
 *
 * A file may hold a single request or an array of them (the cart can stage several), so the
 * module type covers both and `asArray` normalizes.
 */
const requestMods = import.meta.glob<{ default: AlgorithmRequest | AlgorithmRequest[] }>(
  "../data/requests/*.json",
  { eager: true },
);

function asArray(v: AlgorithmRequest | AlgorithmRequest[] | undefined): AlgorithmRequest[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// ---------------------------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------------------------

/**
 * Catalog order is the order in data/algorithms.json — it is hand-curated (optical first, then
 * SAR, then night lights) and request/drafts.ts `autoProducts` derives hazard products in that
 * same order, so DO NOT sort here.
 */
export function loadAlgorithms(): Algorithm[] {
  return (algorithmsRaw as Algorithm[]).filter((a) => a && a.id && a.title);
}

/** Newest activation first — a responder cares about the most recent comparable event. */
export function loadEvents(): ActivationEvent[] {
  return [...(eventsRaw as ActivationEvent[])]
    .filter((e) => e && e.id && e.stacName)
    .sort((a, b) => b.start.localeCompare(a.start) || a.name.localeCompare(b.name));
}

/** Vocabulary order is curated (most-activated hazard first); left as authored. */
export function loadHazards(): Hazard[] {
  return (hazardsRaw as Hazard[]).filter((h) => h && h.id && h.token);
}

/**
 * Everything submitted through the request form: the compacted canonical array plus every
 * not-yet-compacted file, upserted by `id` with the newest `ts` winning — exactly how dse-hub
 * merges `meetings.json` with `changes/*.json`.
 *
 * `resolveJsonModule` types the currently-empty requests.json as `never[]`, hence the double cast.
 */
export function loadRequests(): AlgorithmRequest[] {
  const map = new Map<string, AlgorithmRequest>();
  for (const r of requestsRaw as unknown as AlgorithmRequest[]) {
    if (r && r.id && r.event) map.set(r.id, r);
  }

  const overlay: AlgorithmRequest[] = [];
  for (const path in requestMods) {
    overlay.push(...asArray(requestMods[path]?.default));
  }
  overlay.sort((a, b) => a.ts.localeCompare(b.ts)); // oldest → newest, so the newest wins on upsert
  for (const r of overlay) {
    if (r && r.id && r.event) map.set(r.id, r);
  }

  return [...map.values()].sort((a, b) => b.ts.localeCompare(a.ts)); // newest first for display
}

// ---------------------------------------------------------------------------------------------
// The event catalog: published activations + submitted requests, in one list
//
// An event a responder submits through the form has to be VISIBLE — otherwise they cannot tell
// whether their request landed. So the Events tab shows the union. The two are never conflated:
// `source` badges each row, and a request that names an existing activation is folded into that
// activation as an update rather than appearing as a second, competing row.
// ---------------------------------------------------------------------------------------------

export type EventSource = "published" | "submitted";

/** One submission attached to a catalog row. */
export interface EventSubmission {
  id: string;
  ts: string;
  requester?: string;
  notes?: string;
  layers: EventLayer[];
}

export interface CatalogEvent extends ActivationEvent {
  source: EventSource;
  /** Every request naming this `stacName`, newest first. Empty for an untouched activation. */
  submissions: EventSubmission[];
}

function requestLayers(r: AlgorithmRequest): EventLayer[] {
  return r.products.map((p) => ({ algorithm: p.algorithm, product: p.product }));
}

/**
 * Published activations + submitted requests, keyed by `stacName`, newest activation first.
 * A published event always wins the row; matching requests ride along in `submissions`.
 */
export function loadEventCatalog(): CatalogEvent[] {
  const byStac = new Map<string, CatalogEvent>();

  for (const e of loadEvents()) {
    byStac.set(e.stacName, { ...e, source: "published", submissions: [] });
  }

  // loadRequests() is already newest-first, so the FIRST request naming an unpublished stacName
  // becomes the row and every older one rides along in `submissions`.
  for (const r of loadRequests()) {
    const stac = r.event.stacName || r.id;
    const submission: EventSubmission = {
      id: r.id,
      ts: r.ts,
      requester: r.requester,
      notes: r.notes,
      layers: requestLayers(r),
    };
    const existing = byStac.get(stac);
    if (existing) {
      existing.submissions.push(submission);
      continue;
    }
    byStac.set(stac, {
      id: r.id,
      name: r.event.name || stac,
      stacName: stac,
      start: r.event.start,
      end: r.event.end,
      hazards: [...r.event.hazards],
      locations: [...r.event.locations],
      bbox: r.event.bbox,
      layers: submission.layers,
      externalLayers: [],
      source: "submitted",
      submissions: [submission],
    });
  }

  return [...byStac.values()].sort(
    (a, b) => b.start.localeCompare(a.start) || a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/**
 * Stable key for one algorithm×product pair.
 * MUST stay byte-identical to request/drafts.ts `productKey()` — the request form and the product
 * facet here address the same pairs, and a different separator would silently stop them matching.
 */
export function productKey(algorithmId: string, productId: string): string {
  return `${algorithmId}:${productId}`;
}

export interface ProductRef {
  key: string;
  algorithm: Algorithm;
  product: Product;
}

/** Every algorithm×product pair in catalog order — the option list for the Product facet. */
export function allProducts(algorithms: Algorithm[]): ProductRef[] {
  const out: ProductRef[] = [];
  for (const algorithm of algorithms) {
    for (const product of algorithm.products) {
      out.push({ key: productKey(algorithm.id, product.id), algorithm, product });
    }
  }
  return out;
}

export function algorithmById(algorithms: Algorithm[], id: string): Algorithm | undefined {
  return algorithms.find((a) => a.id === id);
}

export function productById(
  algorithms: Algorithm[],
  algorithmId: string,
  productId: string,
): Product | undefined {
  return algorithmById(algorithms, algorithmId)?.products.find((p) => p.id === productId);
}

// ---------------------------------------------------------------------------------------------
// Date display
//
// Hand-rolled, no date library (zero new dependencies) — and no `new Date(iso)` either, which
// would parse "2025-01-10" as UTC midnight and render as 9 Jan for anyone west of Greenwich.
// Every date in this app is a plain "YYYY-MM-DD" string, so it is only ever split, never parsed.
//
// These live here rather than next to the event views because BOTH views need them, and importing
// one view from the other would put a cycle between them.
// ---------------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function formatRange(start: string, end: string): string {
  if (!start && !end) return "no dates";
  if (start === end) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}
