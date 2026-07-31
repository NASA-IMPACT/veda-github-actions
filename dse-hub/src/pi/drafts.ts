// Draft model for the "Add PI" modal — builds the prefilled-PR file. Mirrors meetings/drafts.ts.
import type { Pi, Sprint } from "../types";

export interface SprintDraft {
  index: number;
  name: string;
  start: string;
  end: string;
  goal: string;
}

export interface PiDraft {
  name: string;
  goal: string;
  boardUrl: string;
  sprints: SprintDraft[];
}

export function newSprintDraft(index: number): SprintDraft {
  return { index, name: "", start: "", end: "", goal: "" };
}

export function newPiDraft(): PiDraft {
  return { name: "", goal: "", boardUrl: "", sprints: [newSprintDraft(1)] };
}

export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "pi";
}

export function piDraftValid(d: PiDraft): boolean {
  return !!d.name.trim() && d.sprints.some((s) => s.start && s.end);
}

export function draftToPi(d: PiDraft): Pi {
  const sprints: Sprint[] = d.sprints
    .filter((s) => s.start && s.end)
    .map((s) => {
      const sp: Sprint = { index: s.index, start: s.start, end: s.end };
      if (s.name.trim()) sp.name = s.name.trim();
      if (s.goal.trim()) sp.goal = s.goal.trim();
      return sp;
    });
  const pi: Pi = { id: slugify(d.name), name: d.name.trim(), tz: "America/Chicago", sprints };
  if (d.goal.trim()) pi.goal = d.goal.trim();
  if (d.boardUrl.trim()) pi.boardUrl = d.boardUrl.trim();
  return pi;
}

export function buildPiFile(d: PiDraft, overrideId?: string): { filename: string; json: string } {
  const pi = draftToPi(d);
  if (overrideId) pi.id = overrideId; // keep an existing PI's id/filename when editing
  return { filename: `dse-hub/data/pis/${pi.id}.json`, json: JSON.stringify(pi, null, 2) };
}

// Prefill the edit form from an existing PI (so you can add/edit/remove its sprints).
export function piToDraft(pi: Pi): PiDraft {
  return {
    name: pi.name,
    goal: pi.goal ?? "",
    boardUrl: pi.boardUrl ?? "",
    sprints: pi.sprints.map((s) => ({
      index: s.index,
      name: s.name ?? "",
      start: s.start,
      end: s.end,
      goal: s.goal ?? "",
    })),
  };
}
