// The dense grid. This is the view that does most of the "easier to see than GitHub" work:
// every item on one screen, sortable by any column, with the columns you care about and none of
// the ones you don't.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar, FieldChip, LabelChip, StateBadge, SubProgress } from "../components/Chips";
import { useClickAway } from "../useClickAway";
import { fieldSortKey, fieldText } from "../filter";
import type { BoardDoc, BoardItem } from "../types";

interface Props {
  board: BoardDoc;
  items: BoardItem[];
  sort: string;
  onSort: (next: string) => void;
  onOpen: (id: string) => void;
  onQualify: (key: string, value: string) => void;
}

interface Column {
  key: string;
  label: string;
  /** Sort key; undefined means the column is not sortable. */
  value?: (i: BoardItem) => string | number;
  render: (i: BoardItem) => ReactNode;
  className?: string;
}

const STORE_KEY = "board-explorer:columns";

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** "3 days ago" beats a timestamp when you are scanning 400 rows for what moved. */
function ago(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function TableView({ board, items, sort, onSort, onOpen, onQualify }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useClickAway(pickerRef, () => setPickerOpen(false), pickerOpen);

  const columns: Column[] = useMemo(() => {
    const base: Column[] = [
      {
        key: "state",
        label: "State",
        value: (i) => `${i.state}${i.draft ? "-draft" : ""}`,
        render: (i) => <StateBadge item={i} />,
        className: "col-state",
      },
      {
        key: "number",
        label: "#",
        value: (i) => i.number ?? 0,
        render: (i) => (i.number == null ? <span className="muted">—</span> : `#${i.number}`),
        className: "col-num",
      },
      {
        key: "title",
        label: "Title",
        value: (i) => i.title.toLowerCase(),
        render: (i) => (
          <span className="cell-title">
            <span className="cell-title-text">{i.title}</span>
            {i.sub && <SubProgress sub={i.sub} />}
            {i.comments > 0 && (
              <span className="muted comments" title={`${i.comments} comments`}>
                💬 {i.comments}
              </span>
            )}
          </span>
        ),
        className: "col-title",
      },
      {
        key: "assignees",
        label: "Assignees",
        value: (i) => i.assignees.join(","),
        render: (i) =>
          i.assignees.length === 0 ? (
            <span className="muted">unassigned</span>
          ) : (
            <span className="avatars">
              {i.assignees.map((login) => (
                <Avatar
                  key={login}
                  login={login}
                  person={board.people.find((p) => p.login === login)}
                  onClick={() => onQualify("assignee", login)}
                />
              ))}
            </span>
          ),
        className: "col-assignees",
      },
      {
        key: "labels",
        label: "Labels",
        value: (i) => i.labels.join(","),
        render: (i) => (
          <span className="chips">
            {i.labels.map((name) => (
              <LabelChip
                key={name}
                name={name}
                color={board.labels.find((l) => l.name === name)?.color ?? "888888"}
                onClick={() => onQualify("label", name)}
              />
            ))}
          </span>
        ),
        className: "col-labels",
      },
      {
        key: "repo",
        label: "Repo",
        value: (i) => i.repo,
        render: (i) =>
          i.repo ? (
            <button className="linkbtn" onClick={() => onQualify("repo", i.repo)} title={i.repo}>
              {i.repo.split("/")[1] ?? i.repo}
            </button>
          ) : (
            <span className="muted">—</span>
          ),
        className: "col-repo",
      },
    ];

    const fieldCols: Column[] = board.fields.map((f) => ({
      key: `field:${f.name}`,
      label: f.name,
      value: (i) => fieldSortKey(i.fields[f.name]),
      render: (i) => (
        <FieldChip field={f} value={i.fields[f.name]} onClick={() => {
          const v = fieldText(i.fields[f.name]);
          if (v) onQualify(f.name, v);
        }} />
      ),
      className: "col-field",
    }));

    const tail: Column[] = [
      {
        key: "milestone",
        label: "Milestone",
        value: (i) => i.milestone ?? "",
        render: (i) => (i.milestone ? <span className="chip plain">{i.milestone}</span> : null),
        className: "col-milestone",
      },
      {
        key: "updated",
        label: "Updated",
        value: (i) => i.updated ?? "",
        render: (i) => <span title={i.updated ?? ""}>{ago(i.updated)}</span>,
        className: "col-date",
      },
      {
        key: "created",
        label: "Created",
        value: (i) => i.created ?? "",
        render: (i) => <span title={i.created ?? ""}>{ago(i.created)}</span>,
        className: "col-date",
      },
    ];
    return [...base, ...fieldCols, ...tail];
  }, [board, onQualify]);

  const visible = columns.filter((c) => !hidden.has(c.key));

  const [sortKey, sortDir] = sort.split(":") as [string, "asc" | "desc"];
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.value) return items;
    const dir = sortDir === "asc" ? 1 : -1;
    // Slice first: the caller's array is memoized upstream and must not be sorted in place.
    return [...items].sort((a, b) => {
      const av = col.value!(a);
      const bv = col.value!(b);
      // Blanks always sink, whichever way the column is pointing — an empty cell is not "lowest".
      if (av === "" && bv !== "") return 1;
      if (bv === "" && av !== "") return -1;
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }, [items, columns, sortKey, sortDir]);

  function toggleSort(key: string) {
    onSort(sortKey === key && sortDir === "desc" ? `${key}:asc` : `${key}:desc`);
  }

  function toggleColumn(key: string) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...next]));
    } catch {
      /* private mode — the choice just won't persist */
    }
  }

  return (
    <div className="tableview">
      <div className="table-tools">
        <div className="control" ref={pickerRef}>
          <button type="button" className="btn" onClick={() => setPickerOpen((o) => !o)}
                  aria-expanded={pickerOpen} aria-haspopup="true">
            ⚙ Columns ({visible.length}/{columns.length}) <span aria-hidden>▾</span>
          </button>
          {pickerOpen && (
            <div className="popover panel">
              <div className="actions">
                <span className="pop-count">{visible.length} shown</span>
                <button type="button" onClick={() => { setHidden(new Set()); localStorage.removeItem(STORE_KEY); }}>
                  Show all
                </button>
              </div>
              {columns.map((c) => (
                <label key={c.key} className="row">
                  <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleColumn(c.key)} />
                  <span className="row-name">{c.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="empty">
          Nothing matches this query. Drop a chip above, or clear the search — remember that
          repeating a qualifier (<code>label:a label:b</code>) means <em>both</em>, while a comma
          (<code>label:a,b</code>) means <em>either</em>.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                {visible.map((c) => (
                  <th key={c.key} className={c.className}>
                    {c.value ? (
                      <button type="button" className="th-sort" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        <span className="th-arrow" aria-hidden>
                          {sortKey === c.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                        </span>
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id} className={item.state === "open" ? "" : "row-done"}>
                  {visible.map((c) => (
                    <td key={c.key} className={c.className}>
                      {c.key === "title" ? (
                        <button type="button" className="rowbtn" onClick={() => onOpen(item.id)}>
                          {c.render(item)}
                        </button>
                      ) : (
                        c.render(item)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
