// DATA colors — fixed literals, never derived from the theme.
//
// House rule (CLAUDE.md): "Only chrome adapts. Data colors stay fixed." A hazard color and a
// modality accent both CARRY MEANING (which hazard this is, what kind of sensor produced it), so
// they are hex values here rather than CSS custom properties. Everything structural — header,
// borders, body text — themes through the tokens in styles.css; nothing in this file does.

import type { Hazard, Modality } from "./types";

export interface ModalityStyle {
  /** Strong accent: card left border, badge background, legend swatch. */
  color: string;
  /** Soft wash: badge/chip background behind `ink`, thumbnail fallback block. */
  tint: string;
  /** Text color that stays legible on `tint`. */
  ink: string;
  label: string;
  icon: string;
}

/**
 * The four sensing modalities. Blue = optical (visible/reflective), purple = SAR (active
 * microwave, nothing like a photograph), amber-on-indigo = night lights (city glow against a night
 * sky), grey = utility (list_dates and friends: no imagery at all).
 */
export const MODALITY: Record<Modality, ModalityStyle> = {
  optical: { color: "#0076d6", tint: "#e1f0fb", ink: "#0b3d6b", label: "Optical", icon: "🛰️" },
  sar: { color: "#8544ba", tint: "#f1e7f9", ink: "#4b1f6f", label: "SAR", icon: "📡" },
  nightlights: { color: "#c2830a", tint: "#fbf1d6", ink: "#3f2a8c", label: "Night lights", icon: "🌃" },
  utility: { color: "#71767a", tint: "#f0f0f0", ink: "#3d4551", label: "Utility", icon: "🧰" },
};

export const MODALITY_ORDER: Modality[] = ["optical", "sar", "nightlights", "utility"];

const UNKNOWN_MODALITY: ModalityStyle = {
  color: "#71767a",
  tint: "#f0f0f0",
  ink: "#3d4551",
  label: "Unknown",
  icon: "❔",
};

/** Tolerant lookup: data is hand-maintained, so an unrecognized modality must not crash a card. */
export function modality(id: string): ModalityStyle {
  return MODALITY[id as Modality] ?? UNKNOWN_MODALITY;
}

// ---------------------------------------------------------------------------------------------
// Hazards
//
// Every hazard in data/hazards.json carries its own `color` and `icon` — that file is the
// controlled vocabulary and therefore the source of truth. These helpers only add the fallback
// for an id that is NOT in the vocabulary (a stale request file, a typo'd event), so an unknown
// hazard still renders as a stable, distinguishable chip instead of disappearing.
// ---------------------------------------------------------------------------------------------

const HAZARD_FALLBACK = [
  "#a63a1c", "#1a6b8a", "#4a6b1a", "#6b1a5c", "#1a3a6b",
  "#8a5a1a", "#2f6b52", "#6b2f2f", "#3f3f8a", "#5c5c1a",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function find(id: string, vocabulary: Hazard[]): Hazard | undefined {
  const needle = id.toLowerCase();
  return vocabulary.find(
    (h) => h.id.toLowerCase() === needle || h.aliases.some((a) => a.toLowerCase() === needle),
  );
}

export function hazardColor(id: string, vocabulary: Hazard[]): string {
  return find(id, vocabulary)?.color ?? HAZARD_FALLBACK[hash(id.trim().toLowerCase()) % HAZARD_FALLBACK.length];
}

export function hazardIcon(id: string, vocabulary: Hazard[]): string {
  return find(id, vocabulary)?.icon ?? "⚠️";
}

/** Falls back to the raw id so an off-vocabulary hazard is visible rather than silently blank. */
export function hazardLabel(id: string, vocabulary: Hazard[]): string {
  return find(id, vocabulary)?.label ?? id;
}
