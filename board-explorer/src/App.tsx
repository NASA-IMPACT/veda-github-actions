import { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import FilterBar from "./components/FilterBar";
import ItemDetail from "./components/ItemDetail";
import TableView from "./views/TableView";
import AssigneeView from "./views/AssigneeView";
import TimelineView from "./views/TimelineView";
import { loadBoard, type LoadedBoard } from "./data";
import { applyQuery } from "./filter";
import { parseQuery, toggleQualifier } from "./search";
import { applyTheme, getInitialTheme } from "./theme";
import { downloadCsv, itemsToCsv } from "./csv";
import { DEFAULT_STATE, decodeHash, encodeHash, type ViewId, type ViewState } from "./urlState";

const VIEWS: { id: ViewId; label: string; icon: string }[] = [
  { id: "table", label: "Table", icon: "▤" },
  { id: "assignee", label: "By assignee", icon: "👥" },
  { id: "timeline", label: "Timeline", icon: "▭" },
];

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  useEffect(() => applyTheme(theme), [theme]);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState<LoadedBoard | null>(null);
  const [state, setState] = useState<ViewState>(() => ({ ...DEFAULT_STATE, ...decodeHash(window.location.hash) }));
  const [openId, setOpenId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadBoard()
      .then((d) => {
        setLoaded(d);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
  }, []);

  // Keep the URL in sync so the view can be copied and shared. replaceState, never pushState —
  // typing in the search box must not build up a history stack.
  useEffect(() => {
    if (status !== "ready") return;
    const hash = encodeHash(state);
    window.history.replaceState(null, "", hash || window.location.pathname + window.location.search);
  }, [state, status]);

  // `/` focuses the search box, the way it does on GitHub itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const doc = loaded?.doc ?? null;
  const parsed = useMemo(() => parseQuery(state.q, doc), [state.q, doc]);
  const items = useMemo(() => {
    if (!doc) return [];
    const pool = state.showArchived ? doc.items : doc.items.filter((i) => !i.archived);
    return applyQuery(pool, parsed, doc);
  }, [doc, parsed, state.showArchived]);

  const patch = (p: Partial<ViewState>) => setState((s) => ({ ...s, ...p }));

  /** Clicking any chip anywhere narrows the ONE query — same as typing the qualifier. */
  const qualify = (key: string, value: string) =>
    setState((s) => ({ ...s, q: toggleQualifier(s.q, key, value, doc) }));

  if (status === "loading") {
    return (
      <div className="app splash">
        <p>Loading the board…</p>
      </div>
    );
  }
  if (status === "error" || !doc || !loaded) {
    return (
      <div className="app splash">
        <h1>Could not load the board</h1>
        <p className="muted">{error || "No data source was reachable."}</p>
        <p className="muted">
          The app reads the <code>board-explorer/data</code> branch, then falls back to the snapshot
          bundled at build time. If neither is reachable, run the “Board Explorer sync” workflow.
        </p>
      </div>
    );
  }

  const open = openId ? (doc.items.find((i) => i.id === openId) ?? null) : null;

  return (
    <div className="app">
      <Header doc={doc} source={loaded.source} theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />

      <FilterBar
        board={doc}
        q={state.q}
        onQ={(q) => patch({ q })}
        parsed={parsed}
        shown={items.length}
        searchRef={searchRef}
      />

      <div className="viewbar">
        <div className="seg" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={state.view === v.id}
              className={state.view === v.id ? "active" : ""}
              onClick={() => patch({ view: v.id })}
            >
              <span aria-hidden>{v.icon}</span> {v.label}
            </button>
          ))}
        </div>

        <button
          className="btn"
          onClick={() =>
            downloadCsv(
              `board_${doc.board.owner}-${doc.board.number}_${items.length}items.csv`,
              itemsToCsv(items, doc.fields),
            )
          }
          disabled={items.length === 0}
          title="Export exactly these rows, with every board field"
        >
          ⭳ CSV
        </button>
      </div>

      <main>
        {state.view === "table" && (
          <TableView
            board={doc}
            items={items}
            sort={state.sort}
            onSort={(sort) => patch({ sort })}
            onOpen={setOpenId}
            onQualify={qualify}
          />
        )}
        {state.view === "assignee" && (
          <AssigneeView board={doc} items={items} onOpen={setOpenId} onQualify={qualify} />
        )}
        {state.view === "timeline" && (
          <TimelineView
            board={doc}
            items={items}
            group={state.group}
            onGroup={(group) => patch({ group })}
            onOpen={setOpenId}
          />
        )}
      </main>

      {open && <ItemDetail board={doc} item={open} onClose={() => setOpenId(null)} onQualify={qualify} />}

      <footer className="foot">
        <span>
          {doc.board.title} · generated {doc.generated} · source {loaded.source}
        </span>
        <a href={doc.board.url} target="_blank" rel="noreferrer">
          Open the board on GitHub ↗
        </a>
      </footer>
    </div>
  );
}
