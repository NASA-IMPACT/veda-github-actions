// Shareable view state <-> URL hash, so "Copy link" restores the exact filtered view.
import type { MonthKey } from "./compute";
import type { Status } from "./types";
import { STATUS_ORDER } from "./colors";

export interface DecodedView {
  view?: "calendar" | "risk";
  month?: MonthKey;
  risk?: number;
  people?: string[];
  teams?: string[];
  statuses?: Status[];
}

export function decodeHash(hash: string): DecodedView {
  const s = hash.replace(/^#/, "");
  if (!s) return {};
  const p = new URLSearchParams(s);
  const out: DecodedView = {};
  const v = p.get("view");
  if (v === "calendar" || v === "risk") out.view = v;
  const m = p.get("month");
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const [y, mo] = m.split("-").map(Number);
    out.month = { year: y, month: mo - 1 };
  }
  const r = p.get("risk");
  if (r != null && !Number.isNaN(Number(r))) out.risk = Math.min(1, Math.max(0, Number(r)));
  const ppl = p.get("people");
  if (ppl) out.people = ppl.split(",").filter(Boolean);
  const tm = p.get("teams");
  if (tm) out.teams = tm.split(",").filter(Boolean);
  const st = p.get("statuses");
  if (st) out.statuses = st.split(",").filter((x) => (STATUS_ORDER as string[]).includes(x)) as Status[];
  return out;
}

interface EncodeArgs {
  view: "calendar" | "risk";
  month: MonthKey;
  risk: number;
  people: string[] | null; // null = all (omit)
  teams: string[] | null;
  statuses: Status[] | null;
}

export function encodeHash(a: EncodeArgs): string {
  const p = new URLSearchParams();
  if (a.view !== "calendar") p.set("view", a.view);
  p.set("month", `${a.month.year}-${String(a.month.month + 1).padStart(2, "0")}`);
  p.set("risk", String(a.risk));
  if (a.people && a.people.length) p.set("people", a.people.join(","));
  if (a.teams && a.teams.length) p.set("teams", a.teams.join(","));
  if (a.statuses && a.statuses.length) p.set("statuses", a.statuses.join(","));
  const s = p.toString();
  return s ? "#" + s : "";
}
