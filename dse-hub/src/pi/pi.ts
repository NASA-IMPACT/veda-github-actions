// Pure sprint/PI helpers (unit-testable). Used to place today in a sprint, label the roadmap, and
// tint the calendar.
import type { Pi, Sprint } from "../types";

export interface PiSprint {
  pi: Pi;
  sprint: Sprint;
}

// Which PI + sprint an ISO date falls in (inclusive), or null if it's in a gap / no PI covers it.
export function sprintForDate(pis: Pi[], iso: string): PiSprint | null {
  for (const pi of pis) {
    for (const sprint of pi.sprints) {
      if (sprint.start <= iso && iso <= sprint.end) return { pi, sprint };
    }
  }
  return null;
}

// The PI's overall span = earliest sprint start .. latest sprint end.
export function piDateRange(pi: Pi): { start: string; end: string } {
  const starts = pi.sprints.map((s) => s.start);
  const ends = pi.sprints.map((s) => s.end);
  return {
    start: starts.reduce((m, s) => (s < m ? s : m), starts[0] ?? ""),
    end: ends.reduce((m, s) => (s > m ? s : m), ends[0] ?? ""),
  };
}

export type PiStatus = "past" | "current" | "upcoming";

export function piStatus(pi: Pi, today: string): PiStatus {
  const { start, end } = piDateRange(pi);
  if (!start || !end) return "upcoming";
  if (today < start) return "upcoming";
  if (today > end) return "past";
  return "current";
}

export function sprintLabel(sprint: Sprint): string {
  return sprint.name ?? `Sprint ${sprint.index}`;
}
