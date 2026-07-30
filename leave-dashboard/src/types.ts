// Data models — mirror leave/generate_leave_tracker.py output.

export type Status =
  | "unavailable"
  | "limited"
  | "holiday"
  | "planned_time_off"
  | "work_travel"
  | "wfh"
  | "other";

export interface Leave {
  date: string; // YYYY-MM-DD
  status: Status;
  out: boolean;
  weight: number;
  note: string | null;
  source: "xlsx" | "override" | string;
}

export interface Person {
  slug: string;
  name: string;
  team: string;
  role: string;
  leaves: Leave[];
}

export interface CategoryMeta {
  color: string | null; // ARGB hex from the workbook
  out: boolean;
  weight: number;
}

export interface Meta {
  pi: string;
  year: number;
  generated: string;
  source_file: string;
  span: { start: string; end: string };
  teams: string[];
  team_size: Record<string, number>;
  risk_threshold_default: number;
  categories: Record<Status, CategoryMeta>;
}

export interface LeavesDoc {
  meta: Meta;
  people: Person[];
  warnings: string[];
}

export interface CoverageDay {
  date: string;
  team: string;
  team_size: number;
  out_count: number;
  out_weight: number;
  out_pct: number;
  people_out: string[];
  limited: string[];
}

export interface CoverageDoc {
  team_size: Record<string, number>;
  days: CoverageDay[];
  risk_threshold_default: number;
}

export interface Dataset {
  source: "live" | "snapshot";
  generated: string;
  doc: LeavesDoc;
  coverage: CoverageDoc;
}
