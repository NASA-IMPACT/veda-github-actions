// Shared model for people being added in the "Add person" modal — used both to render an
// in-app PREVIEW (before any PR) and to build the prefilled-PR override file.
import type { Person, Status } from "./types";
import { toISO } from "./compute";

export interface DraftEntry {
  start: string;
  end: string; // blank -> single day
  status: Status | "available";
  note: string;
}
export interface Draft {
  mode: "existing" | "new";
  name: string;
  team: string;
  role: string;
  slug?: string; // set when an existing person is chosen (so the override merges onto them)
  entries: DraftEntry[];
}

export function newDraft(mode: "existing" | "new" = "existing"): Draft {
  return { mode, name: "", team: "", role: "", entries: [{ start: "", end: "", status: "planned_time_off", note: "" }] };
}

export function draftSlug(d: Draft): string {
  return d.slug || slugify(d.name);
}

export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

const OUT = new Set<Status>(["unavailable", "planned_time_off", "holiday"]);
export function statusMeta(s: Status): { out: boolean; weight: number } {
  if (OUT.has(s)) return { out: true, weight: 1 };
  if (s === "limited") return { out: false, weight: 0.5 };
  return { out: false, weight: 0 };
}

function expandDays(start: string, end: string, includeWeekends = false): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00");
  const e = new Date((end || start) + "T00:00:00");
  for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    if (includeWeekends || (d.getDay() !== 0 && d.getDay() !== 6)) out.push(toISO(d));
  }
  return out;
}

export function draftValid(d: Draft): boolean {
  return !!d.name.trim() && !!d.team.trim() && d.entries.some((e) => e.start);
}

// A draft -> a Person for the live calendar preview (source: "draft").
export function draftToPerson(d: Draft): Person {
  const leaves = [];
  for (const e of d.entries) {
    if (!e.start || e.status === "available") continue;
    const meta = statusMeta(e.status);
    for (const iso of expandDays(e.start, e.end)) {
      leaves.push({ date: iso, status: e.status as Status, out: meta.out, weight: meta.weight,
        note: e.note || null, source: "draft" });
    }
  }
  leaves.sort((a, b) => a.date.localeCompare(b.date));
  return { slug: draftSlug(d), name: d.name.trim(), team: d.team.trim(), role: d.role.trim(), leaves };
}

// One draft -> the override JSON object the generator understands.
export function draftToOverride(d: Draft, pi: string) {
  const entries = d.entries
    .filter((e) => e.start)
    .map((e) => {
      const o: Record<string, string> = { status: e.status };
      if (e.end && e.end !== e.start) {
        o.start = e.start;
        o.end = e.end;
      } else {
        o.date = e.start;
      }
      if (e.note) o.note = e.note;
      return o;
    });
  return { person: d.name.trim(), slug: draftSlug(d), team: d.team.trim(), role: d.role.trim(), pi, entries };
}

// The override FILE for a batch: a single object for one person, else an array — so all the
// people added in one sitting land in ONE file = ONE pull request.
export function buildOverrideFile(drafts: Draft[], pi: string): { filename: string; json: string } {
  const valid = drafts.filter(draftValid);
  const docs = valid.map((d) => draftToOverride(d, pi));
  const first = valid[0] ? draftSlug(valid[0]) : "person";
  const filename =
    docs.length <= 1
      ? `leave/overrides/${first}.json`
      : `leave/overrides/${first}-plus-${docs.length - 1}.json`;
  const body = docs.length === 1 ? docs[0] : docs;
  return { filename, json: JSON.stringify(body, null, 2) };
}
