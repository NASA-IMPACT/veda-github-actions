// Multi-PI trend + alert computation for the Trends tab. Reuses the per-PI aggregations in
// compute.ts (keyed by ${pi}||${person} / ${pi}||${role}) — this just groups them by PI.
import { computePersonAggs, computeRoleAggs, ROLE_ORDER, round2 } from "./compute";
import type { Allocation } from "./types";

/** Utilization thresholds for the capacity alert (fraction of team capacity). */
export const UTIL_AMBER = 0.8;
export const UTIL_RED = 1.0;

export interface PiTrend {
  pi: string;
  demand: number; // Σ raw FTE this PI
  capacity: number; // team size × 1.0
  utilization: number; // demand / capacity
  overCount: number; // # people with raw Σ FTE > 1.0
  overPeople: { person: string; fte: number }[];
}

export type Severity = "red" | "amber";
export interface Alert {
  severity: Severity;
  pi?: string;
  text: string;
}

export interface TrendModel {
  pis: string[];
  capacity: number;
  perPi: PiTrend[];
  roles: string[];
  roleSeries: Record<string, number[]>; // role -> demand FTE per PI (aligned to `pis`)
  roleSupply: Record<string, number>; // role -> people who hold it × 1.0
  bottleneckRoles: Set<string>; // roles whose demand exceeds supply in any PI
  alerts: Alert[];
}

const pct = (u: number) => `${Math.round(u * 100)}%`;

/** Build the whole trend model from the full (all-PIs) allocation set. */
export function computeTrends(allocations: Allocation[]): TrendModel {
  const pis = Array.from(new Set(allocations.map((a) => a.pi))).sort();
  const capacity = new Set(allocations.map((a) => a.person)).size; // stable team size

  // Role supply = distinct people who ever hold that role.
  const supplySets = new Map<string, Set<string>>();
  for (const a of allocations) {
    if (!supplySets.has(a.role)) supplySets.set(a.role, new Set());
    supplySets.get(a.role)!.add(a.person);
  }
  const roleSupply: Record<string, number> = {};
  for (const [r, ppl] of supplySets) roleSupply[r] = ppl.size;

  const persons = computePersonAggs(allocations); // per (pi, person)
  const roleAggs = computeRoleAggs(allocations); // per (pi, role)

  const perPi: PiTrend[] = pis.map((pi) => {
    const pAgg = persons.filter((p) => p.pi === pi);
    const demand = round2(pAgg.reduce((s, p) => s + p.total_fte, 0));
    const overPeople = pAgg
      .filter((p) => p.over_allocated)
      .map((p) => ({ person: p.person, fte: p.total_fte }))
      .sort((a, b) => b.fte - a.fte);
    return { pi, demand, capacity, utilization: capacity ? demand / capacity : 0, overCount: overPeople.length, overPeople };
  });

  const roles = Array.from(new Set(roleAggs.map((r) => r.role))).sort(
    (a, b) => (ROLE_ORDER.indexOf(a) + 1 || 99) - (ROLE_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b),
  );
  const roleSeries: Record<string, number[]> = {};
  for (const role of roles) {
    roleSeries[role] = pis.map((pi) => {
      const ra = roleAggs.find((r) => r.pi === pi && r.role === role);
      return ra ? ra.total_fte : 0;
    });
  }
  const bottleneckRoles = new Set(
    roles.filter((r) => roleSeries[r].some((d) => d > (roleSupply[r] ?? 0))),
  );

  // ---- Alerts ("what to act on") ----
  const alerts: Alert[] = [];
  perPi.forEach((t) => {
    if (t.utilization >= UTIL_RED)
      alerts.push({ severity: "red", pi: t.pi, text: `${t.pi} — utilization ${pct(t.utilization)}: demand ${t.demand} FTE exceeds capacity ${t.capacity}` });
    else if (t.utilization >= UTIL_AMBER)
      alerts.push({ severity: "amber", pi: t.pi, text: `${t.pi} — utilization ${pct(t.utilization)} (approaching capacity ${t.capacity})` });
  });
  perPi.forEach((t) => {
    if (t.overCount > 0) {
      const names = t.overPeople.slice(0, 6).map((p) => `${p.person} ${p.fte}`).join(", ");
      alerts.push({ severity: "red", pi: t.pi, text: `${t.pi} — ${t.overCount} over-allocated: ${names}${t.overPeople.length > 6 ? "…" : ""}` });
    }
  });
  if (perPi.some((t, i) => i > 0 && t.overCount > perPi[i - 1].overCount))
    alerts.push({ severity: "amber", text: `Over-allocation worsening across PIs: ${perPi.map((t) => t.overCount).join(" → ")} people` });
  pis.forEach((pi, i) => {
    roles.forEach((role) => {
      const d = roleSeries[role][i];
      const sup = roleSupply[role] ?? 0;
      if (d > sup) alerts.push({ severity: "red", pi, text: `${pi} — ${role} demand ${round2(d)} FTE over supply ${sup} (hire / rebalance)` });
    });
  });
  // reds first, then amber; stable otherwise
  alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1));

  return { pis, capacity, perPi, roles, roleSeries, roleSupply, bottleneckRoles, alerts };
}
