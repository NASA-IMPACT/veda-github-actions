// Unit test for the query grammar + the filter predicates, run against the REAL board snapshot in
// public/data/. No test framework and no dev dependency: Node strips the TypeScript types itself.
//
// Run:  node board-explorer/scripts/test_search.ts
//
// This covers the fiddly half of the app — tokenizing quotes, comma-OR vs repeated-AND, negation,
// no:/has:, date bounds, and the write-back that lets a picker edit the query text without
// disturbing anything else in it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  clearQualifier,
  parseQuery,
  setDraft,
  setQualifier,
  toggleQualifier,
  tokenize,
} from "../src/search.ts";
import { activeCount, applyQuery } from "../src/filter.ts";
import { itemsToCsv } from "../src/csv.ts";
import type { BoardDoc } from "../src/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const board: BoardDoc = JSON.parse(
  readFileSync(join(HERE, "..", "public", "data", "board_disasters-learning-portal-5.json"), "utf8"),
);

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, a === e ? "" : `got ${a}, want ${e}`);
}

const run = (q: string) => applyQuery(board.items, parseQuery(q, board), board);

// ---- tokenizer ----------------------------------------------------------------------
eq("bare words tokenize as free text", tokenize("hello world").map((t) => [t.key, t.value]),
   [[null, "hello"], [null, "world"]]);
eq("a quoted phrase stays one token", tokenize('"hello world"').map((t) => t.value), ["hello world"]);
eq("qualifier splits on the first colon", tokenize("repo:owner/name").map((t) => [t.key, t.value]),
   [["repo", "owner/name"]]);
eq("a quoted key with a space survives", tokenize('"program increment":"PI 26.3"').map((t) => [t.key, t.value]),
   [["program increment", "PI 26.3"]]);
eq("a leading dash marks negation", tokenize("-label:bug").map((t) => [t.neg, t.key, t.value]),
   [[true, "label", "bug"]]);
eq("a colon inside quotes is not a separator", tokenize('"a:b"').map((t) => [t.key, t.value]),
   [[null, "a:b"]]);

// ---- parsing ------------------------------------------------------------------------
eq("is:open lands in the state facet", parseQuery("is:open", board).facets.state?.include, [["open"]]);
eq("is:pr lands in the kind facet", parseQuery("is:pr", board).facets.kind?.include, [["pr"]]);
check("is:draft is a boolean, not a state", parseQuery("is:draft", board).draft === true);
check("-is:draft negates it", parseQuery("-is:draft", board).draft === false);
eq("is:open,pr splits across the facets it constrains",
   [parseQuery("is:open,pr", board).facets.state?.include, parseQuery("is:open,pr", board).facets.kind?.include],
   [[["open"]], [["pr"]]]);
// The two ways of writing several values mean OPPOSITE things — one group vs several.
eq("comma is OR — one group", parseQuery("assignee:a,b", board).facets.assignee?.include, [["a", "b"]]);
eq("repeating a qualifier is AND — one group each",
   parseQuery("label:x label:y", board).facets.label?.include, [["x"], ["y"]]);
eq("negation fills exclude, not include",
   [parseQuery("-label:bug", board).facets.label?.include, parseQuery("-label:bug", board).facets.label?.exclude],
   [[], ["bug"]]);
check("no:assignee sets empty=true", parseQuery("no:assignee", board).facets.assignee?.empty === true);
check("has:assignee sets empty=false", parseQuery("has:assignee", board).facets.assignee?.empty === false);
check("-no:assignee is the same as has:assignee",
      parseQuery("-no:assignee", board).facets.assignee?.empty === false);
eq("a board field is addressable by its exact name",
   parseQuery('Status:Done', board).facets.Status?.include, [["Done"]]);
eq("...and by a normalized name", parseQuery("programincrement:'x'", board).facets["Program Increment"]
   ? Object.keys(parseQuery("programincrement:y", board).facets) : [], ["Program Increment"]);
eq("a date bound resolves to an absolute day",
   parseQuery("updated:>@today-7d", board, new Date("2026-08-19T00:00:00Z")).facets.updated?.bounds,
   [{ op: ">", date: "2026-08-12" }]);
eq("an ISO date bound passes through",
   parseQuery("updated:<=2026-01-31", board).facets.updated?.bounds, [{ op: "<=", date: "2026-01-31" }]);
check("an unknown qualifier is reported AND falls back to free text", (() => {
  const p = parseQuery("bogus:thing", board);
  return p.unknown.length === 1 && p.text.includes("bogus:thing");
})());

// ---- filtering against the real board ------------------------------------------------
const all = board.items.length;
check("no query matches everything", run("").length === all, `${all}`);

const open = run("is:open").length;
const closed = run("is:closed").length;
const merged = run("is:merged").length;
check("is:open matches the generator's open count", open === board.stats.open, `${open} vs ${board.stats.open}`);
check("open + closed + merged accounts for every item",
      open + closed + merged === all, `${open}+${closed}+${merged} vs ${all}`);
check("is:merged is a strict subset of the PRs, never an issue",
      run("is:merged").every((i) => i.kind === "pr"));
check("a draft PR is still found by is:open",
      run("is:open").filter((i) => i.draft).length === run("is:draft is:open").length);

check("is:issue + is:pr + is:draft partitions the board",
      run("is:issue").length + run("is:pr").length + board.items.filter((i) => i.kind === "draft").length === all);

const withAssignee = run("has:assignee").length;
const without = run("no:assignee").length;
check("has:assignee and no:assignee are complements",
      withAssignee + without === all, `${withAssignee}+${without} vs ${all}`);

