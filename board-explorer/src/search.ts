// The query language — a subset of GitHub's own Projects filter syntax, so muscle memory
// transfers. This is the same grammar `gh project item-list --query` accepts.
//
// ONE SOURCE OF TRUTH. The query string holds every narrowing the user has applied, whether they
// typed it or clicked it: the filter pickers read their state back out of the parsed query and
// write changes into the query text. That is why there is no parallel `Filters` object here.
//
// (This is a deliberate departure from `algorithm-catalog/src/filters/filter.ts`, whose rule is
// "state starts fully selected; a facet narrows only as a strict subset". That model suits a small
// closed vocabulary — 10 hazards, 4 modalities. This board has 33 sprints, 23 labels and 22
// people, where "select everything, then deselect 22 things to see one" is the wrong gesture, and
// where an empty facet meaning "unconstrained" is exactly what `label:bug` already means in
// GitHub's grammar. Empty = no constraint, here.)
//
// Supported:
//   assignee: author: label: milestone: repo: type: reason:   and any board field by name
//   is:open|closed|merged|issue|pr|draft
//   no:assignee|label|milestone   has:assignee|label|milestone
//   -qualifier:value              negation
//   a,b                           comma = OR within one qualifier
//   label:x label:y               repeating a qualifier = AND
//   "two words":"a value"         quoting, for multi-word field names and values
//   updated:>@today-7d            comparison on date fields: > >= < <= with @today[-Nd|-Nw] or YYYY-MM-DD
//   bare words                    free-text over title, body, number, repo
//
// Deliberately NOT supported (documented in docs/BOARD_EXPLORER.md rather than silently dropped):
// wildcards (`label:*bug*`), ranges (`points:1..3`), and the iteration keywords
// `@current`/`@previous`/`@next`. `@me` is meaningless — this app has no signed-in user.

import type { BoardDoc, FieldDef } from "./types";

export interface Token {
  neg: boolean;
  /** null for a bare free-text word. */
  key: string | null;
  /** Raw value text, before comma-splitting. */
  value: string;
}

export interface DateBound {
  op: ">" | ">=" | "<" | "<=";
  /** Resolved to an absolute ISO date at parse time. */
  date: string;
}

export interface Facet {
  /**
   * One GROUP per qualifier token, because the two ways of giving several values mean opposite
   * things in GitHub's grammar: `label:a,b` is OR (one token, one group) while `label:a label:b`
   * is AND (two tokens, two groups). Matching therefore requires a hit in EVERY group.
   * Flattening these into one list would silently turn `is:open is:closed` — a contradiction
   * that should return nothing — into "everything".
   */
  include: string[][];
  /** Exclusions need no grouping: "not a" and "not b" is the same set however it was written. */
  exclude: string[];
  /** true = `no:x` (must be empty); false = `has:x` (must be non-empty); undefined = unconstrained. */
  empty?: boolean;
  /** Comparison bounds, for date-typed qualifiers. */
  bounds?: DateBound[];
}

export interface ParsedQuery {
  /** Bare words, lowercased, all of which must appear somewhere in the item. */
  text: string[];
  /** Keyed by canonical qualifier name (see CORE_KEYS) or by exact board field name. */
  facets: Record<string, Facet>;
  /** is:draft / -is:draft. */
  draft?: boolean;
  /** Tokens whose qualifier matched nothing on this board — surfaced so the UI can warn. */
  unknown: string[];
}

/** Qualifiers that exist independently of the board's own fields. */
export const CORE_KEYS = [
  "assignee", "author", "label", "milestone", "repo", "type", "reason",
  "state", "kind", "created", "updated", "closed",
] as const;

/** `no:` / `has:` only make sense for properties that can be absent. */
const EMPTIABLE = new Set(["assignee", "label", "milestone", "type"]);

const DATE_KEYS = new Set(["created", "updated", "closed"]);

// ---------------------------------------------------------------- tokenizer

/** Split on whitespace, but never inside double quotes. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let buf = "";
  let inQuotes = false;
  const flush = () => {
    if (buf.trim()) out.push(splitToken(buf.trim()));
    buf = "";
  };
  for (const ch of text) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      buf += ch;
    } else if (/\s/.test(ch) && !inQuotes) {
      flush();
    } else {
      buf += ch;
    }
  }
  flush();
  return out;
}

function unquote(s: string): string {
  return s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s;
}

/** `-label:"a b"` -> { neg: true, key: "label", value: "a b" }. */
function splitToken(raw: string): Token {
  let neg = false;
  let s = raw;
  if (s.startsWith("-") && s.length > 1) {
    neg = true;
    s = s.slice(1);
  }
  // Find the first ':' that is not inside quotes — that separates key from value.
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      return { neg, key: unquote(s.slice(0, i)).trim(), value: unquote(s.slice(i + 1)).trim() };
    }
  }
  return { neg, key: null, value: unquote(s) };
}

