// The search box, the facet pickers, the quick pills, and the chip row — all of which read and
// write the ONE query string (see search.ts). Nothing here holds filter state of its own, which is
// why the box and the chips can never drift apart.

import { useMemo, useRef, useState } from "react";
import MultiPicker, { type PickerOption } from "./MultiPicker";
import { useClickAway } from "../useClickAway";
import { optionHex, personColor } from "../colors";
import { facetCounts, fieldText } from "../filter";
import {
  clearAll,
  dropValue,
  includedValues,
  setQualifier,
  toggleQualifier,
  type ParsedQuery,
} from "../search";
import type { BoardDoc } from "../types";
import type { RefObject } from "react";

interface Props {
  board: BoardDoc;
  q: string;
  onQ: (next: string) => void;
  parsed: ParsedQuery;
  shown: number;
  searchRef: RefObject<HTMLInputElement>;
}

const KIND_LABEL: Record<string, string> = { issue: "Issues", pr: "Pull requests", draft: "Drafts" };
const STATE_LABEL: Record<string, string> = { open: "Open", closed: "Closed", merged: "Merged" };

export default function FilterBar({ board, q, onQ, parsed, shown, searchRef }: Props) {
  const [showHelp, setShowHelp] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  useClickAway(helpRef, () => setShowHelp(false), showHelp);

  const counts = useMemo(() => {
    const c = (key: string, valuesOf: Parameters<typeof facetCounts>[4]) =>
      facetCounts(board.items, parsed, board, key, valuesOf);
    return {
      state: c("state", (i) => [i.state]),
      kind: c("kind", (i) => [i.kind]),
      assignee: c("assignee", (i) => i.assignees),
      label: c("label", (i) => i.labels),
      repo: c("repo", (i) => (i.repo ? [i.repo] : [])),
      milestone: c("milestone", (i) => (i.milestone ? [i.milestone] : [])),
      fields: Object.fromEntries(
        board.fields.map((f) => [
          f.name,
          c(f.name, (i) => {
            const v = fieldText(i.fields[f.name]);
            return v ? [v] : [];
          }),
        ]),
      ),
    };
  }, [board, parsed]);

  const inc = (key: string) => includedValues(parsed.facets[key]);
  const set = (key: string, values: string[]) => onQ(setQualifier(q, key, values));

  const opts = (
    values: string[],
    countMap: Map<string, number>,
    color?: (v: string) => string,
    label?: (v: string) => string,
  ): PickerOption[] =>
    values
      .map((v) => ({ id: v, label: label ? label(v) : v, color: color?.(v), count: countMap.get(v) ?? 0 }))
      // An option nothing could match is noise; keep it only when it is currently selected.
      .filter((o) => o.count > 0 || inc(o.id).length > 0)
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));

  // ---- the chip row: every active narrowing, whatever typed or clicked it into being --------
  type Chip = { text: string; title: string; remove: () => void };
  const chips: Chip[] = [];
  const chipFor = (literal: string, value: string, neg = false): Chip => ({
    text: `${neg ? "-" : ""}${literal}:${value}`,
    title: `Remove ${neg ? "-" : ""}${literal}:${value}`,
    remove: () => onQ(dropValue(q, literal, value, neg)),
  });
  for (const [key, facet] of Object.entries(parsed.facets)) {
    const literal = key === "state" || key === "kind" ? "is" : key;
    for (const v of facet.include.flat()) chips.push(chipFor(literal, v));
    for (const v of facet.exclude) chips.push(chipFor(literal, v, true));
    if (facet.empty !== undefined) {
      const word = facet.empty ? "no" : "has";
      chips.push({
        text: `${word}:${key}`,
        title: `Remove ${word}:${key}`,
        remove: () => onQ(dropValue(dropValue(q, "no", key), "has", key)),
      });
    }
    for (const b of facet.bounds ?? []) {
      chips.push({
        text: `${key}:${b.op}${b.date}`,
        title: `Remove the ${key} date filter`,
        remove: () => onQ(setQualifier(q, key, [])),
      });
    }
  }
  if (parsed.draft !== undefined) {
    chips.push({
      text: `${parsed.draft ? "" : "-"}is:draft`,
      title: "Remove the draft filter",
      remove: () => onQ(dropValue(q, "is", "draft", !parsed.draft)),
    });
  }
  for (const w of parsed.text) {
    chips.push({ text: `"${w}"`, title: `Remove the word ${w}`, remove: () => onQ(dropValue(q, null, w)) });
  }

  // ---- quick pills: the handful of narrowings people reach for constantly -------------------
  const pills: { label: string; on: boolean; apply: () => void }[] = [
    {
      label: "Open",
      on: inc("state").some((v) => v.toLowerCase() === "open"),
      apply: () => onQ(toggleQualifier(q, "state", "open", board)),
    },
    {
      label: "Unassigned",
      on: parsed.facets.assignee?.empty === true,
      apply: () =>
        onQ(
          parsed.facets.assignee?.empty === true
            ? dropValue(q, "no", "assignee")
            : `${dropValue(q, "no", "assignee")} no:assignee`.trim(),
        ),
    },
    {
      label: "Updated this week",
      on: (parsed.facets.updated?.bounds?.length ?? 0) > 0,
      apply: () =>
        onQ(
          (parsed.facets.updated?.bounds?.length ?? 0) > 0
            ? setQualifier(q, "updated", [])
            : `${setQualifier(q, "updated", [])} updated:>@today-7d`.trim(),
        ),
    },
  ];

  const active = chips.length;

  return (
    <div className="filterbar">
      <div className="toolbar">
        <div className="search">
          <span className="search-ico" aria-hidden>🔍</span>
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Search title, body, people… or type is:open assignee:you label:bug"
            aria-label="Search and filter the board"
            spellCheck={false}
          />
          {q && (
            <button className="search-x" onClick={() => onQ(clearAll())} aria-label="Clear search">
              ×
            </button>
          )}
        </div>

        <div className="control" ref={helpRef}>
          <button
            type="button"
            className="btn iconbtn"
            onClick={() => setShowHelp((s) => !s)}
            title="Query syntax"
            aria-label="Query syntax help"
            aria-expanded={showHelp}
          >
            ?
          </button>
          {showHelp && <SyntaxHelp board={board} onPick={(text) => { onQ(text); setShowHelp(false); }} />}
        </div>

        <button
          type="button"
          className="btn reset-btn"
          onClick={() => onQ(clearAll())}
          disabled={!active}
        >
          ↺ Reset{active ? ` (${active})` : ""}
        </button>
      </div>

      <div className="pillrow">
        {pills.map((p) => (
          <button
            key={p.label}
            type="button"
            className={p.on ? "pill on" : "pill"}
            onClick={p.apply}
          >
            {p.label}
          </button>
        ))}

        <MultiPicker
          label="states"
          icon="◍"
          options={opts(["open", "closed", "merged"], counts.state, undefined, (v) => STATE_LABEL[v] ?? v)}
          selected={inc("state")}
          onChange={(v) => set("state", v)}
        />
        <MultiPicker
          label="types"
          icon="◈"
          options={opts(["issue", "pr", "draft"], counts.kind, undefined, (v) => KIND_LABEL[v] ?? v)}
          selected={inc("kind")}
          onChange={(v) => set("kind", v)}
        />
        <MultiPicker
          label="assignees"
          icon="👤"
          searchable
          options={opts(board.people.map((p) => p.login), counts.assignee, personColor, (v) => {
            const p = board.people.find((x) => x.login === v);
            return p && p.name !== v ? `${p.name} · ${v}` : v;
          })}
          selected={inc("assignee")}
          onChange={(v) => set("assignee", v)}
        />
        <MultiPicker
          label="labels"
          icon="🏷"
          searchable
          options={opts(
            board.labels.map((l) => l.name),
            counts.label,
            (v) => `#${board.labels.find((l) => l.name === v)?.color ?? "888888"}`,
          )}
          selected={inc("label")}
          onChange={(v) => set("label", v)}
        />
        <MultiPicker
          label="repos"
          icon="📁"
          searchable
          options={opts(board.repos, counts.repo, undefined, (v) => v.split("/")[1] ?? v)}
          selected={inc("repo")}
          onChange={(v) => set("repo", v)}
        />

        {board.fields.map((f) => {
          // A picker listing every distinct raw date is noise, not a filter — date fields are
          // served by the grammar instead (`Start Date:>2026-01-01`) and by the table column.
          if (f.type === "date") return null;
          const values =
            f.options?.map((o) => o.name) ??
            f.iterations?.map((i) => i.title) ??
            [...(counts.fields[f.name]?.keys() ?? [])];
          if (!values.length) return null;
          const color = f.options
            ? (v: string) => optionHex(f.options!.find((o) => o.name === v)?.color)
            : undefined;
          return (
            <MultiPicker
              key={f.name}
              label={f.name.toLowerCase()}
              options={opts(values, counts.fields[f.name] ?? new Map(), color)}
              selected={inc(f.name)}
              onChange={(v) => set(f.name, v)}
              searchable={values.length > 12}
            />
          );
        })}
      </div>

      {chips.length > 0 && (
        <div className="chosen">
          {chips.map((c, idx) => (
            <button key={`${c.text}-${idx}`} type="button" className="chosen-chip"
                    onClick={c.remove} title={c.title}>
              {c.text} <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}

      <div className="count-strip">
        <strong>{shown}</strong> of {board.items.length} items
        {parsed.unknown.length > 0 && (
          <span className="warn" title="These were searched as plain text instead">
            · unrecognized qualifier: {parsed.unknown.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

function SyntaxHelp({ board, onPick }: { board: BoardDoc; onPick: (q: string) => void }) {
  const field = board.fields.find((f) => f.type === "single_select");
  const example = field?.options?.[0] ? `${field.name}:${field.options[0].name}` : "Status:Todo";
  const rows: [string, string][] = [
    ["is:open", "open items (also is:closed, is:merged)"],
    ["is:pr", "only pull requests (also is:issue, is:draft)"],
    ["assignee:octocat", "assigned to someone"],
    ["no:assignee", "unassigned (also has:assignee)"],
    ["label:bug,dse", "either label — comma is OR"],
    ["label:bug label:dse", "both labels — repeating is AND"],
    ["-label:bug", "not this label"],
    [example, "any board field, by its own name"],
    ['"Program Increment":"PI 26.4"', "quote names or values with spaces"],
    ["updated:>@today-7d", "changed in the last week"],
    ["portal hosting", "plain words search title and body"],
  ];
  return (
    <div className="popover panel help">
      <p className="help-intro">
        This is GitHub's own Projects filter syntax — the same thing the board's filter box takes.
        Every picker below writes into this one query, so typing and clicking stay in step.
      </p>
      <table>
        <tbody>
          {rows.map(([syntax, what]) => (
            <tr key={syntax}>
              <td>
                <button type="button" className="linkbtn" onClick={() => onPick(syntax)}>
                  <code>{syntax}</code>
                </button>
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="help-foot">
        Not supported: wildcards (<code>label:*bug*</code>), ranges (<code>points:1..3</code>) and
        <code> @current</code>/<code>@next</code> iterations.
      </p>
    </div>
  );
}
