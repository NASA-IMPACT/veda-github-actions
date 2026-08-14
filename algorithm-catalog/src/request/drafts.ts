// The in-form model for one activation request.
//
// Everything here is PURE — no React, no Date.now(), no filename building (the cart owns filenames,
// see src/requests.ts). Mirrors the convention in dse-hub/src/meetings/drafts.ts and
// leave-dashboard/src/drafts.ts: a flat, all-strings draft that the form binds directly to, plus
// one function each way (draft -> record, record -> draft).
//
// The draft is deliberately dumb: every scalar is a string exactly as typed, so the live validator
// in src/rules.ts sees the same text the user sees. Nothing is coerced or "fixed up" behind their
// back — a bad date stays bad until they fix it, and the error says why.

import type { Algorithm, AlgorithmRequest, RequestProduct } from "../types";
import type { RequestShape } from "../rules";
import { splitTiles } from "../rules";

/** Stable key for one algorithm×product pair. */
export function productKey(p: { algorithm: string; product: string }): string {
  return `${p.algorithm}:${p.product}`;
}

export interface RequestDraft {
  // --- event (all strings, straight off the inputs) ---
  name: string; // human-readable, e.g. "California Wildfires January 2025"
  stacName: string; // YYYYMM_Hazard_Location, e.g. "202501_Fire_CA"
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  bbox: string; // "min_lon,min_lat,max_lon,max_lat" — optional
  mgrsTiles: string; // optional, space-separated Sentinel-2 MGRS tiles, e.g. "T17RLN T17RLM"
  wrs2Tiles: string; // optional, space-separated Landsat WRS-2 path/rows, e.g. "171035"
  requester: string; // optional
  notes: string; // optional
  // --- repeatable / multi-select ---
  hazards: string[]; // Hazard["id"]
  locations: string[]; // free text rows; always at least one (possibly empty) row
  products: RequestProduct[]; // resolved list: hazard-derived (via:"hazard") + hand-picked (via:"manual")
  /** productKey()s of hazard-derived products the user removed, so they don't reappear. Draft-only. */
  dismissed: string[];
}

export function newDraft(): RequestDraft {
  return {
    name: "",
    stacName: "",
    start: "",
    end: "",
    bbox: "",
    mgrsTiles: "",
    wrs2Tiles: "",
    requester: "",
    notes: "",
    hazards: [],
    locations: [""],
    products: [],
    dismissed: [],
  };
}

export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "request";
}

/** The id an AlgorithmRequest gets — also the upsert key in the requests cart. */
export function draftId(d: RequestDraft): string {
  return slugify(d.stacName || d.name);
}

/** Trimmed, empty rows dropped. */
export function cleanLocations(locations: string[]): string[] {
  return locations.map((l) => l.trim()).filter(Boolean);
}

/** What src/rules.ts validates. Kept separate so the form can validate WITHOUT building a record. */
export function draftToShape(d: RequestDraft): RequestShape {
  return {
    name: d.name,
    stacName: d.stacName,
    start: d.start,
    end: d.end,
    hazards: d.hazards,
    locations: cleanLocations(d.locations),
    bbox: d.bbox,
    mgrsTiles: d.mgrsTiles,
    wrs2Tiles: d.wrs2Tiles,
    products: d.products.map((p) => ({ algorithm: p.algorithm, product: p.product })),
  };
}

/** `ts` is passed in (not generated) so this stays pure and the JSON preview is stable per render. */
export function draftToRequest(d: RequestDraft, ts: string): AlgorithmRequest {
  const r: AlgorithmRequest = {
    kind: "algorithm-request",
    id: draftId(d),
    ts,
    event: {
      name: d.name.trim(),
      stacName: d.stacName.trim(),
      start: d.start,
      end: d.end,
      hazards: [...d.hazards],
      locations: cleanLocations(d.locations),
    },
    products: d.products.map((p) => ({ ...p })),
  };
  if (d.bbox.trim()) r.event.bbox = d.bbox.trim();
  const mgrs = splitTiles(d.mgrsTiles);
  const wrs2 = splitTiles(d.wrs2Tiles);
  if (mgrs.length || wrs2.length) {
    r.event.tiles = {};
    if (mgrs.length) r.event.tiles.mgrs = mgrs;
    if (wrs2.length) r.event.tiles.wrs2 = wrs2;
  }
  if (d.requester.trim()) r.requester = d.requester.trim();
  if (d.notes.trim()) r.notes = d.notes.trim();
  return r;
}

/** Reverse: prefill the form from a staged request (edit-from-cart). */
export function requestToDraft(r: AlgorithmRequest): RequestDraft {
  const d = newDraft();
  d.name = r.event.name;
  d.stacName = r.event.stacName;
  d.start = r.event.start;
  d.end = r.event.end;
  d.bbox = r.event.bbox ?? "";
  d.mgrsTiles = (r.event.tiles?.mgrs ?? []).join(" ");
  d.wrs2Tiles = (r.event.tiles?.wrs2 ?? []).join(" ");
  d.requester = r.requester ?? "";
  d.notes = r.notes ?? "";
  d.hazards = [...r.event.hazards];
  d.locations = r.event.locations.length > 0 ? [...r.event.locations] : [""];
  d.products = r.products.map((p) => ({ ...p }));
  return d;
}

// ---------------------------------------------------------------------------------------------
// Hazard -> product derivation
//
// Product["hazards"] is the hand-built suitability mapping in data/algorithms.json. Picking a
// hazard auto-selects every product that claims it; the user can drop any of them (remembered in
// `dismissed`) and add anything the mapping missed via the picker (those come back as "manual").
// ---------------------------------------------------------------------------------------------

/** Every product whose suitability mapping mentions one of the selected hazards, in catalog order. */
export function autoProducts(algorithms: Algorithm[], hazardIds: string[]): RequestProduct[] {
  if (hazardIds.length === 0) return [];
  const want = new Set(hazardIds);
  const out: RequestProduct[] = [];
  for (const a of algorithms) {
    // Prototype algorithms have no DPS job — never propose them automatically; the user can
    // still add them by hand from the picker if they really want manual processing.
    if (a.status === "prototype") continue;
    for (const p of a.products) {
      // primaryHazards, NOT hazards. `hazards` is the broad discovery set (every product that
      // could conceivably help); auto-selecting from it produced ~28 chips for a single hazard,
      // which is noise, not a starting point.
      if (p.primaryHazards.some((h) => want.has(h))) {
        out.push({ algorithm: a.id, product: p.id, via: "hazard" });
      }
    }
  }
  return out;
}

/**
 * Recompute the resolved product list after a hazard change.
 * Manual picks always survive; hazard-derived picks follow the hazard selection minus `dismissed`.
 */
export function syncProducts(
  current: RequestProduct[],
  algorithms: Algorithm[],
  hazardIds: string[],
  dismissed: string[],
): RequestProduct[] {
  const manual = current.filter((p) => p.via === "manual");
  const manualKeys = new Set(manual.map(productKey));
  const skip = new Set(dismissed);
  const auto = autoProducts(algorithms, hazardIds).filter(
    (p) => !manualKeys.has(productKey(p)) && !skip.has(productKey(p)),
  );
  return [...auto, ...manual];
}
