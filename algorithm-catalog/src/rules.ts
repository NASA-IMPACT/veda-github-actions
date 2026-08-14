// THE STANDARD. Defined once here, mirrored 1:1 in scripts/validate_data.py, and kept honest by
// scripts/rules_parity_test.py (which runs the same fixture table through both copies).
//
// Every rule below is lifted from the real enforcement point in
// Disasters-Learning-Portal/disasters-product-algorithms @ dev, so this app rejects exactly what
// DPS rejects at run time — but while you type, instead of 40 minutes into a job.
//
// If you change a rule here you MUST change it in scripts/validate_data.py too; the parity test
// fails otherwise, and CI runs the parity test.

import type { Hazard } from "./types";

// ---------------------------------------------------------------------------------------------
// Source-of-truth constants
// ---------------------------------------------------------------------------------------------

/**
 * YYYYMM_Hazard_Location — EXACTLY three parts, so exactly two underscores.
 *
 * DELIBERATELY STRICTER THAN UPSTREAM. dps/_validate.sh:29-36 uses
 *   ^[0-9]{4}(0[1-9]|1[0-2])_[^_]+_.+$
 * whose final `.+` lets the LOCATION slot swallow extra underscores. That accepts
 * `202501_Tropical_Cyclone_CA` — which looks right but silently parses as
 * hazard=`Tropical`, location=`Cyclone_CA`, and then writes a GeoTIFF `HAZARD` tag of
 * "Tropical". It also accepts `202501_Flood_CA_extra` (an explicit upstream pass case, see
 * tests/integration/test_dps_validate.sh:41-48).
 *
 * The catalog rejects both: the third slot is `[^_]+` too. This is the safe direction to
 * diverge — every name WE accept, DPS also accepts. We only refuse some names DPS would have
 * taken, and those are precisely the ones that mis-slot the hazard. Multi-word hazards and
 * locations must be CamelCase: 202604_TropicalCyclone_Guam, not 202604_Tropical_Cyclone_Guam.
 */
export const STAC_EVENT_RE = /^[0-9]{4}(0[1-9]|1[0-2])_[^_]+_[^_]+$/;

/** Exactly three underscore-separated slots: YYYYMM, Hazard, Location. */
export const STAC_PART_COUNT = 3;

/** The literal placeholder the upstream configs ship with. Rejected at run time. */
export const STAC_PLACEHOLDER = "YYYYMM_Hazard_Location";

/** dps/_validate.sh:61-76 — validate_date_not_before() date shape. */
export const ISO_DATE_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

/** dps/_validate.sh:118-143 — validate_bbox(). blackmarble.crs rejects a thinner box. */
export const BBOX_MIN_LAT_SPAN = 0.05;

/** A worked example to show the user in every error message about the event name. */
export const STAC_EXAMPLE = "202511_Flood_TX";

// ---------------------------------------------------------------------------------------------
// Violation type
// ---------------------------------------------------------------------------------------------

export type Severity = "error" | "warning";

export interface Violation {
  field: string;
  rule: string;
  severity: Severity;
  message: string;
}

const err = (field: string, rule: string, message: string): Violation => ({
  field,
  rule,
  severity: "error",
  message,
});

const warn = (field: string, rule: string, message: string): Violation => ({
  field,
  rule,
  severity: "warning",
  message,
});

// ---------------------------------------------------------------------------------------------
// Individual rules
// ---------------------------------------------------------------------------------------------

/**
 * Split a STAC event name into its three slots, or null if it isn't exactly three.
 *
 * Note this does NOT mirror upstream cog_metadata.parse_activation_event(), which does a
 * `split('_', 2)` so LOCATION absorbs every trailing underscore. That absorption is the bug we
 * are closing — see STAC_EVENT_RE.
 */
export function parseStacName(v: string): { yearMonth: string; hazard: string; location: string } | null {
  const parts = v.split("_");
  if (parts.length !== STAC_PART_COUNT) return null;
  return { yearMonth: parts[0], hazard: parts[1], location: parts[2] };
}

/**
 * The headline check: STAC metadata event name must be YYYYMM_Hazard_Location.
 * `hazards` (optional) enables the soft cross-check that the token matches the hazards selected
 * on the form — the regex permits any token, but a mismatch is nearly always a mistake.
 */
