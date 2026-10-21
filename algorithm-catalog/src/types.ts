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
//
// An event ALSO carries the text of its public page on science.data.nasa.gov (`page`), so one
// record covers both the website and the algorithm layers — that page used to be written from a
// spreadsheet kept by hand. See docs/ALGORITHM_CATALOG.md "Event pages".

/**
 * Sensing modality — drives the modality filter and the card accent color. "model" is a modeled or
 * multi-sensor merged dataset that is neither one optical nor one SAR sensor (GAIA building
 * exposure, GPM IMERG precipitation).
 */
export type Modality = "optical" | "sar" | "nightlights" | "model" | "utility";

/**
 * Whether the algorithm is actually registered and runnable.
 * - production: a real dps/<name>/algorithm_config.yaml exists on dev
 * - prototype:  code exists in src/ but there is no DPS algorithm (e.g. iceye)
 * - external:   no algorithm here yet. The product is made OUTSIDE this catalog and published on
 *               the Disasters Portal data gallery (OPERA, UAVSAR, Planet…). It is listed so a
 *               request can ask for it and the event page can link its card. No DPS job is ever
 *               created, and it is never auto-selected by a hazard.
 */
export type AlgorithmStatus = "production" | "prototype" | "external";

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
  /**
   * The Disasters Portal data-gallery card for this product, e.g. "DATA__SENTINEL_2_TRUE_COLOR"
   * (app/site-config/data/data__sentinel-2-true-color.ts). None = no card on the portal yet.
   */
  portalData?: string;
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

/**
 * The website's "Need" facet, as the portal's own THEME ids (disasters-portal
 * app/site-config/types.ts `Theme`) — "resilience" is displayed "Build Resilience".
 */
export type Need = "prepare" | "respond" | "recover" | "resilience";

/**
 * The public event page's own text — everything on it that is NOT already event data. Title,
 * hazard, region and start date come from the event itself; the data gallery from its layers.
 */
/**
 * The page's one optional image, shown right after the intro text (as on the Venezuela and Typhoon
 * Sinlaku pages), given as a Google Drive link — the team's images live in Drive. Downloaded into
 * the portal repo when the portal PR is opened (scripts/portal_pr.mjs). The masthead is never set
 * here: every event page uses the portal's default masthead image.
 */
export interface PageImage {
  url: string;
  alt: string;
  caption?: string;
}

export interface EventPage {
  subtitle?: string;
  /** Overview narrative. Plain text; a blank line separates paragraphs. */
  intro?: string;
  /** The "What the U.S. government is doing — Learn more" link. https only. */
  govLink?: string;
  needs: Need[];
  image?: PageImage;
  /** The page's sidebar "Region", e.g. "Los Angeles County, North America". Defaults to the locations. */
  region?: string;
  /**
   * The page's id on the Disasters Portal — its URL slug and its file
   * app/site-config/event/event__<portalId>.ts, e.g. "southern-california-fire-jan-2025".
   */
  portalId?: string;
}

export interface ActivationEvent {
  id: string; // == stacName
  name: string; // human-readable, visible on the website
  stacName: string; // YYYYMM_Hazard_Location
  start: string; // "YYYY-MM-DD"
  /** "YYYY-MM-DD", or absent while the event is ongoing. */
  end?: string;
  hazards: string[]; // hazard ids
  /**
   * Display strings, shown as the page's "Region". The first `places.length` of them are the
   * gazetteer labels of `places`, IN ORDER; anything after is free text (src/request/drafts.ts).
   */
  locations: string[];
  /** Gazetteer ids (data/places*.json) at whatever level of interest: "US-AL" or "US-AL-c51000". */
  places?: string[];
  bbox?: string;
  layers: EventLayer[];
  /** Layers the event required that have NO algorithm in this catalog — shown greyed out. */
  externalLayers: string[];
  page?: EventPage;
}

/**
 * One gazetteer entry. Ids are hierarchical, so a parent is a prefix of its children:
 * "US" > "US-AL" > "US-AL-101" (county) and "US-AL-c51000" (city — parent is the state).
 */
export type PlaceLevel = "country" | "state" | "county" | "city";

export interface Place {
  id: string;
  name: string;
  level: PlaceLevel;
  /** The display string, e.g. "Montgomery, Alabama". */
  label: string;
  bbox: [number, number, number, number]; // west, south, east, north
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
  /** The Disasters Portal category this files under (its CONTENT_CATEGORIES). None = no category. */
  portal?: string;
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
    end?: string; // absent = ongoing
    hazards: string[];
    locations: string[];
    places?: string[];
    bbox?: string;
    /**
     * Optional scene selectors, for when the requester already knows exactly which tiles they
     * need instead of describing a place. These map straight onto the real algorithm inputs:
     * `mgrs` -> sentinel2's `tile`, `wrs2` -> landsat's `process_tile`.
     */
    tiles?: { mgrs?: string[]; wrs2?: string[] };
  };
  products: RequestProduct[];
  page?: EventPage;
  requester?: string;
  notes?: string;
}
