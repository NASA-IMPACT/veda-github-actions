// Per-person colors (deterministic from the slug so a person keeps their color across sessions
// and subset changes) + status labels/colors for the category legend.
import type { Status } from "./types";

// A qualitative palette that deliberately avoids the status red/yellow hues so person bars
// aren't confused with the status legend. Assigned by a stable hash of the slug.
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

export function personColor(slug: string): string {
  return PALETTE[hash(slug) % PALETTE.length];
}

export const STATUS_LABEL: Record<Status, string> = {
  unavailable: "Unavailable",
  planned_time_off: "Planned Time Off",
  holiday: "Holiday",
  limited: "Limited",
  work_travel: "Work Travel",
  wfh: "WFH",
  other: "Other",
};

// Legend swatch colors for statuses (readable web colors, not the raw workbook ARGB).
export const STATUS_COLOR: Record<Status, string> = {
  unavailable: "#e05353",
  planned_time_off: "#b48ad6",
  holiday: "#e0a08f",
  limited: "#e6c34a",
  work_travel: "#d9b44a",
  wfh: "#7bb37b",
  other: "#8ab0e6",
};

// Order statuses for legends/filters (out first).
export const STATUS_ORDER: Status[] = [
  "unavailable",
  "planned_time_off",
  "holiday",
  "limited",
  "work_travel",
  "wfh",
  "other",
];
