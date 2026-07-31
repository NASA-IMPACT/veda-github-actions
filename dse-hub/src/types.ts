// The data contract for the Meeting Tracker. One Meeting == one JSON file under
// data/meetings/<id>.json. Schedules are stored as a structured `rule` (resolved to real
// calendar dates by src/meetings/recurrence.ts) PLUS the original human `text` so nothing is
// lost even when the rule is only approximate.

export type Weekday = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";

// Recurrence rule — a discriminated union covering every pattern in the seed table.
export type Rule =
  // Weekly on one or more weekdays. interval:2 + anchor (a known occurrence date) == "every other".
  | { freq: "weekly"; byday: Weekday[]; interval?: 1 | 2; anchor?: string }
  // Nth weekday of the calendar month. setpos 1..4 from the start, -1 == last.
  | { freq: "monthly"; byday: Weekday; setpos: number }
  // Nth weekday within a sprint. setpos is a list so "2nd/3rd Mondays of Sprint" == [2, 3].
  | { freq: "sprint"; byday: Weekday; setpos: number[] }
  // The given weekday inside the Nth calendar week of a sprint ("Wednesday of third week").
  | { freq: "sprint-week"; week: number; byday: Weekday }
  // No resolvable date — shows only in the Unscheduled / TBD tray.
  | { freq: "tbd" };

export interface Schedule {
  tz?: string; // IANA tz label, informational (times are shown as Central Time)
  start?: string; // "HH:MM" 24h local
  end?: string; // "HH:MM" 24h local
  text: string; // original human phrasing — ALWAYS shown
  rule: Rule;
}

export type JoinMethod = "google_meet" | "teams" | "in_person" | "hybrid" | "other";

export interface Join {
  method: JoinMethod;
  url?: string; // may be absent (e.g. Teams / "Join the meeting now" links)
  note?: string; // free text, e.g. "In person in 3098"
}

export interface Meeting {
  id: string; // == filename slug
  team: string;
  name: string;
  category?: string; // e.g. "Sprint Planning", "Check In", "Standup"
  purpose?: string;
  organizer?: string;
  facilitator?: string;
  schedule: Schedule;
  join?: Join;
  notes?: string;
}

export interface Sprint {
  index: number;
  name?: string; // optional label, e.g. "Sprint 1"
  start: string; // "YYYY-MM-DD" inclusive
  end: string; // "YYYY-MM-DD" inclusive
  goal?: string; // optional sprint goal/theme
}

// One Program Increment == one JSON file under data/pis/<id>.json.
export interface Pi {
  id: string; // == filename slug, e.g. "pi-26-4"
  name: string; // e.g. "PI 26.4"
  tz?: string;
  goal?: string; // optional PI theme
  boardUrl?: string; // optional link
  sprints: Sprint[];
}

// Flattened view used by the recurrence engine (all sprints across every PI). It reads only
// `.sprints`, so combining PIs here is safe.
export interface PiCalendar {
  tz?: string;
  pi?: string;
  sprints: Sprint[];
}
