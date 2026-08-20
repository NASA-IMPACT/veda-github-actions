import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Primary "type" facet. Add new types here as the catalog grows — anything not in this
// list will FAIL the build, which keeps the facet clean.
//
// v1 only uses 'Web app' and 'Reference'. 'GitHub Action' and 'Generator' are declared ahead
// of use so the three composite actions (action.yml, pr-finder/, leave/) and the generator
// tooling (aws-pricing/, seed/) can be catalogued later without a schema change. Unused types
// cost nothing in the UI — CatalogGrid derives its facet chips from the entries present, not
// from this list.
export const ENTRY_TYPES = [
  "Web app",
  "Reference",
  "GitHub Action",
  "Generator",
] as const;

export type EntryType = (typeof ENTRY_TYPES)[number];

// One stable hue per type, in one place. Both the card badge (TypeBadge.astro) and the Type
// filter chips (CatalogGrid.astro) read this, so a filter chip is always the same colour as the
// badge it selects — that colour link is what makes the Type facet readable at a glance.
export const TYPE_HUES: Record<EntryType, number> = {
  "Web app": 210, // blue
  Reference: 258, // violet
  "GitHub Action": 168, // teal
  Generator: 45, // gold
};

const catalog = defineCollection({
  loader: glob({ base: "./src/content/catalog", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(280), // card blurb
    type: z.enum(ENTRY_TYPES), // primary facet
    tags: z.array(z.string()).default([]), // secondary facets

    // REQUIRED, like `limitations`: the problem this thing removes, in one sentence. Shown on the
    // grid card AND as a callout on the detail page; richer treatment (diagrams, animations) lives
    // in a `## What it solves` section in the MDX body.
    //
    // A catalog whose entries only say what they *are* makes the reader do the work of figuring out
    // why they'd care. Gating this at build time is what stops that drifting back in.
    solves: z.string().min(1).max(200),

    // REQUIRED: every entry must acknowledge at least one limitation or risk.
    // .min(1) makes an empty/missing list FAIL `astro build` (and CI) — this is how
    // "must acknowledge >=1 limitation/risk" is enforced, not a review convention.
    limitations: z.array(z.string().min(1)).min(1),

    repo: z.string().url(), // where the thing actually lives (required)
    homepage: z.string().url().optional(), // live site, if any

    // Optional "Developer's suggestion" — a tip on making the tool your own, with an
    // optional shell snippet.
    devSuggestion: z
      .object({
        text: z.string(),
        alias: z.string().optional(),
      })
      .optional(),

    // NOTE: no `video` field. odsi-app-catalog has one (plus a VideoEmbed component with a
    // click-to-load facade); nothing here uses a demo video yet, so shipping the field and the
    // component would be unexercised dead code. Port both from odsi-app-catalog when the first
    // real demo clip lands.

    author: z.string().default("NASA VEDA"),
    dateAdded: z.coerce.date(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false), // excluded from the built listing
  }),
});

export const collections = { catalog };
