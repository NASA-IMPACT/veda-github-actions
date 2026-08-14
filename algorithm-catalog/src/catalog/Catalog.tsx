// "A wildfire just activated — which products should I deploy?"
//
// Two entry modes over ONE filter state. `🔥 Start from hazard` is the primary flow;
// `🛰 Start from sensor & product` is the escape hatch for someone who knows the product they want
// but not which hazard bucket it lives in. The segmented control only reorders which pickers lead
// (see FilterBar) — it never resets or hides a selection, so switching modes is lossless.

import { useEffect, useMemo, useState } from "react";
import { loadAlgorithms, loadEvents, loadHazards } from "../data";
import { takeNavIntent, NAV_EVENT, type NavIntent } from "../tabs";
import FilterBar from "../filters/FilterBar";
import {
  allSelected,
  applyEvent,
  eventAlgorithms,
  filterAlgorithms,
  isFacetActive,
  matchedProducts,
  universeOf,
  type EntryMode,
  type Filters,
} from "../filters/filter";
import AlgorithmCard from "./AlgorithmCard";
import AlgorithmDetail from "./AlgorithmDetail";

export default function Catalog() {
  const algorithms = useMemo(() => loadAlgorithms(), []);
  const hazards = useMemo(() => loadHazards(), []);
  const events = useMemo(() => loadEvents(), []);
  const universe = useMemo(() => universeOf(algorithms, hazards), [algorithms, hazards]);

  const [mode, setMode] = useState<EntryMode>("hazard");
  const [filters, setFilters] = useState<Filters>(() => allSelected(universe));
  const [openId, setOpenId] = useState<string | null>(null);

  // Arriving from an event's layer chip: prefill from that event, then narrow to the one algorithm
  // that was clicked. Handled both on mount (the usual case — this tab was not rendered yet) and
  // live, for the case where the tab is already showing.
  useEffect(() => {
    function apply(intent: NavIntent) {
      setFilters((prev) => {
        let next = prev;
        if (intent.event) {
          next = applyEvent(next, universe, events.find((e) => e.id === intent.event) ?? null);
        }
        if (intent.algorithm) next = { ...next, sensors: new Set([intent.algorithm]) };
        return next;
      });
      if (intent.algorithm) setMode("sensor");
    }

    const pending = takeNavIntent();
    if (pending) apply(pending);

    const onNav = (e: Event) => {
      const intent = (e as CustomEvent<NavIntent>).detail;
      if (intent?.tab === "algorithms") {
        takeNavIntent(); // consume so a later mount does not re-apply it
        apply(intent);
      }
    };
    window.addEventListener(NAV_EVENT, onNav);
    return () => window.removeEventListener(NAV_EVENT, onNav);
  }, [events, universe]);

  const selectedEvent = events.find((e) => e.id === filters.eventId) ?? null;
  const usedHere = useMemo(() => eventAlgorithms(selectedEvent), [selectedEvent]);

  const shown = useMemo(() => {
    const list = filterAlgorithms(algorithms, filters, universe);
    // With an event selected, what we actually ran last time floats to the top; otherwise the
    // hand-curated catalog order stands.
    if (usedHere.size === 0) return list;
    return [...list].sort(
      (a, b) => Number(usedHere.has(b.id)) - Number(usedHere.has(a.id)),
    );
  }, [algorithms, filters, universe, usedHere]);

  const open = openId ? (algorithms.find((a) => a.id === openId) ?? null) : null;

  return (
    <div className="catalog">
      <div className="mode-row">
        <div className="seg" role="tablist" aria-label="Entry mode">
          <button
            role="tab"
            aria-selected={mode === "hazard"}
            className={mode === "hazard" ? "active" : ""}
            onClick={() => setMode("hazard")}
          >
            🔥 Start from hazard
          </button>
          <button
            role="tab"
            aria-selected={mode === "sensor"}
            className={mode === "sensor" ? "active" : ""}
            onClick={() => setMode("sensor")}
          >
            🛰 Start from sensor &amp; product
          </button>
        </div>
        <p className="mode-note">
          {mode === "hazard"
            ? "Pick the hazard that just activated — the list narrows to the algorithms with a product suited to it."
            : "Know the product already? Pick the sensor or product directly. Your hazard selection is kept."}
        </p>
      </div>

      <FilterBar
        mode={mode}
        filters={filters}
        onChange={setFilters}
        universe={universe}
        algorithms={algorithms}
        hazards={hazards}
        events={events}
      />

      <div className="count-strip">
        <span className="count">
          {shown.length} of {algorithms.length} algorithms
        </span>
        {selectedEvent && (
          <span className="count-note">
            <span className="used-flag">used here</span> = deployed for {selectedEvent.name}
          </span>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="empty">
          No algorithm matches these filters. Widen a facet, or clear the date window — the date
          test only keeps algorithms whose record had already started.
        </p>
      ) : (
        <div className="agrid">
          {shown.map((a) => (
            <AlgorithmCard
              key={a.id}
              algorithm={a}
              matched={matchedProducts(a, filters, universe)}
              hazards={hazards}
              focusHazards={
                isFacetActive(filters.hazards, universe.hazards) ? filters.hazards : undefined
              }
              used={usedHere.has(a.id)}
              onOpen={() => setOpenId(a.id)}
            />
          ))}
        </div>
      )}

      {open && (
        <AlgorithmDetail
          algorithm={open}
          hazards={hazards}
          matchedIds={new Set(matchedProducts(open, filters, universe).map((p) => p.id))}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
