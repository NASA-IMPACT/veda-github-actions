// When is the work? Bars on a date axis, grouped by whatever you pick.
//
// Only 123 of this board's 408 items carry explicit Start/End dates, so falling straight through
// to created->closed would draw a mostly-meaningless chart. Iterations already carry a window
// (startDate + duration), so the date source falls back Start/End -> Sprint -> Program Increment
// -> created->closed, and every bar says which source it used. You can also pin one source.

import { useMemo, useState } from "react";
import { optionHex, personColor } from "../colors";
import { fieldText } from "../filter";
import type { BoardDoc, BoardItem, IterationWindow } from "../types";

interface Props {
  board: BoardDoc;
  items: BoardItem[];
  group: string;
  onGroup: (next: string) => void;
  onOpen: (id: string) => void;
}

const DAY = 86_400_000;
const NO_GROUP = "(none)";

type SourceId = "auto" | "dates" | "iteration" | "activity";

interface Span {
  item: BoardItem;
  from: number;
  to: number;
  source: string;
}

function toDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value.length <= 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(ms) ? null : Math.floor(ms / DAY) * DAY;
}

function iterationSpan(value: unknown): { from: number; to: number } | null {
  if (!value || typeof value !== "object") return null;
  const it = value as IterationWindow;
  const from = toDay(it.startDate);
  if (from == null) return null;
  return { from, to: from + Math.max(1, it.duration ?? 1) * DAY - DAY };
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ms: number): string {
  const d = new Date(ms);
  const month = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
  return d.getUTCMonth() === 0 ? `${month} ${d.getUTCFullYear()}` : month;
}

