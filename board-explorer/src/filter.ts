// Applying a ParsedQuery to the board, plus the per-option counts the pickers show.
//
// Every predicate follows the same three rules, which are GitHub's:
//   include[] non-empty -> the item must match AT LEAST ONE (comma = OR)
//   exclude[] non-empty -> the item must match NONE
//   empty === true/false -> the property must be absent / present
// An untouched facet constrains nothing.

import type { BoardDoc, BoardItem, FieldValue } from "./types";
import type { Facet, ParsedQuery } from "./search";

/** The display string a board field value filters and sorts by. */
export function fieldText(value: FieldValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return value.title ?? "";
  return String(value);
}

/** Sortable key for a field value — iterations sort by their start date, not their title. */
export function fieldSortKey(value: FieldValue | undefined): string | number {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return value.startDate ?? value.title ?? "";
  return value;
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Facet test for a property that holds MANY values (assignees, labels). */
function matchesMulti(values: string[], facet: Facet): boolean {
  if (facet.empty === true && values.length > 0) return false;
  if (facet.empty === false && values.length === 0) return false;
  // OR inside a group (`label:a,b`), AND across groups (`label:a label:b`).
  for (const group of facet.include) {
    if (!group.some((want) => values.some((v) => eq(v, want)))) return false;
  }
  if (facet.exclude.length && facet.exclude.some((no) => values.some((v) => eq(v, no)))) return false;
  return true;
}

/** Facet test for a property that holds ONE value (repo, milestone, state, a board field). */
function matchesSingle(value: string, facet: Facet): boolean {
  return matchesMulti(value ? [value] : [], facet);
}

/** Date facet test — `updated:>@today-7d` and friends. Bounds are ANDed. */
function matchesDate(iso: string | null, facet: Facet): boolean {
  if (facet.empty === true && iso) return false;
  if (facet.empty === false && !iso) return false;
  const day = (iso || "").slice(0, 10);
  for (const b of facet.bounds ?? []) {
    if (!day) return false;
    if (b.op === ">" && !(day > b.date)) return false;
    if (b.op === ">=" && !(day >= b.date)) return false;
    if (b.op === "<" && !(day < b.date)) return false;
    if (b.op === "<=" && !(day <= b.date)) return false;
  }
  for (const group of facet.include) {
    if (!group.some((want) => day.startsWith(want))) return false;
  }
  if (facet.exclude.length && facet.exclude.some((no) => day.startsWith(no))) return false;
  return true;
}

/**
 * Everything the free-text words search. Repo is included so `repo-a` finds its items without a
 * qualifier, and the number is included so `221` finds issue #221.
 */
function haystack(item: BoardItem): string {
  return [
    item.title,
    item.body_excerpt,
    item.repo,
    item.number != null ? `#${item.number}` : "",
    item.number != null ? String(item.number) : "",
    item.author ?? "",
    ...item.assignees,
    ...item.labels,
    item.milestone ?? "",
    ...Object.values(item.fields).map(fieldText),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const NO_FACET: Facet = { include: [], exclude: [] };

export function matchesQuery(item: BoardItem, q: ParsedQuery, board: BoardDoc): boolean {
  if (q.draft !== undefined && item.draft !== q.draft) return false;

  const f = (key: string) => q.facets[key] ?? NO_FACET;
  if (!matchesSingle(item.state, f("state"))) return false;
  if (!matchesSingle(item.kind, f("kind"))) return false;
  if (!matchesMulti(item.assignees, f("assignee"))) return false;
  if (!matchesMulti(item.labels, f("label"))) return false;
  if (!matchesSingle(item.author ?? "", f("author"))) return false;
  if (!matchesSingle(item.milestone ?? "", f("milestone"))) return false;
  if (!matchesSingle(item.issue_type ?? "", f("type"))) return false;
  if (!matchesSingle(item.state_reason ?? "", f("reason"))) return false;
  if (!matchesDate(item.created, f("created"))) return false;
  if (!matchesDate(item.updated, f("updated"))) return false;
  if (!matchesDate(item.closed, f("closed"))) return false;

  // `repo:` accepts either the bare name or owner/name, because nobody types the org every time.
  const repoFacet = f("repo");
  if (repoFacet !== NO_FACET) {
    const short = item.repo.includes("/") ? item.repo.split("/")[1] : item.repo;
    if (!matchesMulti(item.repo ? [item.repo, short] : [], repoFacet)) return false;
  }

  for (const field of board.fields) {
    const facet = q.facets[field.name];
    if (!facet) continue;
    const value = item.fields[field.name];
    if (field.type === "date") {
      if (!matchesDate(fieldText(value) || null, facet)) return false;
    } else if (!matchesSingle(fieldText(value), facet)) return false;
  }

  if (q.text.length) {
    const hay = haystack(item);
    if (!q.text.every((word) => hay.includes(word))) return false;
  }
  return true;
}

export function applyQuery(items: BoardItem[], q: ParsedQuery, board: BoardDoc): BoardItem[] {
  return items.filter((item) => matchesQuery(item, q, board));
}

/**
 * How many of `items` each option of `key` would match. Counted over the items that pass every
 * OTHER facet, so the numbers answer "what would I get if I also picked this?" rather than
 * collapsing to the current selection.
 */
export function facetCounts(
  items: BoardItem[],
  q: ParsedQuery,
  board: BoardDoc,
  key: string,
  valuesOf: (item: BoardItem) => string[],
): Map<string, number> {
  const others: ParsedQuery = { ...q, facets: { ...q.facets } };
  delete others.facets[key];
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!matchesQuery(item, others, board)) continue;
    for (const value of valuesOf(item)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

/** How many distinct qualifiers are narrowing right now — the number on the Reset button. */
export function activeCount(q: ParsedQuery): number {
  let n = q.text.length ? 1 : 0;
  if (q.draft !== undefined) n++;
  for (const facet of Object.values(q.facets)) {
    if (facet.include.length || facet.exclude.length || facet.empty !== undefined || facet.bounds?.length) n++;
  }
  return n;
}
