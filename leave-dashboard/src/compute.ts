// Pure data-shaping helpers: dates, month grids, per-day indexing, filtering, risk flags.
import type { CoverageDay, Leave, Person, Status } from "./types";

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d); // local midnight; avoids UTC off-by-one
}

export function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export interface MonthKey {
  year: number;
  month: number; // 0-11
}

export function monthKey(d: Date): MonthKey {
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function sameMonth(a: MonthKey, b: MonthKey): boolean {
  return a.year === b.year && a.month === b.month;
}

// Inclusive list of months spanned by [start, end].
export function monthsBetween(start: string, end: string): MonthKey[] {
  const s = parseISO(start);
  const e = parseISO(end);
  const out: MonthKey[] = [];
  let y = s.getFullYear();
  let m = s.getMonth();
  while (y < e.getFullYear() || (y === e.getFullYear() && m <= e.getMonth())) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

export interface GridDay {
  date: Date;
  iso: string;
  inMonth: boolean;
  weekend: boolean;
}

// A Sun–Sat calendar grid covering the weeks that intersect the given month.
export function monthGrid(key: MonthKey): GridDay[][] {
  const first = new Date(key.year, key.month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // back up to Sunday
  const weeks: GridDay[][] = [];
  const cur = new Date(start);
  for (let w = 0; w < 6; w++) {
    const row: GridDay[] = [];
    for (let i = 0; i < 7; i++) {
      row.push({
        date: new Date(cur),
        iso: toISO(cur),
        inMonth: cur.getMonth() === key.month,
        weekend: cur.getDay() === 0 || cur.getDay() === 6,
      });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(row);
    // Stop after we've passed the month and completed a week.
    if (cur.getMonth() !== key.month && cur > new Date(key.year, key.month + 1, 0)) break;
  }
  return weeks;
}

export interface PersonLeave {
  person: Person;
  leave: Leave;
}

// isoDate -> people out (visible) that day. Applies the person/team/status filters.
export function indexByDate(
  people: Person[],
  visibleSlugs: Set<string>,
  statuses: Set<Status>,
): Map<string, PersonLeave[]> {
  const map = new Map<string, PersonLeave[]>();
  for (const person of people) {
    if (!visibleSlugs.has(person.slug)) continue;
    for (const leave of person.leaves) {
      if (!statuses.has(leave.status)) continue;
      const arr = map.get(leave.date) ?? [];
      arr.push({ person, leave });
      map.set(leave.date, arr);
    }
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.person.name.localeCompare(b.person.name));
  }
  return map;
}

export function visiblePeople(
  people: Person[],
  selectedTeams: Set<string>,
  selectedSlugs: Set<string>,
): Person[] {
  return people.filter((p) => selectedTeams.has(p.team) && selectedSlugs.has(p.slug));
}

// Risk lookup: (team|date) -> coverage; plus the set of flagged (team,date) at a threshold.
export interface RiskModel {
  byKey: Map<string, CoverageDay>;
  flaggedCount: number;
}

export function riskModel(days: CoverageDay[], teams: Set<string>, threshold: number): RiskModel {
  const byKey = new Map<string, CoverageDay>();
  let flaggedCount = 0;
  for (const d of days) {
    if (!teams.has(d.team)) continue;
    byKey.set(`${d.team}|${d.date}`, d);
    if (d.out_pct >= threshold) flaggedCount += 1;
  }
  return { byKey, flaggedCount };
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
