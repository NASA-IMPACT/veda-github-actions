// Pure date helpers for the month calendar. Adapted from leave-dashboard/src/compute.ts:4-76 —
// local-midnight parsing avoids UTC off-by-one, and monthGrid builds a Sun–Sat grid.

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d); // local midnight
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

export function addMonths(key: MonthKey, delta: number): MonthKey {
  const d = new Date(key.year, key.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function monthStartISO(key: MonthKey): string {
  return toISO(new Date(key.year, key.month, 1));
}

export function monthEndISO(key: MonthKey): string {
  return toISO(new Date(key.year, key.month + 1, 0));
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
    if (cur.getMonth() !== key.month && cur > new Date(key.year, key.month + 1, 0)) break;
  }
  return weeks;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-08-06" -> "Thu, Aug 6"
export function formatShortDate(iso: string): string {
  const d = parseISO(iso);
  return `${WEEKDAYS[d.getDay()]}, ${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

// "10:30"–"11:00" -> "10:30–11:00 AM"; single time -> "10:30 AM"; blank -> "".
export function formatTimeRange(start?: string, end?: string): string {
  if (!start) return "";
  const f = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const ap = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return { label: `${h12}:${String(m).padStart(2, "0")}`, ap };
  };
  const a = f(start);
  if (!end) return `${a.label} ${a.ap}`;
  const b = f(end);
  // Drop the first AM/PM when both share it: "10:30–11:00 AM".
  return a.ap === b.ap ? `${a.label}–${b.label} ${b.ap}` : `${a.label} ${a.ap}–${b.label} ${b.ap}`;
}
