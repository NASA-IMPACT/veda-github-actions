// Resolves a meeting's structured recurrence `rule` to concrete calendar dates within a window.
// Sprint-relative rules ("1st Monday of Sprint", "Wednesday of third week") are resolved against
// the PI/sprint boundaries in data/pi_calendar.json. Everything is pure and unit-testable.
import type { Meeting, PiCalendar, Rule, Sprint, Weekday } from "../types";
import { parseISO, toISO } from "../calendar";

const WD: Record<Weekday, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// Every date in [startISO, endISO] whose weekday matches `wd`.
function weekdayDatesInRange(startISO: string, endISO: string, wd: number): Date[] {
  const out: Date[] = [];
  const end = parseISO(endISO);
  for (let d = parseISO(startISO); d <= end; d = addDays(d, 1)) {
    if (d.getDay() === wd) out.push(new Date(d));
  }
  return out;
}

// The nth matching weekday within a [startISO, endISO] window. setpos: 1-based from the start,
// or negative from the end (-1 == last). Returns null if there aren't that many.
function nthWeekday(startISO: string, endISO: string, wd: number, setpos: number): Date | null {
  const matches = weekdayDatesInRange(startISO, endISO, wd);
  const idx = setpos < 0 ? matches.length + setpos : setpos - 1;
  return matches[idx] ?? null;
}

// Sprints that overlap [startISO, endISO].
function sprintsInRange(pi: PiCalendar | null, startISO: string, endISO: string): Sprint[] {
  if (!pi) return [];
  return pi.sprints.filter((s) => s.start <= endISO && s.end >= startISO);
}

// All occurrence dates (ISO) of a meeting within [startISO, endISO], inclusive.
export function occurrencesInRange(
  meeting: Meeting,
  startISO: string,
  endISO: string,
  pi: PiCalendar | null,
): string[] {
  const dates = resolveRule(meeting.schedule.rule, startISO, endISO, pi);
  // Clamp to the window and de-dupe/sort.
  const inRange = dates.filter((iso) => iso >= startISO && iso <= endISO);
  return [...new Set(inRange)].sort();
}

function resolveRule(rule: Rule, startISO: string, endISO: string, pi: PiCalendar | null): string[] {
  switch (rule.freq) {
    case "tbd":
      return [];

    case "weekly": {
      const interval = rule.interval ?? 1;
      const anchor = rule.anchor ? parseISO(rule.anchor) : null;
      const out: string[] = [];
      for (const wd of rule.byday) {
        for (const d of weekdayDatesInRange(startISO, endISO, WD[wd])) {
          if (interval === 2 && anchor) {
            // Same weekday as the anchor -> difference is an exact multiple of 7 days.
            const weeks = Math.round((d.getTime() - anchor.getTime()) / (7 * DAY_MS));
            if (Math.abs(weeks) % 2 !== 0) continue;
          }
          out.push(toISO(d));
        }
      }
      return out;
    }

    case "monthly": {
      // Walk each month that the window touches and pick the nth weekday of that whole month.
      const out: string[] = [];
      const start = parseISO(startISO);
      const end = parseISO(endISO);
      let y = start.getFullYear();
      let m = start.getMonth();
      while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
        const mStart = toISO(new Date(y, m, 1));
        const mEnd = toISO(new Date(y, m + 1, 0));
        const hit = nthWeekday(mStart, mEnd, WD[rule.byday], rule.setpos);
        if (hit) out.push(toISO(hit));
        m += 1;
        if (m > 11) { m = 0; y += 1; }
      }
      return out;
    }

    case "sprint": {
      const out: string[] = [];
      for (const sp of sprintsInRange(pi, startISO, endISO)) {
        for (const pos of rule.setpos) {
          const hit = nthWeekday(sp.start, sp.end, WD[rule.byday], pos);
          if (hit) out.push(toISO(hit));
        }
      }
      return out;
    }

    case "sprint-week": {
      const out: string[] = [];
      for (const sp of sprintsInRange(pi, startISO, endISO)) {
        // Week N of the sprint = the 7-day window starting (N-1) weeks after the sprint start.
        const wkStart = addDays(parseISO(sp.start), (rule.week - 1) * 7);
        let wkEnd = addDays(wkStart, 6);
        const spEnd = parseISO(sp.end);
        if (wkEnd > spEnd) wkEnd = spEnd;
        if (wkStart > spEnd) continue;
        const hit = nthWeekday(toISO(wkStart), toISO(wkEnd), WD[rule.byday], 1);
        if (hit) out.push(toISO(hit));
      }
      return out;
    }
  }
}

// The next occurrence on/after `fromISO`, or null (TBD, or nothing scheduled ahead).
// Looks ~180 days out — enough to catch monthly and sprint-relative meetings.
export function nextOccurrence(meeting: Meeting, fromISO: string, pi: PiCalendar | null): string | null {
  if (meeting.schedule.rule.freq === "tbd") return null;
  const end = toISO(addDays(parseISO(fromISO), 180));
  const dates = occurrencesInRange(meeting, fromISO, end, pi);
  return dates[0] ?? null;
}

export function isUnscheduled(meeting: Meeting): boolean {
  return meeting.schedule.rule.freq === "tbd";
}
