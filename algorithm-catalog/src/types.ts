// The data contract for the Algorithm Catalog.
//
// Two canonical datasets, both committed JSON bundled at build time:
//   data/algorithms.json — the reusable catalog (what we can run)
//   data/events.json     — past activation events (what we did run, and when/where)
// plus data/hazards.json, the controlled hazard vocabulary this app DEFINES (the upstream
// disasters-product-algorithms repo has none — hazard is a free-text token in slot 2 of the
// activation_event string, which is exactly why Fire/Wildfire and Quake/Earthquake both exist
// in the wild today).
//
// Submissions land as data/requests/<ts>-<slug>.json and are overlaid at load time.

/** Sensing modality — drives the modality filter and the card accent color. */
export type Modality = "optical" | "sar" | "nightlights" | "utility";

/**
 * Whether the algorithm is actually registered and runnable.
 * - production: a real dps/<name>/algorithm_config.yaml exists on dev
 * - prototype:  code exists in src/ but there is no DPS algorithm (e.g. iceye)
 */
export type AlgorithmStatus = "production" | "prototype";

/**
 * How the algorithm is pointed at a place. These are mutually incompatible across algorithms —
 * there is no unified AOI input upstream, which is why AOI cannot narrow the catalog.
 */
export type SpatialSelector =
  | "bbox" // WGS84 "min_lon,min_lat,max_lon,max_lat" (blackmarble)
  | "mgrs-tile" // Sentinel-2 MGRS tile IDs
  | "wrs2-pathrow" // Landsat WRS-2 path/row, NNNNNN
  | "vendor-scene" // implicit: the AOI is whatever the vendor scene covers; select by date
  | "granule-file" // operator supplies a .tar/.zip granule
  | "none";

/** A DPS job input, mirrored from the algorithm's algorithm_config.yaml `inputs` list. */
export interface AlgorithmInput {
  name: string;
  label: string;
  type: string; // string | int | float | boolean | File | Directory
  required: boolean; // true when the upstream YAML declares no default
  doc?: string;
  default?: string;
}

/**
 * One product (a "layer") an algorithm can generate. `id` is the token the upstream CLI accepts
 * (e.g. `swir`), `folder` is the output subdirectory it writes to (e.g. `shortwaveInfrared`).
 * `hazards` is the hand-built suitability mapping — no upstream source defines it.
 */
export interface Product {
  id: string;
  label: string;
  folder: string;
  /**
   * Every hazard this product COULD be useful for. Broad on purpose — this drives discovery
   * (the Algorithms tab hazard filter), where a false negative is worse than a false positive.
   */
  hazards: string[]; // hazard ids from data/hazards.json
  /**
   * The hazards for which this is a product you'd ORDER FIRST — always a subset of `hazards`.
   * This is what the Submit form auto-selects from. Kept deliberately sparse: selecting "Fire"
   * should propose ~7 products, not all 21 that merely mention fire. The user can always add
   * more by hand, so under-selecting is the safe default.
   */
  primaryHazards: string[];
  note?: string;
}

export interface Algorithm {
  id: string; // catalog key, e.g. "sentinel2" — matches the dps/<dir> name
  algorithmName: string; // registered DPS name, e.g. "disasters-sentinel2-process"
  version: string; // the git ref DPS clones, e.g. "dev"
  title: string; // display name, e.g. "Sentinel-2"
  modality: Modality;
  status: AlgorithmStatus;
  vendor: string;
  resolution: string;
  /** First date data exists. Two are enforced upstream; the rest are mission-launch dates. */
  temporalStart: string; // "YYYY-MM-DD"
  temporalStartApprox: boolean;
  spatialSelector: SpatialSelector;
  resources: { ramMin: number; coresMin: number; outdirMax: number };
  thumb: string; // "/thumbs/<id>.png"
  thumbCredit: string;
  configUrl: string;
  description: string;
  keywords: string[];
  products: Product[];
  inputs: AlgorithmInput[];
}

/** A layer an event required that maps onto a real catalog algorithm + product. */
export interface EventLayer {
  algorithm: string; // Algorithm["id"]
  product: string; // Product["id"]
}

export interface ActivationEvent {
  id: string; // == stacName
  name: string; // human-readable, visible on the website
  stacName: string; // YYYYMM_Hazard_Location
  start: string; // "YYYY-MM-DD"
  end: string; // "YYYY-MM-DD"
  hazards: string[]; // hazard ids
  locations: string[];
  bbox?: string;
  layers: EventLayer[];
  /** Layers the event required that have NO algorithm in this catalog — shown greyed out. */
  externalLayers: string[];
}

/**
 * The controlled hazard vocabulary. `token` is what goes in slot 2 of a STAC event name and
 * MUST NOT contain an underscore (upstream _validate.sh matches slot 2 with `[^_]+`), so
 * multi-word hazards are CamelCase in the token and spaced in the label.
 */
export interface Hazard {
  id: string;
  label: string;
  token: string;
  color: string;
  icon: string;
  /** Other tokens seen in the wild that mean this hazard (Wildfire -> Fire, Quake -> Earthquake). */
  aliases: string[];
}

/** Where a product on a request came from: hazard auto-selection, or the user adding it by hand. */
export type ProductOrigin = "hazard" | "manual";

export interface RequestProduct {
  algorithm: string;
  product: string;
  via: ProductOrigin;
}

/** One submission — written to data/requests/<ts>-<slug>.json and opened as a prefilled PR. */
export interface AlgorithmRequest {
  kind: "algorithm-request";
  id: string;
  ts: string; // ISO
  event: {
    name: string;
    stacName: string;
    start: string;
    end: string;
    hazards: string[];
    locations: string[];
    bbox?: string;
    /**
     * Optional scene selectors, for when the requester already knows exactly which tiles they
     * need instead of describing a place. These map straight onto the real algorithm inputs:
     * `mgrs` -> sentinel2's `tile`, `wrs2` -> landsat's `process_tile`.
     */
    tiles?: { mgrs?: string[]; wrs2?: string[] };
  };
  products: RequestProduct[];
  requester?: string;
  notes?: string;
}
