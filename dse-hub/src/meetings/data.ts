// GitHub-only datastore: meetings are committed to data/meetings.json, bundled at BUILD time
// (no runtime fetch, no CDN staleness). Change-override files under data/changes/*.json are merged
// at load time so staged edits are reflected immediately after a build.
import type { Meeting } from "../types";
import meetingsRaw from "../../data/meetings.json";
import { allChangeDocs } from "../changesData";

export function loadMeetings(): Meeting[] {
  const map = new Map<string, Meeting>();
  for (const m of meetingsRaw as Meeting[]) {
    if (m && m.id && m.name && m.team) map.set(m.id, m);
  }
  for (const d of allChangeDocs()) {
    if (d.kind === "meeting" && d.op === "upsert") {
      const m = d.data as Meeting;
      if (m && m.id) map.set(m.id, m);
    }
  }
  return [...map.values()].sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
}

// Re-exported from the PI loader so meeting code keeps its import path unchanged.
export { piCalendar } from "../pi/data";

export function allTeams(meetings: Meeting[]): string[] {
  return [...new Set(meetings.map((m) => m.team))].sort((a, b) => a.localeCompare(b));
}
