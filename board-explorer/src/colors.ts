// DATA colors — meaning-bearing, so they are fixed literals rather than theme tokens.
//
// House rule (CLAUDE.md / docs/DECISIONS.md): "Only chrome adapts. Data colors stay fixed."
// A label's hex and a Status option's colour identify *which* label and *which* column, so the
// HUE is never allowed to move between themes.
//
// The nuance this app adds: a raw GitHub label hex is frequently illegible on the opposite
// background (#0e8a16 on near-black, #fbca04 on white). So the hue is held fixed while only the
// LIGHTNESS adapts, by mixing toward the theme's own ink — one `color-mix` expression that
// darkens in light mode and lightens in dark mode without ever changing which colour it is.
// Same move leave-dashboard's RiskView already makes with `color-mix(… var(--red) …)`.

import type { CSSProperties } from "react";
import type { OptionColor } from "./types";

// A qualitative palette for people. Deliberately avoids the state red/green/amber hues so an
// assignee swatch is never mistaken for an open/closed/blocked signal.
const PALETTE = [
  "#4e79a7", "#59a14f", "#b07aa1", "#76b7b2", "#9c755f",
  "#5b8ff9", "#61a5c2", "#8cb369", "#6d597a", "#3d7ea6",
  "#7d8f69", "#a0709a", "#4c9f9c", "#5a7684", "#7768ae",
  "#4b8b3b", "#8e7dbe", "#3f7d78", "#96729b", "#5f8caa",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic from the login, so a person keeps their colour across sessions and filters. */
export function personColor(login: string): string {
  return PALETTE[hash(login.trim().toLowerCase()) % PALETTE.length];
}

/** GitHub's single-select colour enum -> the hex GitHub itself renders it as. */
const OPTION_HEX: Record<OptionColor, string> = {
  GRAY: "#6e7781",
  BLUE: "#0969da",
  GREEN: "#1a7f37",
  YELLOW: "#9a6700",
  ORANGE: "#bc4c00",
  RED: "#cf222e",
  PINK: "#bf3989",
  PURPLE: "#8250df",
};

export function optionHex(color: string | undefined): string {
  return OPTION_HEX[(color || "GRAY") as OptionColor] ?? OPTION_HEX.GRAY;
}

/** `#` is optional on the way in; GitHub's API omits it, our own literals include it. */
function withHash(hex: string): string {
  const v = (hex || "").trim();
  return v.startsWith("#") ? v : `#${v || "888888"}`;
}

/**
 * Chip styling that keeps a data colour's hue in both themes.
 * - background: a wash of the colour, so the chip reads as that colour at a glance
 * - border:     the same colour, stronger, so adjacent chips stay separable
 * - text:       the colour pulled toward the theme's ink until it is legible on the wash
 */
export function chipStyle(hex: string): CSSProperties {
  const c = withHash(hex);
  return {
    background: `color-mix(in srgb, ${c} 18%, transparent)`,
    borderColor: `color-mix(in srgb, ${c} 45%, transparent)`,
    color: `color-mix(in srgb, ${c} 65%, var(--ink))`,
  };
}

/** State pill colours. These are chrome-adjacent but carry meaning, so they are fixed too. */
export const STATE_HEX: Record<string, string> = {
  open: "#1a7f37",
  closed: "#8250df",
  merged: "#8250df",
  draft: "#6e7781",
};

export const KIND_ICON: Record<string, string> = {
  issue: "◉",
  pr: "⑂",
  draft: "▤",
};
