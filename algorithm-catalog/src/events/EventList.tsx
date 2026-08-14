// The Event Catalog: past activations from data/events.json PLUS everything submitted through the
// request form, in one list.
//
// The union is the point. A responder who files a request has to be able to see it — an app that
// swallows a submission until some workflow runs is an app nobody trusts. The two are never
// conflated: every row is badged `published` or `submitted`, and a request naming an activation
// that already exists is folded into that activation as an update instead of competing with it.

import { useMemo, useState } from "react";
import type { Hazard } from "../types";
import {
  allProducts,
  formatRange,
  loadAlgorithms,
  loadEventCatalog,
  loadHazards,
  productKey,
  type CatalogEvent,
} from "../data";
import { hazardColor, hazardIcon, hazardLabel } from "../colors";
import MultiPicker, { type PickerOption } from "../filters/MultiPicker";
import DateRange from "../filters/DateRange";
import {
  emptyEventFilters,
  filterEvents,
  isFacetActive,
  universeOf,
  type EventFilters,
} from "../filters/filter";
import EventDetail from "./EventDetail";

export default function EventList() {
  const algorithms = useMemo(() => loadAlgorithms(), []);
  const hazards = useMemo(() => loadHazards(), []);
  const events = useMemo(() => loadEventCatalog(), []);
  const universe = useMemo(() => universeOf(algorithms, hazards), [algorithms, hazards]);

  const [filters, setFilters] = useState<EventFilters>(() => emptyEventFilters(universe));
  const [openId, setOpenId] = useState<string | null>(null);

  const hazardLabels = useMemo(
    () => new Map(hazards.map((h) => [h.id, h.label])),
    [hazards],
  );
  // Layer key → "Landsat 8/9 Natural color", so searching a human name finds the event.
  const layerLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of algorithms) {
      for (const p of a.products) m.set(productKey(a.id, p.id), `${a.title} ${p.label}`);
    }
    return m;
  }, [algorithms]);

  // Every algorithm×product pair that actually exists — the honest denominator for "available in
  // this catalog". A layer naming an algorithm we do not have counts as unavailable, exactly like
  // an externalLayer, no matter that the event file lists it under `layers`.
  const validKeys = useMemo(
    () => new Set(allProducts(algorithms).map((r) => r.key)),
    [algorithms],
  );

  const hazardOptions: PickerOption[] = hazards.map((h) => ({
    id: h.id,
    label: `${h.icon} ${h.label}`,
    color: h.color,
  }));

  const shown = useMemo(
    () => filterEvents(events, filters, universe, hazardLabels, layerLabels),
    [events, filters, universe, hazardLabels, layerLabels],
  );

  const open = openId ? (events.find((e) => e.id === openId) ?? null) : null;
  const narrowed =
    filters.query.trim() !== "" ||
    isFacetActive(filters.hazards, universe.hazards) ||
    filters.start !== "" ||
    filters.end !== "";

  return (
    <div className="events">
      <div className="toolbar">
        <div className="search">
          <span className="search-ico" aria-hidden>
            🔍
          </span>
          <input
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            placeholder="Search events, STAC names, hazards, locations, layers…"
            aria-label="Search events"
          />
          {filters.query && (
            <button
              className="search-x"
              onClick={() => setFilters({ ...filters, query: "" })}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <MultiPicker
          label="hazards"
          icon="🔥"
          options={hazardOptions}
          selected={filters.hazards}
          onChange={(hz) => setFilters({ ...filters, hazards: hz })}
          searchable
        />

        <button
          className="btn reset-btn"
          onClick={() => setFilters(emptyEventFilters(universe))}
          disabled={!narrowed}
        >
          ↺ Reset
        </button>
      </div>

      <div className="events-dates">
        <DateRange
          start={filters.start}
          end={filters.end}
          onChange={(start, end) => setFilters({ ...filters, start, end })}
          startLabel="Active on or after"
          endLabel="Active on or before"
        />
      </div>

      <div className="count-strip">
        <span className="count">
          {shown.length} of {events.length} events
        </span>
        <span className="count-note">
          <span className="src-badge published">published</span> = in the catalog ·{" "}
          <span className="src-badge submitted">submitted</span> = filed through this app, awaiting
          review
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="empty">No event matches these filters.</p>
      ) : (
        <ul className="elist">
          {shown.map((ev) => (
            <li key={ev.id}>
              <EventRow
                event={ev}
                hazardsVocab={hazards}
                validKeys={validKeys}
                onOpen={() => setOpenId(ev.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {open && (
        <EventDetail
          event={open}
          algorithms={algorithms}
          hazards={hazards}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function EventRow({
  event: ev,
  hazardsVocab,
  validKeys,
  onOpen,
}: {
  event: CatalogEvent;
  hazardsVocab: Hazard[];
  validKeys: Set<string>;
  onOpen: () => void;
}) {
  const total = ev.layers.length + ev.externalLayers.length;
  const available = ev.layers.filter((l) => validKeys.has(productKey(l.algorithm, l.product))).length;
  return (
    <button className="ecard" onClick={onOpen}>
      <div className="ecard-top">
        <h3 className="ecard-name">{ev.name}</h3>
        <span className={`src-badge ${ev.source}`}>{ev.source}</span>
        {ev.submissions.length > 0 && ev.source === "published" && (
          <span className="upd-badge">
            {ev.submissions.length} submitted update{ev.submissions.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="ecard-meta">
        <code>{ev.stacName}</code>
        <span className="ecard-when">{formatRange(ev.start, ev.end)}</span>
      </div>

      <div className="ecard-hazards">
        {ev.hazards.map((h) => (
          <span key={h} className="hchip sm" style={{ background: hazardColor(h, hazardsVocab) }}>
            <span aria-hidden>{hazardIcon(h, hazardsVocab)}</span> {hazardLabel(h, hazardsVocab)}
          </span>
        ))}
      </div>

      <p className="ecard-locations">
        <span aria-hidden>📍</span> {ev.locations.join(" · ") || "no location recorded"}
      </p>

      <p className="ecard-layers">
        {available} of {total} layer{total === 1 ? "" : "s"} available in this catalog
      </p>
    </button>
  );
}
