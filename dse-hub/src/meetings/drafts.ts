// Shared model for the "Add meeting" modal — used both to render an in-app PREVIEW (before any
// PR) and to build the prefilled-PR file. Mirrors leave-dashboard/src/drafts.ts.
import type { JoinMethod, Meeting, Rule, Weekday } from "../types";

export type Freq = Rule["freq"];

export interface MeetingDraft {
  team: string;
  name: string;
  category: string;
  purpose: string;
  organizer: string;
  facilitator: string;
  // schedule
  freq: Freq;
  byday: Weekday[]; // weekly uses all; monthly/sprint/sprint-week use byday[0]
  interval: 1 | 2; // weekly
  anchor: string; // weekly interval:2 — a known occurrence date (YYYY-MM-DD)
  setpos: string; // monthly ("-1") or sprint ("1" / "2,3")
  week: number; // sprint-week
  startTime: string; // "HH:MM"
  endTime: string;
  tz: string; // IANA timezone the start/end times are entered in
  scheduleText: string; // original human phrasing
  // join
  joinMethod: JoinMethod;
  joinUrl: string;
  joinNote: string;
  notes: string;
}

export function newMeetingDraft(): MeetingDraft {
  return {
    team: "", name: "", category: "", purpose: "", organizer: "", facilitator: "",
    freq: "weekly", byday: ["TU"], interval: 1, anchor: "", setpos: "1", week: 1,
    startTime: "", endTime: "", tz: "America/Chicago", scheduleText: "",
    joinMethod: "google_meet", joinUrl: "", joinNote: "", notes: "",
  };
}

export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "meeting";
}

export function draftSlug(d: MeetingDraft): string {
  return slugify(`${d.team}-${d.name}`).slice(0, 60);
}

export function draftValid(d: MeetingDraft): boolean {
  return !!d.team.trim() && !!d.name.trim();
}

function parseSetpos(s: string): number[] {
  const nums = s.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));
  return nums.length ? nums : [1];
}

export function draftToRule(d: MeetingDraft): Rule {
  const first = d.byday[0] ?? "MO";
  switch (d.freq) {
    case "weekly": {
      const byday: Weekday[] = d.byday.length ? d.byday : ["MO"];
      const rule: Extract<Rule, { freq: "weekly" }> = { freq: "weekly", byday };
      if (d.interval === 2) {
        rule.interval = 2;
        if (d.anchor) rule.anchor = d.anchor;
      }
      return rule;
    }
    case "monthly":
      return { freq: "monthly", byday: first, setpos: parseSetpos(d.setpos)[0] ?? 1 };
    case "sprint":
      return { freq: "sprint", byday: first, setpos: parseSetpos(d.setpos) };
    case "sprint-week":
      return { freq: "sprint-week", week: d.week || 1, byday: first };
    case "tbd":
      return { freq: "tbd" };
  }
}

// Human fallback text if the user didn't type their own.
function autoScheduleText(d: MeetingDraft): string {
  if (d.scheduleText.trim()) return d.scheduleText.trim();
  const days = d.byday.join("/");
  const t = d.startTime ? ` ${d.startTime}${d.endTime ? `–${d.endTime}` : ""}` : "";
  switch (d.freq) {
    case "weekly": return `${d.interval === 2 ? "Every other " : ""}${days}${t}`.trim();
    case "monthly": return `Monthly (${d.setpos} ${d.byday[0]})${t}`.trim();
    case "sprint": return `Sprint (${d.setpos} ${d.byday[0]})${t}`.trim();
    case "sprint-week": return `Week ${d.week} ${d.byday[0]}${t}`.trim();
    case "tbd": return "TBD";
  }
}

// A draft -> the Meeting object (used for the live preview AND as the file body).
export function draftToMeeting(d: MeetingDraft): Meeting {
  const m: Meeting = {
    id: draftSlug(d),
    team: d.team.trim(),
    name: d.name.trim(),
    schedule: {
      tz: d.tz || "America/Chicago",
      text: autoScheduleText(d),
      rule: draftToRule(d),
    },
  };
  if (d.category.trim()) m.category = d.category.trim();
  if (d.purpose.trim()) m.purpose = d.purpose.trim();
  if (d.organizer.trim()) m.organizer = d.organizer.trim();
  if (d.facilitator.trim()) m.facilitator = d.facilitator.trim();
  if (d.startTime) m.schedule.start = d.startTime;
  if (d.endTime) m.schedule.end = d.endTime;
  if (d.joinUrl.trim() || d.joinNote.trim() || d.joinMethod) {
    m.join = { method: d.joinMethod };
    if (d.joinUrl.trim()) m.join.url = d.joinUrl.trim();
    if (d.joinNote.trim()) m.join.note = d.joinNote.trim();
  }
  if (d.notes.trim()) m.notes = d.notes.trim();
  return m;
}

// The prefilled-PR file: repo-root path + pretty JSON body.
export function buildMeetingFile(d: MeetingDraft, overrideId?: string): { filename: string; json: string } {
  const m = draftToMeeting(d);
  if (overrideId) m.id = overrideId; // keep an existing meeting's id/filename when editing
  return {
    filename: `dse-hub/data/meetings/${m.id}.json`,
    json: JSON.stringify(m, null, 2),
  };
}

// Reverse of draftToMeeting: prefill the edit form from an existing meeting.
export function meetingToDraft(m: Meeting): MeetingDraft {
  const d = newMeetingDraft();
  d.team = m.team;
  d.name = m.name;
  d.category = m.category ?? "";
  d.purpose = m.purpose ?? "";
  d.organizer = m.organizer ?? "";
  d.facilitator = m.facilitator ?? "";
  d.startTime = m.schedule.start ?? "";
  d.endTime = m.schedule.end ?? "";
  d.tz = m.schedule.tz ?? "America/Chicago";
  d.scheduleText = m.schedule.text ?? "";
  d.notes = m.notes ?? "";
  if (m.join) {
    d.joinMethod = m.join.method;
    d.joinUrl = m.join.url ?? "";
    d.joinNote = m.join.note ?? "";
  }
  const r = m.schedule.rule;
  d.freq = r.freq;
  if (r.freq === "weekly") {
    d.byday = r.byday;
    d.interval = r.interval ?? 1;
    d.anchor = r.anchor ?? "";
  } else if (r.freq === "monthly") {
    d.byday = [r.byday];
    d.setpos = String(r.setpos);
  } else if (r.freq === "sprint") {
    d.byday = [r.byday];
    d.setpos = r.setpos.join(",");
  } else if (r.freq === "sprint-week") {
    d.byday = [r.byday];
    d.week = r.week;
  }
  return d;
}