export default function TimelineView({ board, items, group, onGroup, onOpen }: Props) {
  const [source, setSource] = useState<SourceId>("auto");

  const dateFields = board.fields.filter((f) => f.type === "date");
  const iterationFields = board.fields.filter((f) => f.type === "iteration");
  const startField = dateFields.find((f) => /start/i.test(f.name)) ?? dateFields[0];
  const endField = dateFields.find((f) => /end|due|target/i.test(f.name)) ?? dateFields[1];
  // Prefer the shortest iteration (a sprint) over the longest (a PI) for bar geometry.
  const [shortIter, longIter] = [...iterationFields].sort(
    (a, b) => (a.iterations?.[0]?.duration ?? 99) - (b.iterations?.[0]?.duration ?? 99),
  );

  const groupOptions = [
    NO_GROUP,
    "Assignee",
    "Repo",
    ...board.fields.filter((f) => f.type === "single_select" || f.type === "iteration").map((f) => f.name),
  ];

  const { spans, undated } = useMemo(() => {
    const out: Span[] = [];
    let missing = 0;
    for (const item of items) {
      let span: { from: number; to: number } | null = null;
      let used = "";

      const from = startField ? toDay(fieldText(item.fields[startField.name])) : null;
      const to = endField ? toDay(fieldText(item.fields[endField.name])) : null;
      if ((source === "auto" || source === "dates") && (from != null || to != null)) {
        span = { from: from ?? to!, to: to ?? from! };
        used = `${startField?.name ?? "date"}/${endField?.name ?? "date"}`;
      }
      if (!span && (source === "auto" || source === "iteration")) {
        for (const f of [shortIter, longIter]) {
          if (!f) continue;
          const it = iterationSpan(item.fields[f.name]);
          if (it) {
            span = it;
            used = f.name;
            break;
          }
        }
      }
      if (!span && (source === "auto" || source === "activity")) {
        const created = toDay(item.created);
        if (created != null) {
          span = { from: created, to: toDay(item.closed) ?? Date.now() };
          used = item.closed ? "created → closed" : "created → today";
        }
      }
      if (!span || span.to < span.from) {
        if (!span) missing++;
        if (!span) continue;
        span = { from: span.to, to: span.from };
      }
      out.push({ item, from: span.from, to: span.to, source: used });
    }
    return { spans: out, undated: missing };
  }, [items, source, startField, endField, shortIter, longIter]);

  const range = useMemo(() => {
    if (!spans.length) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const s of spans) {
      min = Math.min(min, s.from);
      max = Math.max(max, s.to);
    }
    // Snap outward to whole months so the axis ticks line up with the bars.
    const lo = Date.UTC(new Date(min).getUTCFullYear(), new Date(min).getUTCMonth(), 1);
    const hiDate = new Date(max);
    const hi = Date.UTC(hiDate.getUTCFullYear(), hiDate.getUTCMonth() + 1, 1);
    return { lo, hi, width: Math.max(DAY, hi - lo) };
  }, [spans]);

  const groups = useMemo(() => {
    const keyOf = (item: BoardItem): string => {
      if (group === NO_GROUP) return "";
      if (group === "Assignee") return item.assignees[0] ?? "Unassigned";
      if (group === "Repo") return item.repo ? item.repo.split("/")[1] : "—";
      return fieldText(item.fields[group]) || "—";
    };
    const map = new Map<string, Span[]>();
    for (const s of spans) {
      const key = keyOf(s.item);
      const list = map.get(key);
      if (list) list.push(s);
      else map.set(key, [s]);
    }
    for (const list of map.values()) list.sort((a, b) => a.from - b.from || a.to - b.to);
    return [...map.entries()].sort((a, b) => {
      if (a[0] === "—" || a[0] === "Unassigned") return 1;
      if (b[0] === "—" || b[0] === "Unassigned") return -1;
      return b[1].length - a[1].length || a[0].localeCompare(b[0]);
    });
  }, [spans, group]);

  if (!range) {
    return (
      <div className="timelineview">
        <TimelineTools
          group={group}
          groupOptions={groupOptions}
          onGroup={onGroup}
          source={source}
          onSource={setSource}
          note=""
        />
        <p className="empty">
          Nothing here has a date under the current query and date source. Try the “Auto” source,
          which falls back to the sprint window and then to created → closed.
        </p>
      </div>
    );
  }

  const pct = (ms: number) => ((ms - range.lo) / range.width) * 100;

  // Month ticks across the whole span.
  const months: number[] = [];
  for (let d = range.lo; d < range.hi; ) {
    months.push(d);
    const nd = new Date(d);
    d = Date.UTC(nd.getUTCFullYear(), nd.getUTCMonth() + 1, 1);
  }

  // Iteration bands from the long iteration field (the PI), so the eye can find a program window.
  const bands = (longIter?.iterations ?? [])
    .map((it) => {
      const span = iterationSpan(it);
      return span ? { title: it.title, ...span } : null;
    })
    .filter((b): b is { title: string; from: number; to: number } => b !== null)
    .filter((b) => b.to >= range.lo && b.from <= range.hi);

  const today = Date.now();
  const todayInRange = today >= range.lo && today <= range.hi;
  const statusField = board.fields.find((f) => f.type === "single_select");

  function barColor(item: BoardItem): string {
    if (group === "Assignee" && item.assignees[0]) return personColor(item.assignees[0]);
    const option = statusField?.options?.find((o) => o.name === fieldText(item.fields[statusField.name]));
    if (option) return optionHex(option.color);
    return item.state === "open" ? "#1a7f37" : "#8250df";
  }

  return (
    <div className="timelineview">
      <TimelineTools
        group={group}
        groupOptions={groupOptions}
        onGroup={onGroup}
        source={source}
        onSource={setSource}
        note={`${spans.length} dated${undated ? ` · ${undated} with no usable date, hidden` : ""}`}
      />

      <div className="tl">
        <div className="tl-axis">
          <div className="tl-gutter" />
          <div className="tl-track">
            {months.map((m) => (
              <span key={monthKey(m)} className="tl-tick" style={{ left: `${pct(m)}%` }}>
                {monthLabel(m)}
              </span>
            ))}
          </div>
        </div>

        {groups.map(([name, list]) => (
          <div key={name || "_"} className="tl-group">
            {name && (
              <div className="tl-group-head">
                <span className="tl-gutter tl-group-name" title={name}>
                  {name} <span className="muted">{list.length}</span>
                </span>
              </div>
            )}
            {list.map((s) => (
              <div key={s.item.id} className="tl-row">
                <button
                  className="tl-gutter tl-label linkbtn"
                  onClick={() => onOpen(s.item.id)}
                  title={s.item.title}
                >
                  {s.item.title}
                </button>
                <div className="tl-track">
                  {bands.map((b) => (
                    <span
                      key={b.title}
                      className="tl-band"
                      style={{ left: `${pct(b.from)}%`, width: `${pct(b.to) - pct(b.from)}%` }}
                    />
                  ))}
                  {todayInRange && <span className="tl-today" style={{ left: `${pct(today)}%` }} />}
                  <button
                    className={s.item.state === "open" ? "tl-bar" : "tl-bar done"}
                    style={{
                      left: `${pct(s.from)}%`,
                      // A same-day span would render zero-width; floor it so it stays clickable.
                      width: `${Math.max(0.6, pct(s.to) - pct(s.from))}%`,
                      background: barColor(s.item),
                    }}
                    onClick={() => onOpen(s.item.id)}
                    title={`${s.item.title}\n${new Date(s.from).toISOString().slice(0, 10)} → ${new Date(
                      s.to,
                    ).toISOString().slice(0, 10)}  (${s.source})`}
                  />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="tl-legend">
        {bands.length > 0 && (
          <span>
            <span className="tl-band swatch" /> {longIter?.name ?? "iteration"} windows
          </span>
        )}
        {todayInRange && (
          <span>
            <span className="tl-today swatch" /> today
          </span>
        )}
        <span className="muted">
          Bar colour = {group === "Assignee" ? "assignee" : (statusField?.name ?? "state")}
        </span>
      </div>
    </div>
  );
}

function TimelineTools({
  group,
  groupOptions,
  onGroup,
  source,
  onSource,
  note,
}: {
  group: string;
  groupOptions: string[];
  onGroup: (v: string) => void;
  source: SourceId;
  onSource: (v: SourceId) => void;
  note: string;
}) {
  return (
    <div className="table-tools">
      <label className="inline-field">
        Group by
        <select value={group} onChange={(e) => onGroup(e.target.value)}>
          {groupOptions.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-field">
        Dates from
        <select value={source} onChange={(e) => onSource(e.target.value as SourceId)}>
          <option value="auto">Auto (dates → sprint → activity)</option>
          <option value="dates">Start / End fields only</option>
          <option value="iteration">Sprint / PI only</option>
          <option value="activity">Created → closed</option>
        </select>
      </label>
      {note && <span className="muted note">{note}</span>}
    </div>
  );
}
