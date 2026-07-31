// The PI roadmap: pis committed to data/pis.json, bundled at BUILD time. Change-override files
// under data/changes/*.json are merged at load so staged PI edits are reflected after a build.
import type { Pi, PiCalendar } from "../types";
import pisRaw from "../../data/pis.json";
import { allChangeDocs } from "../changesData";

function firstStart(p: Pi): string {
  return p.sprints.reduce(
    (min, s) => (s.start < min ? s.start : min),
    p.sprints[0]?.start ?? "9999-99-99",
  );
}

export function loadPis(): Pi[] {
  const map = new Map<string, Pi>();
  for (const p of pisRaw as Pi[]) {
    if (p && p.id && p.name && Array.isArray(p.sprints)) map.set(p.id, p);
  }
  for (const d of allChangeDocs()) {
    if (d.kind === "pi" && d.op === "upsert") {
      const p = d.data as Pi;
      if (p && p.id) map.set(p.id, p);
    }
  }
  return [...map.values()].sort((a, b) => firstStart(a).localeCompare(firstStart(b)));
}

export const pis: Pi[] = loadPis();

export const piCalendar: PiCalendar = {
  tz: pis[0]?.tz,
  sprints: pis.flatMap((p) => p.sprints).sort((a, b) => a.start.localeCompare(b.start)),
};