export function checkStacName(value: string, hazards: Hazard[] = [], selected: string[] = []): Violation[] {
  const v = value.trim();
  const out: Violation[] = [];

  if (!v) {
    out.push(err("stacName", "required", "STAC metadata event name is required."));
    return out;
  }
  if (v === STAC_PLACEHOLDER) {
    out.push(
      err(
        "stacName",
        "placeholder",
        `"${STAC_PLACEHOLDER}" is the placeholder value and is rejected at run time. Set a real event, e.g. ${STAC_EXAMPLE}.`,
      ),
    );
    return out;
  }
  if (!STAC_EVENT_RE.test(v)) {
    // Say precisely which part is wrong — a bare "doesn't match" is useless to a responder.
    // Underscore count is checked FIRST and reported on its own, because it is the mistake
    // people actually make (writing a multi-word hazard or location in full).
    const parts = v.split("_");
    const underscores = parts.length - 1;

    if (underscores < 2) {
      out.push(
        err(
          "stacName",
          "underscore-count",
          `Needs exactly 2 underscores (YYYYMM_Hazard_Location) — found ${underscores}. Example: ${STAC_EXAMPLE}.`,
        ),
      );
    } else if (underscores > 2) {
      // The dangerous one. Show them what it would silently be read as.
      out.push(
        err(
          "stacName",
          "underscore-count",
          `Needs exactly 2 underscores (YYYYMM_Hazard_Location) — found ${underscores}. ` +
            `"${v}" would be read as hazard "${parts[1]}", location "${parts.slice(2).join("_")}". ` +
            `Run multi-word names together in CamelCase, e.g. ${STAC_EXAMPLE} or 202604_TropicalCyclone_Guam.`,
        ),
      );
    } else if (!/^[0-9]{6}$/.test(parts[0])) {
      out.push(err("stacName", "yearmonth", `"${parts[0]}" must be a 6-digit YYYYMM, e.g. 202511.`));
    } else if (!/^(0[1-9]|1[0-2])$/.test(parts[0].slice(4))) {
      out.push(
        err("stacName", "month", `Month "${parts[0].slice(4)}" is not 01-12. Example: ${STAC_EXAMPLE}.`),
      );
    } else {
      out.push(err("stacName", "format", `Must be YYYYMM_Hazard_Location, e.g. ${STAC_EXAMPLE}.`));
    }
    return out;
  }

  const parsed = parseStacName(v)!;

  if (hazards.length > 0) {
    const known = hazards.some(
      (h) =>
        h.token.toLowerCase() === parsed.hazard.toLowerCase() ||
        h.aliases.some((a) => a.toLowerCase() === parsed.hazard.toLowerCase()),
    );
    if (!known) {
      out.push(
        warn(
          "stacName",
          "hazard-vocabulary",
          `Hazard token "${parsed.hazard}" is not in the controlled vocabulary. Known tokens: ${hazards
            .map((h) => h.token)
            .join(", ")}.`,
        ),
      );
    } else if (selected.length > 0) {
      const match = hazards.find(
        (h) =>
          h.token.toLowerCase() === parsed.hazard.toLowerCase() ||
          h.aliases.some((a) => a.toLowerCase() === parsed.hazard.toLowerCase()),
      );
      if (match && !selected.includes(match.id)) {
        out.push(
          warn(
            "stacName",
            "hazard-mismatch",
            `Event name says "${parsed.hazard}" but that hazard is not selected below.`,
          ),
        );
      }
    }
  }

  return out;
}

/** ISO shape + ordering. Upstream only checks shape; start<=end is our own catalog invariant. */
export function checkDates(start: string, end: string): Violation[] {
  const out: Violation[] = [];
  if (!start) out.push(err("start", "required", "Start date is required."));
  else if (!ISO_DATE_RE.test(start))
    out.push(err("start", "format", `Start date "${start}" must be YYYY-MM-DD.`));

  if (!end) out.push(err("end", "required", "End date is required."));
  else if (!ISO_DATE_RE.test(end)) out.push(err("end", "format", `End date "${end}" must be YYYY-MM-DD.`));

  if (start && end && ISO_DATE_RE.test(start) && ISO_DATE_RE.test(end) && start > end) {
    out.push(err("end", "order", `End date ${end} is before start date ${start}.`));
  }
  return out;
}

/** dps/_validate.sh:118-143 — validate_bbox(), rule for rule. Empty is allowed (bbox is optional). */
export function checkBbox(value: string): Violation[] {
  const v = value.trim();
  if (!v) return [];
  const parts = v.split(/[,\s]+/).filter(Boolean);
  if (parts.length !== 4) {
    return [
      err("bbox", "count", `Bounding box needs exactly 4 numbers "min_lon,min_lat,max_lon,max_lat"; got ${parts.length}.`),
    ];
  }
  if (!parts.every((p) => /^[-+]?[0-9]*\.?[0-9]+$/.test(p))) {
    return [err("bbox", "numeric", `Bounding box must be four numbers "min_lon,min_lat,max_lon,max_lat" (WGS84).`)];
  }
  const [minLon, minLat, maxLon, maxLat] = parts.map(Number);
  const out: Violation[] = [];
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    out.push(err("bbox", "range", "Bounding box is out of range (lon in [-180,180], lat in [-90,90])."));
    return out;
  }
  if (minLon >= maxLon || minLat >= maxLat) {
    out.push(err("bbox", "order", "Bounding box needs min_lon<max_lon and min_lat<max_lat."));
    return out;
  }
  if (maxLat - minLat < BBOX_MIN_LAT_SPAN) {
    out.push(
      err(
        "bbox",
        "lat-span",
        `Bounding box latitude span is < ${BBOX_MIN_LAT_SPAN}°; widen it (Black Marble needs a taller box).`,
      ),
    );
  }
  return out;
}

