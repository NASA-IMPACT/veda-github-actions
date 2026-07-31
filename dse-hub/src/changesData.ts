import type { Meeting, Pi } from "./types";

export interface ChangeDoc {
  kind: "meeting" | "pi";
  op: "upsert";
  ts: string;
  data: Meeting | Pi;
  label: string;
}

const mods = import.meta.glob<{ default: ChangeDoc[] }>("../data/changes/*.json", { eager: true });

export function allChangeDocs(): ChangeDoc[] {
  const out: ChangeDoc[] = [];
  for (const p in mods) {
    const a = mods[p]?.default;
    if (Array.isArray(a)) out.push(...a);
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts)); // oldest→newest so newest wins on upsert
}
