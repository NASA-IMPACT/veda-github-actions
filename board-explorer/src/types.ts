// The shape scripts/generate_board_export.py writes. Keep in sync with that file — it is the
// only producer, and the golden test in scripts/test_generate.py pins the contract.

/** open | closed | merged. Draftness is a separate flag, NOT a state — a draft PR is still open. */
export type ItemState = "open" | "closed" | "merged";

/** issue | pr | draft (a Projects "draft issue", which lives only on the board). */
export type ItemKind = "issue" | "pr" | "draft";

/** GitHub's single-select colour enum. Mapped to fixed hexes in colors.ts. */
export type OptionColor =
  | "GRAY" | "BLUE" | "GREEN" | "YELLOW" | "ORANGE" | "RED" | "PINK" | "PURPLE";

export interface IterationWindow {
  title: string;
  startDate: string;
  duration: number;
}

/** A board field value. Iterations keep their window so the Timeline can draw sprint bands. */
export type FieldValue = string | number | IterationWindow;

export interface FieldDef {
  id: string;
  name: string;
  /** Only author-defined types reach the SPA: text | number | date | single_select | iteration. */
  type: "text" | "number" | "date" | "single_select" | "iteration";
  options?: { name: string; color: OptionColor }[];
  /** Completed + upcoming iterations, in chronological order. */
  iterations?: IterationWindow[];
}

export interface Person {
  login: string;
  name: string;
  avatar: string;
}

export interface LabelDef {
  name: string;
  /** GitHub's own hex, without the leading '#'. */
  color: string;
}

export interface BoardItem {
  id: string;
  kind: ItemKind;
  number: number | null;
  title: string;
  url: string;
  repo: string;
  state: ItemState;
  draft: boolean;
  state_reason: string | null;
  author: string | null;
  assignees: string[];
  labels: string[];
  milestone: string | null;
  issue_type: string | null;
  created: string | null;
  updated: string | null;
  closed: string | null;
  comments: number;
  body_excerpt: string;
  archived: boolean;
  fields: Record<string, FieldValue>;
  sub?: { total: number; completed: number };
  parent?: { number: number; title: string; url: string };
  review_decision?: string | null;
  diff?: { additions: number; deletions: number; files: number };
}

export interface BoardDoc {
  schemaVersion: number;
  generated: string;
  board: {
    title: string;
    url: string;
    number: number;
    owner: string;
    owner_type: "org" | "user";
    short_description: string;
    public: boolean;
    closed: boolean;
  };
  fields: FieldDef[];
  people: Person[];
  labels: LabelDef[];
  repos: string[];
  items: BoardItem[];
  stats: {
    items: number;
    issues: number;
    prs: number;
    drafts: number;
    open: number;
    closed: number;
  };
}

export interface IndexDoc {
  generated: string;
  schemaVersion: number;
  defaultBoard: string;
  boards: Record<
    string,
    { file: string; title: string; url: string; generated: string; items: number }
  >;
}