/**
 * Sentinel-2 MGRS tile, e.g. T17RLN — the shape sentinel2's `tile` input takes.
 * Landsat WRS-2 path/row, e.g. 171035 — 6 digits, the shape landsat's `process_tile` takes.
 * Both are OPTIONAL; only a non-empty, malformed value is an error.
 */
export const MGRS_TILE_RE = /^T[0-9]{2}[A-Z]{3}$/;
export const WRS2_TILE_RE = /^[0-9]{6}$/;

/** Split a space/comma-separated tile field into tokens. */
export const splitTiles = (v: string): string[] => v.trim().split(/[\s,]+/).filter(Boolean);

export function checkTiles(mgrs: string, wrs2: string): Violation[] {
  const out: Violation[] = [];
  for (const t of splitTiles(mgrs)) {
    if (!MGRS_TILE_RE.test(t)) {
      out.push(
        err(
          "mgrsTiles",
          "mgrs-format",
          `"${t}" is not an MGRS tile. Expected T + 2 digits + 3 letters, e.g. T17RLN. Separate several with spaces.`,
        ),
      );
    }
  }
  for (const t of splitTiles(wrs2)) {
    if (!WRS2_TILE_RE.test(t)) {
      out.push(
        err(
          "wrs2Tiles",
          "wrs2-format",
          `"${t}" is not a WRS-2 path/row. Expected exactly 6 digits (3-digit path + 3-digit row), e.g. 171035.`,
        ),
      );
    }
  }
  return out;
}

export function checkHazards(selected: string[], vocabulary: Hazard[]): Violation[] {
  const out: Violation[] = [];
  if (selected.length === 0) {
    out.push(err("hazards", "required", "Select at least one hazard type."));
    return out;
  }
  const ids = new Set(vocabulary.map((h) => h.id));
  for (const h of selected) {
    if (!ids.has(h)) out.push(err("hazards", "vocabulary", `"${h}" is not a known hazard type.`));
    if (h.includes("_")) out.push(err("hazards", "underscore", `Hazard "${h}" must not contain an underscore.`));
  }
  return out;
}

export function checkLocations(locations: string[]): Violation[] {
  const clean = locations.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0) {
    return [err("locations", "required", "Add at least one location, e.g. Los Angeles, CA.")];
  }
  return [];
}

export function checkName(name: string): Violation[] {
  if (!name.trim()) {
    return [
      err(
        "name",
        "required",
        "Activation event name is required — this is the human-readable name shown on the website, e.g. California Wildfires January 2025.",
      ),
    ];
  }
  return [];
}

export function checkProducts(products: { algorithm: string; product: string }[]): Violation[] {
  if (products.length === 0) {
    return [err("products", "required", "Select at least one product to generate.")];
  }
  return [];
}

// ---------------------------------------------------------------------------------------------
// Whole-request validation — what gates the "Open PR" button
// ---------------------------------------------------------------------------------------------

export interface RequestShape {
  name: string;
  stacName: string;
  start: string;
  end: string;
  hazards: string[];
  locations: string[];
  bbox: string;
  mgrsTiles: string;
  wrs2Tiles: string;
  products: { algorithm: string; product: string }[];
}

export function validateRequest(r: RequestShape, vocabulary: Hazard[]): Violation[] {
  return [
    ...checkName(r.name),
    ...checkStacName(r.stacName, vocabulary, r.hazards),
    ...checkDates(r.start, r.end),
    ...checkHazards(r.hazards, vocabulary),
    ...checkLocations(r.locations),
    ...checkBbox(r.bbox),
    ...checkTiles(r.mgrsTiles, r.wrs2Tiles),
    ...checkProducts(r.products),
  ];
}

export const errorsOnly = (v: Violation[]): Violation[] => v.filter((x) => x.severity === "error");

/** The gate. Warnings never block — only errors do. */
export const isSubmittable = (v: Violation[]): boolean => errorsOnly(v).length === 0;

/** Violations for one field, for rendering inline under the input. */
export const forField = (v: Violation[], field: string): Violation[] => v.filter((x) => x.field === field);
