// The filtering standard for the Algorithms and Events tabs. Pure functions only — no React, no
// data loading — so the predicates can be reasoned about (and reused) on their own.
//
// The one rule that governs every facet: A FULLY-SELECTED FACET IS NOT A FILTER. State starts with
// every option selected, which means "show everything"; a facet only narrows once its selection is
// a strict subset. That keeps "clear this facet" and "select everything" the same gesture, and it
// is why every predicate below takes the universe it is being compared against.

import type { ActivationEvent, Algorithm, Hazard, Modality, Product } from "../types";
import { MODALITY_ORDER } from "../colors";
import { productKey, type CatalogEvent } from "../data";

/** Which pickers lead the Algorithms toolbar. Both modes share ONE filter state. */
export type EntryMode = "hazard" | "sensor";

export interface Filters {
  hazards: Set<string>;
  /** Algorithm ids. */
  sensors: Set<string>;
  /** productKey()s. */
  products: Set<string>;
  modalities: Set<string>;
  /** "" == unset. */
  start: string;
  end: string;
  /** ActivationEvent["id"], "" == none. Prefills the other facets; never filters by itself. */
  eventId: string;
  aoi: string;
  query: string;
}

/** Every option each facet could hold — the denominator for "is this facet actually filtering?". */
export interface Universe {
  hazards: string[];
  sensors: string[];
  products: string[];
  modalities: string[];
}

/**
 * Modalities come from the DATA, not from the `Modality` union: the union still declares
 * "utility" but no algorithm uses it since list_dates was dropped, and an option that can never
 * match anything is a lie in the UI.
 */
export function universeOf(algorithms: Algorithm[], hazards: Hazard[]): Universe {
  const present = new Set(algorithms.map((a) => a.modality));
  return {
    hazards: hazards.map((h) => h.id),
    sensors: algorithms.map((a) => a.id),
    products: algorithms.flatMap((a) => a.products.map((p) => productKey(a.id, p.id))),
    modalities: MODALITY_ORDER.filter((m) => present.has(m)) as string[],
  };
}

/** Initial state: everything selected == nothing filtered. */
export function allSelected(u: Universe): Filters {
  return {
    hazards: new Set(u.hazards),
    sensors: new Set(u.sensors),
    products: new Set(u.products),
    modalities: new Set(u.modalities),
    start: "",
    end: "",
    eventId: "",
    aoi: "",
    query: "",
  };
}

/** A facet narrows only when its selection is a strict subset (0 selected means "match nothing"). */
export function isFacetActive(selected: Set<string>, universe: string[]): boolean {
  return selected.size !== universe.length;
}

