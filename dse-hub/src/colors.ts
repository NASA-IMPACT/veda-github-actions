// Team colors (deterministic from the team name so a team keeps its color across sessions),
// plus join-method labels/icons. The USWDS palette itself lives as CSS variables in styles.css.
import type { JoinMethod } from "./types";

// A qualitative palette (USWDS-ish hues) for team accents on cards and calendar chips.
const PALETTE = [
  "#005ea2", "#e52207", "#00a91c", "#4866ff", "#e66f0e",
  "#9355dc", "#008480", "#c05600", "#0076d6", "#5c1349",
  "#6f3331", "#2d7735", "#3f57a6", "#ab2165", "#4d8055",
  "#7e4c00", "#5e517a", "#0081a1", "#864381", "#1b7f79",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function teamColor(team: string): string {
  return PALETTE[hash(team.trim().toLowerCase()) % PALETTE.length];
}

// Sprint bands for the calendar / roadmap. `sprintBand` is a soft cell background; `sprintAccent`
// is a strong color for the left border / label chip / timeline dot. Keyed by PI id + sprint index
// so adjacent sprints read as distinct bands and a sprint keeps its color across views.
const SPRINT_BANDS = [
  "#eaf2fb", "#eef6ec", "#f6eef6", "#fbf2e9", "#eef1fb",
  "#e9f4f3", "#f8eef0", "#f0eef8",
];

export function sprintBand(piId: string, index: number): string {
  return SPRINT_BANDS[hash(`${piId}#${index}`) % SPRINT_BANDS.length];
}

export function sprintAccent(piId: string, index: number): string {
  return teamColor(`${piId}#sprint#${index}`);
}

export const JOIN_LABEL: Record<JoinMethod, string> = {
  google_meet: "Google Meet",
  teams: "Microsoft Teams",
  in_person: "In person",
  hybrid: "Hybrid",
  other: "Other",
};

export const JOIN_ICON: Record<JoinMethod, string> = {
  google_meet: "📹",
  teams: "💬",
  in_person: "🏢",
  hybrid: "🔀",
  other: "🔗",
};

export const JOIN_ORDER: JoinMethod[] = ["google_meet", "teams", "in_person", "hybrid", "other"];
