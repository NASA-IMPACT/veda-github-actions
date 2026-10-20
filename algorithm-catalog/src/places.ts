// The gazetteer behind the place picker: pick a location at whatever level of interest —
// "Alabama", or narrower, "Montgomery, Alabama" — and get its bounding box for free.
//
// Built once by scripts/build_places.py from Natural Earth + US Census boundaries and committed.
// Countries, US states/territories and counties (~3.5k rows) are bundled eagerly; the ~32k US
// cities are a LAZY chunk, pulled in the first time someone searches or narrows. Both are still
// build-time imports — no runtime fetch, same rule as src/data.ts.
//
// Rows are [id, name, west, south, east, north]. Ids are hierarchical (see src/types.ts Place), so
// level and parent are read off the id and the display label is derived here, never stored.

import type { Place, PlaceLevel } from "./types";
import placesRaw from "../data/places.json";

type Row = [string, string, number, number, number, number];

const byId = new Map<string, Place>();
let cityRows: Place[] = [];
let citiesPromise: Promise<void> | null = null;

export function placeLevel(id: string): PlaceLevel {
  if (/^[A-Z]{2}$/.test(id)) return "country";
  if (/^[A-Z]{2}-[A-Z]{2}$/.test(id)) return "state";
  if (/-c[0-9]{5}$/.test(id)) return "city";
  return "county";
}

/** City and county → their state; state → its country; a country has none. */
export function parentId(id: string): string | null {
  const parts = id.split("-");
  return parts.length > 1 ? parts.slice(0, parts.length === 3 ? 2 : 1).join("-") : null;
}

function toPlace([id, name, w, s, e, n]: Row): Place {
  const level = placeLevel(id);
  const state = level === "county" || level === "city" ? byId.get(parentId(id)!) : undefined;
  return { id, name, level, label: state ? `${name}, ${state.name}` : name, bbox: [w, s, e, n] };
}

// States must be indexed before counties/cities so their labels can name the state.
const eager = placesRaw as unknown as Row[];
for (const r of eager) if (placeLevel(r[0]) !== "county") byId.set(r[0], toPlace(r));
for (const r of eager) if (placeLevel(r[0]) === "county") byId.set(r[0], toPlace(r));

/** Pull in the city chunk once. Resolves immediately after the first time. */
export function loadCities(): Promise<void> {
  citiesPromise ??= import("../data/places-cities.json").then((m) => {
    cityRows = (m.default as unknown as Row[]).map(toPlace);
    for (const p of cityRows) byId.set(p.id, p);
  });
  return citiesPromise;
}

export const citiesLoaded = (): boolean => cityRows.length > 0;

export function getPlace(id: string): Place | undefined {
  return byId.get(id);
}

const LEVEL_ORDER: Record<PlaceLevel, number> = { country: 0, state: 1, county: 2, city: 3 };

/**
 * Typeahead. A name that STARTS with the query outranks one that merely contains it, then broader
 * levels first — so "los angeles" lists the county and the city of that name before
 * "East Los Angeles", and "alabama" lists the state before anything inside it.
 */
export function searchPlaces(query: string, exclude: Set<string>, limit = 12): Place[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: { p: Place; rank: number }[] = [];
  for (const p of byId.values()) {
    if (exclude.has(p.id)) continue;
    const name = p.name.toLowerCase();
    const label = p.label.toLowerCase();
    const rank = name.startsWith(q) ? 0 : label.startsWith(q) ? 1 : label.includes(q) ? 2 : -1;
    if (rank >= 0) hits.push({ p, rank });
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      LEVEL_ORDER[a.p.level] - LEVEL_ORDER[b.p.level] ||
      a.p.label.localeCompare(b.p.label),
  );
  return hits.slice(0, limit).map((h) => h.p);
}

/** One level narrower: US → states; a state → its counties, then its cities. Others: none. */
export function childrenOf(id: string): Place[] {
  const level = placeLevel(id);
  if (level === "country") {
    return id === "US" ? [...byId.values()].filter((p) => p.level === "state") : [];
  }
  if (level !== "state") return [];
  const prefix = `${id}-`;
  return [...byId.values()]
    .filter((p) => p.id.startsWith(prefix))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.name.localeCompare(b.name));
}

export const canNarrow = (id: string): boolean => id === "US" || placeLevel(id) === "state";

// ---------------------------------------------------------------------------------------------
// Bounding box from the picked places
// ---------------------------------------------------------------------------------------------

/** Black Marble's floor is 0.05° (rules.ts BBOX_MIN_LAT_SPAN); pad a small city past it. */
const MIN_LAT_SPAN_PADDED = 0.06;

const fmt = (n: number) => String(Number(n.toFixed(3)));

/**
 * The union of the places' boxes as "w,s,e,n", or `bbox: null` when it cannot be expressed as one
 * WGS84 box — anything spanning more than 180° of longitude has almost certainly wrapped the
 * antimeridian (Alaska's Aleutians, the whole US, Guam + the mainland) and a min/max union of it
 * would be a box around the planet.
 */
export function unionBbox(ids: string[]): { bbox: string | null; note: string } {
  const boxes = ids.map((id) => getPlace(id)?.bbox).filter((b): b is Place["bbox"] => !!b);
  if (boxes.length === 0) return { bbox: "", note: "" };
  let [w, s, e, n] = boxes[0];
  for (const [bw, bs, be, bn] of boxes.slice(1)) {
    w = Math.min(w, bw);
    s = Math.min(s, bs);
    e = Math.max(e, be);
    n = Math.max(n, bn);
  }
  if (e - w > 180) {
    return {
      bbox: null,
      note: "These places straddle the antimeridian, so no single box covers them — the bounding box was left as it was. Enter one by hand if you need it.",
    };
  }
  if (n - s < MIN_LAT_SPAN_PADDED) {
    const mid = (n + s) / 2;
    s = Math.max(-90, mid - MIN_LAT_SPAN_PADDED / 2);
    n = Math.min(90, mid + MIN_LAT_SPAN_PADDED / 2);
  }
  return { bbox: [w, s, e, n].map(fmt).join(","), note: "" };
}