/** Comma = OR within one qualifier, but a quoted value may itself contain commas. */
function splitValues(value: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// ---------------------------------------------------------------- field name resolution

/** "Program Increment" / "program-increment" / "programincrement" all collapse to the same key. */
export function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolveKey(key: string, fields: FieldDef[]): string | null {
  const n = normKey(key);
  for (const core of CORE_KEYS) if (normKey(core) === n) return core;
  // Plural forms people actually type.
  if (n === "assignees") return "assignee";
  if (n === "labels") return "label";
  if (n === "repos" || n === "repository") return "repo";
  if (n === "milestones") return "milestone";
  const field = fields.find((f) => normKey(f.name) === n);
  return field ? field.name : null;
}

// ---------------------------------------------------------------- date bounds

const TODAY_RE = /^@today(?:\s*-\s*(\d+)\s*([dw]))?$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `>@today-7d`, `<=2026-01-31`. Returns null if this is not a comparison at all. */
export function parseDateBound(value: string, today: Date): DateBound | null {
  const m = /^(>=|<=|>|<)\s*(.+)$/.exec(value.trim());
  if (!m) return null;
  const op = m[1] as DateBound["op"];
  const rest = m[2].trim();
  if (ISO_RE.test(rest)) return { op, date: rest };
  const t = TODAY_RE.exec(rest);
  if (!t) return null;
  const n = t[1] ? parseInt(t[1], 10) : 0;
  const days = t[2]?.toLowerCase() === "w" ? n * 7 : n;
  const d = new Date(today.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return { op, date: d.toISOString().slice(0, 10) };
}

// ---------------------------------------------------------------- parse

function emptyFacet(): Facet {
  return { include: [], exclude: [] };
}

export function parseQuery(text: string, board: BoardDoc | null, today = new Date()): ParsedQuery {
  const fields = board?.fields ?? [];
  const parsed: ParsedQuery = { text: [], facets: {}, unknown: [] };
  const facet = (key: string): Facet => (parsed.facets[key] ??= emptyFacet());

  for (const tok of tokenize(text)) {
    if (tok.key === null) {
      if (tok.value) parsed.text.push(tok.value.toLowerCase());
      continue;
    }
    const key = tok.key.toLowerCase();

    // is: — the one qualifier whose VALUE picks which facet it lands in. A single `is:` token can
    // therefore feed several facets, and each gets its own group (`is:open,pr` = open AND pr,
    // because they constrain different properties; `is:open,closed` = open OR closed).
    if (key === "is") {
      const groups: Record<string, string[]> = { state: [], kind: [] };
      for (const v of splitValues(tok.value)) {
        const val = v.toLowerCase();
        if (val === "open" || val === "closed" || val === "merged") groups.state.push(val);
        else if (val === "issue" || val === "pr") groups.kind.push(val);
        else if (val === "draft") parsed.draft = !tok.neg;
        else parsed.unknown.push(`is:${v}`);
      }
      for (const [name, values] of Object.entries(groups)) {
        if (!values.length) continue;
        const f = facet(name);
        if (tok.neg) f.exclude.push(...values);
        else f.include.push(values);
      }
      continue;
    }

    // no: / has: — existence, and `-no:x` is the same as `has:x` (GitHub documents this).
    if (key === "no" || key === "has") {
      for (const v of splitValues(tok.value)) {
        const target = resolveKey(v, fields);
        if (!target || (!EMPTIABLE.has(target) && !fields.some((f) => f.name === target))) {
          parsed.unknown.push(`${key}:${v}`);
          continue;
        }
        const wantEmpty = key === "no";
        facet(target).empty = tok.neg ? !wantEmpty : wantEmpty;
      }
      continue;
    }

    const target = resolveKey(tok.key, fields);
    if (!target) {
      // Unrecognized qualifier: treat the whole token as free text rather than silently
      // dropping it, so a typo narrows visibly instead of doing nothing.
      parsed.unknown.push(`${tok.key}:${tok.value}`);
      parsed.text.push(`${tok.key}:${tok.value}`.toLowerCase());
      continue;
    }

    const isDateKey =
      DATE_KEYS.has(target) || fields.some((f) => f.name === target && f.type === "date");
    const f = facet(target);
    const group: string[] = [];
    for (const v of splitValues(tok.value)) {
      const bound = isDateKey ? parseDateBound(v, today) : null;
      if (bound) (f.bounds ??= []).push(bound);
      else if (tok.neg) f.exclude.push(v);
      else group.push(v);
    }
    // One token -> one group, so the values inside it are OR and separate tokens are AND.
    if (group.length) f.include.push(group);
  }
  return parsed;
}

// ---------------------------------------------------------------- writing back

function quoteIfNeeded(s: string): string {
  return /[\s,:]/.test(s) ? `"${s}"` : s;
}

/**
 * Replace every token for `key` with `values` (empty = remove the qualifier entirely), leaving
 * the rest of the query — including free text and other qualifiers — exactly as typed.
 * This is how a picker writes its selection back into the one source of truth.
 */
export function setQualifier(text: string, key: string, values: string[]): string {
  const n = normKey(key);
  const kept: string[] = [];
  for (const tok of tokenize(text)) {
    // `is:` tokens are keyed by their VALUE, so they need matching on the value's meaning.
    if (tok.key && normKey(tok.key) === "is" && (n === "state" || n === "kind" || n === "draft")) {
      const vals = splitValues(tok.value).filter((v) => {
        const lv = v.toLowerCase();
        const bucket =
          lv === "open" || lv === "closed" || lv === "merged"
            ? "state"
            : lv === "draft"
              ? "draft"
              : lv === "issue" || lv === "pr"
                ? "kind"
                : "";
        return bucket !== n;
      });
      if (vals.length) kept.push(`${tok.neg ? "-" : ""}is:${vals.map(quoteIfNeeded).join(",")}`);
      continue;
    }
    if (tok.key && normKey(tok.key) === n) continue; // drop — we are replacing it
    if (tok.key && (normKey(tok.key) === "no" || normKey(tok.key) === "has")) {
      const vals = splitValues(tok.value).filter((v) => normKey(v) !== n);
      if (vals.length) kept.push(`${tok.neg ? "-" : ""}${tok.key}:${vals.join(",")}`);
      continue;
    }
    kept.push(renderToken(tok));
  }
  const prefix = n === "state" || n === "kind" || n === "draft" ? "is" : key;
  if (values.length) {
    kept.push(`${quoteIfNeeded(prefix)}:${values.map(quoteIfNeeded).join(",")}`);
  }
  return kept.join(" ").trim();
}

function renderToken(tok: Token): string {
  const neg = tok.neg ? "-" : "";
  if (tok.key === null) return `${neg}${quoteIfNeeded(tok.value)}`;
  return `${neg}${quoteIfNeeded(tok.key)}:${quoteIfNeeded(tok.value)}`;
}

/** Every included value of a facet, flattened — what a picker shows as checked. */
export function includedValues(facet: Facet | undefined): string[] {
  return facet ? facet.include.flat() : [];
}

/** Toggle one value of one qualifier on/off — what clicking a chip or a checkbox does. */
export function toggleQualifier(text: string, key: string, value: string, board: BoardDoc | null): string {
  const current = includedValues(parseQuery(text, board).facets[key]);
  const has = current.some((v) => v.toLowerCase() === value.toLowerCase());
  const next = has
    ? current.filter((v) => v.toLowerCase() !== value.toLowerCase())
    : [...current, value];
  return setQualifier(text, key, next);
}

/** `is:draft` is a boolean, not a value list, so it gets its own setter (and can be negated). */
export function setDraft(text: string, on: boolean | undefined): string {
  const cleared = setQualifier(text, "draft", []);
  if (on === undefined) return cleared;
  return `${cleared} ${on ? "is:draft" : "-is:draft"}`.trim();
}

/** Remove one qualifier entirely. */
export function clearQualifier(text: string, key: string): string {
  return setQualifier(text, key, []);
}

/**
 * Remove ONE value of one qualifier — the `×` on an individual chip. Value-level rather than
 * token-level, so dismissing `label:a` out of `label:a,b` leaves `label:b` standing.
 * `key` is the qualifier as literally typed (so "is" for state/kind/draft); null = a free-text word.
 */
export function dropValue(text: string, key: string | null, value: string, neg = false): string {
  const kept: string[] = [];
  for (const tok of tokenize(text)) {
    if (tok.key === null) {
      if (key === null && tok.value.toLowerCase() === value.toLowerCase()) continue;
      kept.push(renderToken(tok));
      continue;
    }
    if (key !== null && normKey(tok.key) === normKey(key) && tok.neg === neg) {
      const vals = splitValues(tok.value).filter((v) => v.toLowerCase() !== value.toLowerCase());
      if (vals.length) {
        kept.push(
          `${neg ? "-" : ""}${quoteIfNeeded(tok.key)}:${vals.map(quoteIfNeeded).join(",")}`,
        );
      }
      continue;
    }
    kept.push(renderToken(tok));
  }
  return kept.join(" ").trim();
}

/** Drop every qualifier and word — the Reset button. */
export function clearAll(): string {
  return "";
}
