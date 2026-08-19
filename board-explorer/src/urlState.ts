// Shareable view state <-> URL hash, so "Copy link" reopens the exact filtered view.
//
// Because the query string is the single source of truth for every narrowing (see search.ts),
// the URL is small: the query itself, which view is showing, and how it is sorted/grouped.

export type ViewId = "table" | "assignee" | "timeline";

export interface ViewState {
  q: string;
  view: ViewId;
  /** "<column>:<asc|desc>" — column is a table key or a board field name. */
  sort: string;
  /** Grouping key for the timeline view. */
  group: string;
  showArchived: boolean;
}

export const DEFAULT_STATE: ViewState = {
  q: "",
  view: "table",
  sort: "updated:desc",
  group: "Status",
  showArchived: false,
};

const VIEWS: ViewId[] = ["table", "assignee", "timeline"];

export function decodeHash(hash: string): Partial<ViewState> {
  const s = hash.replace(/^#/, "");
  if (!s) return {};
  const p = new URLSearchParams(s);
  const out: Partial<ViewState> = {};
  const q = p.get("q");
  if (q) out.q = q;
  const view = p.get("view");
  if (view && (VIEWS as string[]).includes(view)) out.view = view as ViewId;
  const sort = p.get("sort");
  if (sort && /^[^:]+:(asc|desc)$/.test(sort)) out.sort = sort;
  const group = p.get("group");
  if (group) out.group = group;
  if (p.get("archived") === "1") out.showArchived = true;
  return out;
}

/** Anything at its default is omitted, so a shared link carries only what was actually chosen. */
export function encodeHash(state: ViewState): string {
  const p = new URLSearchParams();
  if (state.q.trim()) p.set("q", state.q.trim());
  if (state.view !== DEFAULT_STATE.view) p.set("view", state.view);
  if (state.sort !== DEFAULT_STATE.sort) p.set("sort", state.sort);
  if (state.group !== DEFAULT_STATE.group) p.set("group", state.group);
  if (state.showArchived) p.set("archived", "1");
  const s = p.toString();
  return s ? "#" + s : "";
}
