import { useEffect, useMemo, useState } from "react";
import Header from "./components/Header";
import HeadlineCards from "./components/HeadlineCards";
import PersonView from "./components/PersonView";
import RoleView from "./components/RoleView";
import AllocationsTable from "./components/AllocationsTable";
import MatrixView from "./components/MatrixView";
import TrendsView from "./components/TrendsView";
import TabSwitcher, { type Tab } from "./components/TabSwitcher";
import { computeHeadline, computePersonAggs, computeRoleAggs, validateBaseline } from "./compute";
import { allocationsToCsv, downloadCsv, personsToCsv, rolesToCsv } from "./csv";
import { loadDataset } from "./data";
import { applyTheme, getInitialTheme } from "./theme";
import type { Allocation, Dataset } from "./types";

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [piFilter, setPiFilter] = useState("ALL");
  const [activeTab, setActiveTab] = useState<Tab>("matrix"); // Capacity Matrix is the default view
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    loadDataset()
      .then((ds) => {
        setDataset(ds);
        setAllocations(ds.allocations);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const showPi = piFilter === "ALL";
  const pis = useMemo(() => Array.from(new Set(allocations.map((a) => a.pi))).sort(), [allocations]);
  const filtered = useMemo(
    () => (showPi ? allocations : allocations.filter((a) => a.pi === piFilter)),
    [allocations, piFilter, showPi],
  );
  const persons = useMemo(() => computePersonAggs(filtered), [filtered]);
  const roles = useMemo(() => computeRoleAggs(filtered), [filtered]);
  const headline = useMemo(() => computeHeadline(filtered, persons), [filtered, persons]);
  const overKeys = useMemo(
    () => new Set(persons.filter((p) => p.over_allocated).map((p) => `${p.pi}||${p.person}`)),
    [persons],
  );

  const edited = useMemo(() => {
    if (!dataset) return false;
    const base = new Map(dataset.allocations.map((a) => [a.id, a.fte]));
    return allocations.some((a) => base.get(a.id) !== a.fte);
  }, [allocations, dataset]);

  // Validate the recompute engine against the Python-generated baseline (full, unedited data).
  const baseline = useMemo(() => {
    if (!dataset) return null;
    return validateBaseline(
      computePersonAggs(dataset.allocations),
      dataset.baselinePersons,
      computeRoleAggs(dataset.allocations),
      dataset.baselineRoles,
    );
  }, [dataset]);

  const setFte = (id: string, fte: number) =>
    setAllocations((prev) => prev.map((a) => (a.id === id ? { ...a, fte } : a)));
  const reset = () => dataset && setAllocations(dataset.allocations);

  const onExport = (kind: "alloc" | "person" | "role") => {
    const suffix = edited ? "_whatif" : "";
    if (kind === "alloc") downloadCsv(`fte_allocations${suffix}.csv`, allocationsToCsv(allocations));
    else if (kind === "person") downloadCsv(`fte_by_person${suffix}.csv`, personsToCsv(computePersonAggs(allocations)));
    else downloadCsv(`fte_by_role${suffix}.csv`, rolesToCsv(computeRoleAggs(allocations)));
  };

  if (error)
    return (
      <div className="app">
        <div className="notice err">Failed to load report data.<br />{error}</div>
      </div>
    );
  if (!dataset) return <div className="app"><div className="notice">Loading latest FTE report…</div></div>;

  return (
    <div className="app">
      <Header
        pis={pis}
        piFilter={piFilter}
        onPiChange={setPiFilter}
        source={dataset.source}
        generatedAt={dataset.context.generatedAt}
        baseline={baseline}
        edited={edited}
        onReset={reset}
        onExport={onExport}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        showEditControls={activeTab === "dashboard"}
        showPiFilter={activeTab !== "trends"}
      />

      {activeTab === "matrix" ? (
        <MatrixView allocations={filtered} overKeys={overKeys} showPi={showPi} />
      ) : activeTab === "trends" ? (
        <TrendsView allocations={allocations} />
      ) : (
        <>
          <HeadlineCards headline={headline} context={dataset.context} />

          <div className="grid-2">
            <PersonView persons={persons} showPi={showPi} />
            <RoleView roles={roles} showPi={showPi} />
          </div>

          <AllocationsTable allocations={filtered} overKeys={overKeys} showPi={showPi} onFte={setFte} />
        </>
      )}

      <TabSwitcher active={activeTab} onChange={setActiveTab} />

      <div className="footer">
        Data source: <span className="mono">{dataset.source === "live" ? "fte-report/all-pis branch (live)" : "bundled snapshot"}</span>
        {" · "}
        <a href="https://github.com/NASA-IMPACT/veda-github-actions" target="_blank" rel="noreferrer">
          NASA-IMPACT/veda-github-actions
        </a>
        {" · "}Reports regenerated by the FTE GitHub Action.
      </div>
    </div>
  );
}
