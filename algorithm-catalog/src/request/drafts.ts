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

import type { ActivationEvent, Algorithm, AlgorithmRequest, EventPage, Need, PageImage, RequestProduct } from "../types";
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
  end: string; // YYYY-MM-DD — optional; blank = ongoing
  bbox: string; // "min_lon,min_lat,max_lon,max_lat" — optional
  mgrsTiles: string; // optional, space-separated Sentinel-2 MGRS tiles, e.g. "T17RLN T17RLM"
  wrs2Tiles: string; // optional, space-separated Landsat WRS-2 path/rows, e.g. "171035"
  requester: string; // optional
  notes: string; // optional
  // --- event page (the public website's own text) ---
  subtitle: string;
  intro: string;
  govLink: string;
  needs: Need[];
  /** Google Drive image links, as typed. A row with a blank link is dropped on submit. */
  images: { url: string; placement: PageImage["placement"]; alt: string; caption: string }[];
  region: string; // optional override of the page's Region; blank = the locations
  portalId: string; // optional override of the portal page id; blank = derived from the name
  // --- repeatable / multi-select ---
  hazards: string[]; // Hazard["id"]
  /** Gazetteer picks, at any level of interest. `label` travels with the id so this stays pure. */
  places: { id: string; label: string }[];
  locations: string[]; // FREE-TEXT rows, for anything the gazetteer lacks; always >= 1 (maybe empty) row
  /** True while the bbox should follow `places`. Typing in the bbox field turns it off for good. */
  bboxAuto: boolean;
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
    subtitle: "",
    intro: "",
    govLink: "",
    needs: [],
    images: [],
    region: "",
    portalId: "",
    hazards: [],
    places: [],
    locations: [""],
    bboxAuto: true,
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

/**
 * Every location's display string: the gazetteer picks FIRST, in order, then the free text.
 * That order is the contract (src/types.ts ActivationEvent.locations) that lets requestToDraft
 * pair `places[i]` back up with its label without needing the gazetteer.
 */
export function allLocations(d: RequestDraft): string[] {
  return [...d.places.map((p) => p.label), ...cleanLocations(d.locations)];
}

/** The page block, or undefined when nothing on it has been filled in. */
function draftPage(d: RequestDraft): EventPage | undefined {
  const page: EventPage = { needs: [...d.needs] };
  if (d.subtitle.trim()) page.subtitle = d.subtitle.trim();
  if (d.intro.trim()) page.intro = d.intro.trim();
  if (d.govLink.trim()) page.govLink = d.govLink.trim();
  const images = cleanImages(d);
  if (images.length) page.images = images;
  if (d.region.trim()) page.region = d.region.trim();
  if (d.portalId.trim()) page.portalId = d.portalId.trim();
  return page.subtitle || page.intro || page.govLink || page.needs.length || page.portalId || page.images
    ? page
    : undefined;
}

/** Image rows with a link, trimmed; an empty caption is left off. */
function cleanImages(d: RequestDraft): PageImage[] {
  return d.images
    .filter((i) => i.url.trim())
    .map((i) => ({
      url: i.url.trim(),
      placement: i.placement,
      alt: i.alt.trim(),
      ...(i.caption.trim() ? { caption: i.caption.trim() } : {}),
    }));
}

/** What src/rules.ts validates. Kept separate so the form can validate WITHOUT building a record. */
export function draftToShape(d: RequestDraft): RequestShape {
  return {
    name: d.name,
    stacName: d.stacName,
    start: d.start,
    end: d.end,
    hazards: d.hazards,
    locations: allLocations(d),
    places: d.places.map((p) => p.id),
    bbox: d.bbox,
    mgrsTiles: d.mgrsTiles,
    wrs2Tiles: d.wrs2Tiles,
    products: d.products.map((p) => ({ algorithm: p.algorithm, product: p.product })),
    subtitle: d.subtitle,
    intro: d.intro,
    govLink: d.govLink,
    needs: d.needs,
    portalId: d.portalId,
    images: cleanImages(d),
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
      ...(d.end ? { end: d.end } : {}),
      hazards: [...d.hazards],
      locations: allLocations(d),
    },
    products: d.products.map((p) => ({ ...p })),
  };
  if (d.places.length) r.event.places = d.places.map((p) => p.id);
  if (d.bbox.trim()) r.event.bbox = d.bbox.trim();
  const mgrs = splitTiles(d.mgrsTiles);
  const wrs2 = splitTiles(d.wrs2Tiles);
  if (mgrs.length || wrs2.length) {
    r.event.tiles = {};
    if (mgrs.length) r.event.tiles.mgrs = mgrs;
    if (wrs2.length) r.event.tiles.wrs2 = wrs2;
  }
  const page = draftPage(d);
  if (page) r.page = page;
  if (d.requester.trim()) r.requester = d.requester.trim();
  if (d.notes.trim()) r.notes = d.notes.trim();
  return r;
}

/**
 * An existing activation as a request, so "Edit page" can open it in the form. Its catalog layers
 * come back as MANUAL picks — they were chosen, not derived, and must survive a hazard toggle.
 */
export function eventToRequest(e: ActivationEvent): AlgorithmRequest {
  const r: AlgorithmRequest = {
    kind: "algorithm-request",
    id: slugify(e.stacName || e.name),
    ts: "",
    event: {
      name: e.name,
      stacName: e.stacName,
      start: e.start,
      end: e.end,
      hazards: [...e.hazards],
      locations: [...e.locations],
    },
    products: e.layers.map((l) => ({ ...l, via: "manual" })),
  };
  if (e.places?.length) r.event.places = [...e.places];
  if (e.bbox) r.event.bbox = e.bbox;
  if (e.page) r.page = { ...e.page, needs: [...e.page.needs] };
  return r;
}

/** Reverse: prefill the form from a staged request (edit-from-cart) or an event (Edit page). */
export function requestToDraft(r: AlgorithmRequest): RequestDraft {
  const d = newDraft();
  d.name = r.event.name;
  d.stacName = r.event.stacName;
  d.start = r.event.start;
  d.end = r.event.end ?? "";
  d.bbox = r.event.bbox ?? "";
  d.mgrsTiles = (r.event.tiles?.mgrs ?? []).join(" ");
  d.wrs2Tiles = (r.event.tiles?.wrs2 ?? []).join(" ");
  d.requester = r.requester ?? "";
  d.notes = r.notes ?? "";
  d.hazards = [...r.event.hazards];
  const ids = r.event.places ?? [];
  d.places = ids.map((id, i) => ({ id, label: r.event.locations[i] ?? id }));
  const free = r.event.locations.slice(ids.length);
  d.locations = free.length > 0 ? free : [""];
  // A box that came with the record was set on purpose — never let a place edit overwrite it.
  d.bboxAuto = !r.event.bbox;
  d.products = r.products.map((p) => ({ ...p }));
  d.subtitle = r.page?.subtitle ?? "";
  d.intro = r.page?.intro ?? "";
  d.govLink = r.page?.govLink ?? "";
  d.needs = [...(r.page?.needs ?? [])];
  d.images = (r.page?.images ?? []).map((i) => ({ ...i, caption: i.caption ?? "" }));
  d.region = r.page?.region ?? "";
  d.portalId = r.page?.portalId ?? "";
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
