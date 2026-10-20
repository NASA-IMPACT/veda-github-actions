// The event's public page (science.data.nasa.gov/disasters/news-events-stories/<slug>) as data:
// one structured view that the in-app preview renders and the web team receives as Markdown or
// JSON. Nothing is pushed anywhere — the portal's CMS is theirs; this hands them finished text.
//
// Section order mirrors the live page: title + subtitle, the metadata block (Type / Need / Hazard /
// Region / Start Date / "Learn more"), Overview, then the Event Data Gallery.

import type { ActivationEvent, Algorithm, Hazard } from "./types";
import { algorithmById, productById } from "./data";
import { hazardLabel } from "./colors";
import { NEED_LABELS } from "./portal";

/** Just the parts of an event the page uses — so a draft in the Submit form can be previewed too. */
export type PageEvent = Pick<
  ActivationEvent,
  "name" | "stacName" | "start" | "end" | "hazards" | "locations" | "layers" | "externalLayers" | "page"
>;

export interface GalleryItem {
  title: string;
  /** False for a layer the event used that no algorithm in this catalog produces. */
  inCatalog: boolean;
  algorithm?: string;
  product?: string;
  modality?: string;
}

export interface PageView {
  title: string;
  subtitle: string;
  type: "Event";
  needs: string[];
  hazards: string[];
  region: string[];
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
  govLink: string;
  paragraphs: string[];
  stacName: string;
  gallery: GalleryItem[];
}

// The portal prints dates AP style: "Jan. 10, 2025", "June 3, 2026", "Sept. 9, 2024".
const AP_MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

export function portalDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${AP_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso;
}

export function pageView(ev: PageEvent, algorithms: Algorithm[], hazards: Hazard[]): PageView {
  const gallery: GalleryItem[] = ev.layers.map((l) => {
    const a = algorithmById(algorithms, l.algorithm);
    const p = productById(algorithms, l.algorithm, l.product);
    return a && p
      ? { title: `${a.title} ${p.label}`, inCatalog: true, algorithm: a.id, product: p.id, modality: a.modality }
      : { title: `${l.algorithm} ${l.product}`, inCatalog: false };
  });
  for (const x of ev.externalLayers) gallery.push({ title: x, inCatalog: false });

  return {
    title: ev.name,
    subtitle: ev.page?.subtitle ?? "",
    type: "Event",
    needs: (ev.page?.needs ?? []).map((n) => NEED_LABELS[n] ?? n),
    hazards: ev.hazards.map((h) => hazardLabel(h, hazards)),
    region: ev.page?.region?.trim() ? [ev.page.region.trim()] : ev.locations,
    startDate: ev.start,
    endDate: ev.end ?? "",
    govLink: ev.page?.govLink ?? "",
    paragraphs: (ev.page?.intro ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    stacName: ev.stacName,
    gallery,
  };
}

export function toMarkdown(v: PageView): string {
  const out = [`# ${v.title}`, ""];
  if (v.subtitle) out.push(`_${v.subtitle}_`, "");
  const meta = [
    ["Type", v.type],
    ["Need", v.needs.join(", ")],
    ["Hazard", v.hazards.join(", ")],
    ["Region", v.region.join("; ")],
    ["Start Date", portalDate(v.startDate)],
  ].filter(([, val]) => val);
  out.push(...meta.map(([k, val]) => `**${k}:** ${val}  `));
  if (v.govLink) out.push(`**What the U.S. government is doing:** [Learn more](${v.govLink})  `);
  out.push("", "## Overview", "");
  out.push(...(v.paragraphs.length ? v.paragraphs.flatMap((p) => [p, ""]) : ["_No intro written yet._", ""]));
  out.push("## Event Data Gallery", "");
  out.push(...v.gallery.map((g) => `- ${g.title}${g.inCatalog ? "" : " _(not produced by this catalog)_"}`));
  if (v.gallery.length === 0) out.push("_No layers recorded._");
  out.push("", `<!-- STAC event: ${v.stacName} -->`, "");
  return out.join("\n");
}

export function toJSON(v: PageView): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}
