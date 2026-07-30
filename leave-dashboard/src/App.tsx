import { useEffect, useMemo, useRef, useState } from "react";
import type { Dataset, Person, Status } from "./types";
import { loadDataset } from "./data";
import type { MonthKey, PersonLeave } from "./compute";
import {
  indexByDate, MONTH_NAMES, monthsBetween, sameMonth, toISO, visiblePeople,
} from "./compute";
import { STATUS_ORDER } from "./colors";
import { Draft, draftToPerson } from "./drafts";
import { exportNodeToPng } from "./exportImage";
import { decodeHash, encodeHash } from "./urlState";
import Header from "./components/Header";
import PersonPicker from "./components/PersonPicker";
import Filters from "./components/Filters";
import MonthCalendar from "./components/MonthCalendar";
import RiskView from "./components/RiskView";
import Legend from "./components/Legend";
import AddPersonForm from "./components/AddPersonForm";

export default function App() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "risk">("calendar");
  const [month, setMonth] = useState<MonthKey | null>(null);
  const [selSlugs, setSelSlugs] = useState<Set<string>>(new Set());
  const [selTeams, setSelTeams] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<Status>>(new Set(STATUS_ORDER));
  const [threshold, setThreshold] = useState(0.3);
  const [addOpen, setAddOpen] = useState(false);
  const [preview, setPreview] = useState<Person[]>([]);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadDataset()
      .then((d) => {
        setDs(d);
        // Restore a shared view from the URL hash, else fall back to sensible defaults.
        const url = decodeHash(window.location.hash);
        const realSlugs = new Set(d.doc.people.map((p) => p.slug));
        const teamSet = new Set(d.doc.meta.teams);
        setSelSlugs(url.people ? new Set(url.people.filter((s) => realSlugs.has(s))) : realSlugs);
        setSelTeams(url.teams ? new Set(url.teams.filter((t) => teamSet.has(t))) : teamSet);
        setStatuses(new Set(url.statuses ?? STATUS_ORDER));
        setThreshold(url.risk ?? d.coverage.risk_threshold_default ?? 0.3);
        if (url.view) setView(url.view);
        const months = monthsBetween(d.doc.meta.span.start, d.doc.meta.span.end);
        setMonth(url.month ?? months[0] ?? { year: d.doc.meta.year, month: 6 });
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Keep the URL hash in sync with the current view so it can be copied/shared.
  useEffect(() => {
    if (!ds || !month) return;
    const realSlugs = ds.doc.people.map((p) => p.slug);
    const selReal = realSlugs.filter((s) => selSlugs.has(s));
    const hash = encodeHash({
      view, month, risk: threshold,
      people: selReal.length === realSlugs.length ? null : selReal,
      teams: selTeams.size === ds.doc.meta.teams.length ? null : [...selTeams],
      statuses: statuses.size === STATUS_ORDER.length ? null : [...statuses],
    });
    window.history.replaceState(null, "", hash || window.location.pathname + window.location.search);
  }, [ds, view, month, threshold, selSlugs, selTeams, statuses]);

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const months = useMemo<MonthKey[]>(
    () => (ds ? monthsBetween(ds.doc.meta.span.start, ds.doc.meta.span.end) : []),
    [ds],
  );

  // Effective data = the report + any unsaved preview people (override by slug).
  const effectivePeople = useMemo<Person[]>(() => {
    if (!ds) return [];
    if (preview.length === 0) return ds.doc.people;
    const bySlug = new Map(ds.doc.people.map((p) => [p.slug, p]));
    preview.forEach((p) => bySlug.set(p.slug, p));
    return [...bySlug.values()];
  }, [ds, preview]);
  const effectiveTeams = useMemo<string[]>(
    () => [...new Set(effectivePeople.map((p) => p.team))].sort(),
    [effectivePeople],
  );

  const visible = useMemo<Person[]>(
    () => visiblePeople(effectivePeople, selTeams, selSlugs),
    [effectivePeople, selTeams, selSlugs],
  );
  const visibleSlugs = useMemo(() => new Set(visible.map((p) => p.slug)), [visible]);

  const byDate = useMemo<Map<string, PersonLeave[]>>(
    () => (ds ? indexByDate(effectivePeople, visibleSlugs, statuses) : new Map()),
    [ds, effectivePeople, visibleSlugs, statuses],
  );

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    effectivePeople.forEach((p) => m.set(p.slug, p.name));
    return (slug: string) => m.get(slug) ?? slug;
  }, [effectivePeople]);

  function applyPreview(drafts: Draft[]) {
    const persons = drafts.map(draftToPerson);
    setPreview(persons);
    setSelSlugs((prev) => new Set([...prev, ...persons.map((p) => p.slug)]));
    setSelTeams((prev) => new Set([...prev, ...persons.map((p) => p.team)]));
    const firstDate = persons.flatMap((p) => p.leaves).map((l) => l.date).sort()[0];
    if (firstDate) {
      const d = new Date(firstDate + "T00:00:00");
      setMonth({ year: d.getFullYear(), month: d.getMonth() });
    }
    setAddOpen(false);
  }

  async function exportPng() {
    if (!exportRef.current || !month) return;
    setExporting(true); // reveals the capture-only caption
    // Let React paint the caption before rasterizing (two frames to be safe).
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    try {
      const scope = visible.length === effectivePeople.length ? "all" : `${visible.length}-people`;
      const name = `team-leave-${MONTH_NAMES[month.month].toLowerCase()}-${month.year}-${scope}.png`;
      await exportNodeToPng(exportRef.current, name);
    } catch (e) {
      console.error("PNG export failed", e);
    } finally {
      setExporting(false);
    }
  }

  // People appearing in the current month (for the per-person legend).
  const peopleInView = useMemo<Person[]>(() => {
    if (!ds || !month) return [];
    const seen = new Map<string, Person>();
    for (const [iso, entries] of byDate) {
      const d = new Date(iso + "T00:00:00");
      if (d.getFullYear() === month.year && d.getMonth() === month.month) {
        entries.forEach((e) => seen.set(e.person.slug, e.person));
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [ds, month, byDate]);

  const outDays = useMemo(
    () => visible.reduce((n, p) => n + p.leaves.filter((l) => l.out && statuses.has(l.status)).length, 0),
    [visible, statuses],
  );
  const flaggedDays = useMemo(
    () => (ds ? ds.coverage.days.filter((d) => selTeams.has(d.team) && d.out_pct >= threshold).length : 0),
    [ds, selTeams, threshold],
  );

  if (error) return <div className="app"><div className="error">Could not load leave data.<br />{error}</div></div>;
  if (!ds || !month) return <div className="app"><div className="loading">Loading leave data…</div></div>;

  const idx = months.findIndex((m) => sameMonth(m, month));

  return (
    <div className="app">
      <Header
        source={ds.source}
        generated={ds.generated}
        view={view}
        onView={setView}
        month={month}
        canPrev={idx > 0}
        canNext={idx < months.length - 1}
        onPrev={() => setMonth(months[idx - 1])}
        onNext={() => setMonth(months[idx + 1])}
      />

      {ds.doc.warnings.length > 0 && (
        <div className="warnbanner">⚠️ {ds.doc.warnings.length} parser warning(s) — some cells had unrecognized colors.</div>
      )}

      {preview.length > 0 && (
        <div className="warnbanner" style={{ background: "#eef6ff", borderColor: "#bcdcff", color: "#1a4480" }}>
          👁 Previewing <b>{preview.length}</b> unsaved {preview.length === 1 ? "person" : "people"} (not yet in a PR).{" "}
          <button className="btn" style={{ padding: "0.1rem 0.5rem", marginLeft: "0.4rem" }} onClick={() => setPreview([])}>
            Clear preview
          </button>
        </div>
      )}

      <div className="controls">
        <PersonPicker people={effectivePeople} selected={selSlugs} onChange={setSelSlugs} />
        <Filters
          teams={effectiveTeams}
          selectedTeams={selTeams}
          onTeams={setSelTeams}
          statuses={statuses}
          onStatuses={setStatuses}
        />
        <button className="btn primary" onClick={() => setAddOpen(true)}>＋ Add person</button>
        <button className="btn" onClick={copyLink} title="Copy a link that reopens this exact filtered view">
          {copied ? "✓ Link copied" : "🔗 Copy link"}
        </button>
        {view === "calendar" && (
          <button className="btn" onClick={exportPng} disabled={exporting}>
            {exporting ? "Exporting…" : "⬇ Export PNG"}
          </button>
        )}

        <div className="stat-cards">
          <div className="stat panel"><div className="n">{visible.length}</div><div className="l">People</div></div>
          <div className="stat panel"><div className="n">{selTeams.size}</div><div className="l">Teams</div></div>
          <div className="stat panel"><div className="n">{outDays}</div><div className="l">Out-days</div></div>
          <div className="stat panel risk"><div className="n">{flaggedDays}</div><div className="l">High-risk</div></div>
        </div>
      </div>

      {view === "calendar" ? (
        <div ref={exportRef} className="export-target">
          {exporting && (
            <div className="export-cap">
              <div className="ec-title">Team Out-of-Office &amp; Leave</div>
              <div className="ec-sub">
                {MONTH_NAMES[month.month]} {month.year} · {visible.length}{" "}
                {visible.length === 1 ? "person" : "people"}
                {selTeams.size < effectiveTeams.length ? ` · ${selTeams.size} teams` : ""}
                {preview.length > 0 ? " · includes unsaved preview" : ""}
              </div>
            </div>
          )}
          <MonthCalendar month={month} byDate={byDate} today={toISO(new Date())} />
          <Legend people={peopleInView} />
        </div>
      ) : (
        <RiskView
          days={ds.coverage.days}
          selectedTeams={selTeams}
          month={month}
          months={months}
          threshold={threshold}
          onThreshold={setThreshold}
          onMonth={setMonth}
          nameOf={nameOf}
        />
      )}

      {addOpen && (
        <AddPersonForm
          teams={effectiveTeams}
          people={effectivePeople}
          pi={ds.doc.meta.pi}
          onClose={() => setAddOpen(false)}
          onPreview={applyPreview}
        />
      )}
    </div>
  );
}