const person = board.people[0].login;
const mine = run(`assignee:${person}`);
check(`assignee:${person} returns only their items`,
      mine.length > 0 && mine.every((i) => i.assignees.includes(person)), `${mine.length} items`);
check("negating the same assignee returns the complement",
      run(`-assignee:${person}`).length === all - mine.length);

const label = board.labels[0].name;
check(`label:${label} matches only items carrying it`,
      run(`label:${label}`).every((i) => i.labels.includes(label)));

// The heart of the grammar: the same two values mean different things depending on how written.
const [l1, l2] = [board.labels[0].name, board.labels[1].name];
const either = run(`label:${l1},${l2}`);
const both = run(`label:${l1} label:${l2}`);
check("comma-OR is a superset of repeated-AND",
      both.length <= either.length && either.length > 0, `either=${either.length} both=${both.length}`);
check("comma-OR matches items carrying EITHER label",
      either.every((i) => i.labels.includes(l1) || i.labels.includes(l2)));
check("repeated-AND matches only items carrying BOTH labels",
      both.every((i) => i.labels.includes(l1) && i.labels.includes(l2)));
check("a self-contradictory query returns nothing, not everything",
      run("is:open is:closed").length === 0, `${run("is:open is:closed").length}`);
check("is:open,closed (comma) still means either",
      run("is:open,closed").length === run("is:open").length + run("is:closed").length);

const repoShort = board.repos[0].split("/")[1];
check("repo: accepts the bare repo name as well as owner/name",
      run(`repo:${repoShort}`).length === run(`repo:${board.repos[0]}`).length);

check("Status:Done narrows to the Done column",
      run("Status:Done").every((i) => i.fields["Status"] === "Done"));
check("a two-word field name works when quoted",
      run('"Program Increment":"PI 26.3"').every(
        (i) => (i.fields["Program Increment"] as { title: string } | undefined)?.title === "PI 26.3"));

check("free text narrows", run("portal").length > 0 && run("portal").length < all,
      `${run("portal").length} of ${all}`);
check("two words are ANDed, never ORed",
      run("portal hosting").length <= run("portal").length);
check("free text finds an item by its number", (() => {
  const item = board.items.find((i) => i.number !== null && i.kind === "issue")!;
  return run(String(item.number)).some((i) => i.id === item.id);
})());
check("qualifiers compose with free text",
      run("is:open Status:Todo").every((i) => i.state === "open" && i.fields["Status"] === "Todo"));

// ---- write-back ---------------------------------------------------------------------
eq("setQualifier appends when absent", setQualifier("is:open", "label", ["bug"]), "is:open label:bug");
eq("setQualifier replaces when present", setQualifier("label:old is:open", "label", ["new"]), "is:open label:new");
eq("setQualifier removes on empty", setQualifier("label:old is:open", "label", []), "is:open");
eq("setQualifier quotes values that need it",
   setQualifier("", "milestone", ["QA release"]), 'milestone:"QA release"');
eq("state writes through is: and leaves other is: values alone",
   setQualifier("is:open,pr", "state", ["closed"]), "is:pr is:closed");
eq("kind writes through is: without disturbing the state",
   setQualifier("is:open", "kind", ["pr"]), "is:open is:pr");
eq("free text survives a picker edit",
   setQualifier("portal hosting label:x", "label", ["y"]), "portal hosting label:y");
eq("toggling an already-selected value removes it",
   toggleQualifier("label:bug", "label", "bug", board), "");
eq("toggling a new value adds it", toggleQualifier("label:bug", "label", "dse", board), "label:bug,dse");
eq("clearQualifier drops just that one", clearQualifier("is:open label:bug", "label"), "is:open");
eq("setDraft(true) writes is:draft", setDraft("is:open", true), "is:open is:draft");
eq("setDraft(false) writes -is:draft", setDraft("", false), "-is:draft");
eq("setDraft(undefined) removes it", setDraft("is:draft is:open", undefined), "is:open");

eq("activeCount counts distinct narrowings", activeCount(parseQuery("is:open label:bug portal", board)), 3);
eq("an empty query is not narrowing", activeCount(parseQuery("", board)), 0);

// ---- CSV export ----------------------------------------------------------------------
const csv = itemsToCsv(run("is:open"), board.fields);
const lines = csv.trimEnd().split("\n");
check("CSV has a header plus one line per shown item — never the whole board",
      lines.length === run("is:open").length + 1, `${lines.length - 1} rows vs ${run("is:open").length}`);
check("CSV header carries every board field as its own column",
      board.fields.every((f) => lines[0].includes(f.name)), lines[0]);
check("a value containing a comma is quoted, not left to split the row", (() => {
  const withComma = board.items.find((i) => i.title.includes(","));
  if (!withComma) return true;
  const one = itemsToCsv([withComma], board.fields).split("\n")[1];
  return one.includes(`"${withComma.title.replace(/"/g, '""')}"`);
})());
check("a value containing a quote is escaped by doubling", (() => {
  const one = itemsToCsv(
    [{ ...board.items[0], title: 'He said "hi", loudly' }],
    board.fields,
  ).split("\n")[1];
  return one.includes('"He said ""hi"", loudly"');
})());
check("every CSV row has the same number of fields as the header", (() => {
  // Count only the commas that sit outside quotes — the whole point of the quoting.
  const fieldsIn = (line: string) => {
    let n = 1, inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) n++;
    }
    return n;
  };
  const want = fieldsIn(lines[0]);
  return lines.every((l) => fieldsIn(l) === want);
})());

console.log(`\n${failed} failed`);
process.exit(failed ? 1 : 0);