export function activeFacetCount(f: Filters, u: Universe): number {
  let n = 0;
  if (isFacetActive(f.hazards, u.hazards)) n++;
  if (isFacetActive(f.sensors, u.sensors)) n++;
  if (isFacetActive(f.products, u.products)) n++;
  if (isFacetActive(f.modalities, u.modalities)) n++;
  if (f.start || f.end) n++;
  if (f.eventId) n++;
  if (f.aoi.trim()) n++;
  if (f.query.trim()) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Algorithms
// ---------------------------------------------------------------------------------------------

/** Everything the Algorithms search box searches, per the tab spec. */
export function algorithmHaystack(a: Algorithm): string {
  return [
    a.title,
    a.algorithmName,
    a.vendor,
    a.description,
    a.id,
    a.resolution,
    ...a.keywords,
    ...a.products.flatMap((p) => [p.id, p.label]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesQuery(a: Algorithm, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return !needle || algorithmHaystack(a).includes(needle);
}

/**
 * The date facet. An algorithm records only when its record BEGINS — there is no temporal end
 * upstream — so the only sound test is "did data exist by the time this window closed?".
 * The bound is the later of the two inputs, so a start-only window still narrows sensibly.
 */
export function passesDate(a: Algorithm, f: Filters): boolean {
  const bound = f.end || f.start;
  return !bound || a.temporalStart <= bound;
}

/** Products of `a` that satisfy the hazard and product facets — the chips shown on its card. */
export function matchedProducts(a: Algorithm, f: Filters, u: Universe): Product[] {
  const byHazard = isFacetActive(f.hazards, u.hazards);
  const byProduct = isFacetActive(f.products, u.products);
  if (!byHazard && !byProduct) return a.products;
  return a.products.filter(
    (p) =>
      (!byHazard || p.hazards.some((h) => f.hazards.has(h))) &&
      (!byProduct || f.products.has(productKey(a.id, p.id))),
  );
}

export function filterAlgorithms(algorithms: Algorithm[], f: Filters, u: Universe): Algorithm[] {
  const byHazard = isFacetActive(f.hazards, u.hazards);
  const bySensor = isFacetActive(f.sensors, u.sensors);
  const byProduct = isFacetActive(f.products, u.products);
  const byModality = isFacetActive(f.modalities, u.modalities);

  return algorithms.filter((a) => {
    // Hazard: the algorithm matches if ANY of its products claims a selected hazard.
    if (byHazard && !a.products.some((p) => p.hazards.some((h) => f.hazards.has(h)))) return false;
    if (bySensor && !f.sensors.has(a.id)) return false;
    if (byProduct && !a.products.some((p) => f.products.has(productKey(a.id, p.id)))) return false;
    if (byModality && !f.modalities.has(a.modality as Modality)) return false;
    if (!passesDate(a, f)) return false;
    return matchesQuery(a, f.query);
  });
}

/**
 * Selecting an activation PREFILLS the facets from it — hazards, the date window, and the first
 * location as the AOI text. It never filters on its own; the algorithms it actually used are
 * surfaced by `eventAlgorithms()` as a highlight instead, so a responder can see "what we ran last
 * time" without losing everything else the filters would have shown them.
 */
export function applyEvent(f: Filters, u: Universe, ev: ActivationEvent | null): Filters {
  if (!ev) return { ...f, eventId: "" };
  const known = ev.hazards.filter((h) => u.hazards.includes(h));
  return {
    ...f,
    eventId: ev.id,
    hazards: new Set(known.length > 0 ? known : u.hazards),
    start: ev.start,
    end: ev.end,
    aoi: ev.locations[0] ?? "",
  };
}

export function eventAlgorithms(ev: ActivationEvent | null | undefined): Set<string> {
  return new Set(ev ? ev.layers.map((l) => l.algorithm) : []);
}

/**
 * AOI matching, and the reason the AOI box cannot narrow the algorithm list: it matches an
 * EVENT's recorded locations. No algorithm in the catalog carries a coverage polygon — every one
 * of these sensors is globally taskable — so there is nothing on an algorithm for a place name to
 * be tested against.
 */
export function eventsMatchingAoi<T extends { locations: string[]; name: string }>(
  events: T[],
  aoi: string,
): T[] {
  const needle = aoi.trim().toLowerCase();
  if (!needle) return [];
  return events.filter(
    (e) =>
      e.locations.some((l) => l.toLowerCase().includes(needle)) ||
      e.name.toLowerCase().includes(needle),
  );
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

export interface EventFilters {
  query: string;
  hazards: Set<string>;
  start: string;
  end: string;
}

export function emptyEventFilters(u: Universe): EventFilters {
  return { query: "", hazards: new Set(u.hazards), start: "", end: "" };
}

/**
 * The Events search box searches the event's own text plus the human names of the layers it used,
 * so "Black Marble" finds the Venezuela earthquake even though the event only stores `blackmarble`.
 */
export function eventHaystack(
  ev: CatalogEvent,
  hazardLabels: Map<string, string>,
  layerLabels: Map<string, string>,
): string {
  return [
    ev.name,
    ev.stacName,
    ...ev.hazards.map((h) => `${h} ${hazardLabels.get(h) ?? ""}`),
    ...ev.locations,
    ...ev.layers.map((l) => `${l.algorithm} ${l.product} ${layerLabels.get(productKey(l.algorithm, l.product)) ?? ""}`),
    ...ev.externalLayers,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Two windows overlap unless one ends before the other begins. */
function overlaps(evStart: string, evEnd: string, start: string, end: string): boolean {
  if (start && evEnd < start) return false;
  if (end && evStart > end) return false;
  return true;
}

export function filterEvents(
  events: CatalogEvent[],
  f: EventFilters,
  u: Universe,
  hazardLabels: Map<string, string>,
  layerLabels: Map<string, string>,
): CatalogEvent[] {
  const byHazard = isFacetActive(f.hazards, u.hazards);
  const needle = f.query.trim().toLowerCase();
  return events.filter((ev) => {
    if (byHazard && !ev.hazards.some((h) => f.hazards.has(h))) return false;
    if (!overlaps(ev.start, ev.end, f.start, f.end)) return false;
    return !needle || eventHaystack(ev, hazardLabels, layerLabels).includes(needle);
  });
}
