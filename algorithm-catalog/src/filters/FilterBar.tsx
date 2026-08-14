// The Algorithms toolbar: one search box, four faceted pickers, and the context row (activation
// event, AOI, date window).
//
// `mode` NEVER touches the filter state — it only decides which picker leads and which quick-pick
// pill row is shown, so flipping between "start from hazard" and "start from sensor & product"
// keeps every selection the user has already made.

import type { ActivationEvent, Algorithm, Hazard } from "../types";
import { hazardColor, hazardIcon, hazardLabel, modality as modalityStyle } from "../colors";
import { allProducts } from "../data";
import MultiPicker, { type PickerOption } from "./MultiPicker";
import DateRange from "./DateRange";
import {
  activeFacetCount,
  allSelected,
  applyEvent,
  eventsMatchingAoi,
  isFacetActive,
  type EntryMode,
  type Filters,
  type Universe,
} from "./filter";

interface Props {
  mode: EntryMode;
  filters: Filters;
  onChange: (next: Filters) => void;
  universe: Universe;
  algorithms: Algorithm[];
  hazards: Hazard[];
  events: ActivationEvent[];
}

export default function FilterBar({
  mode,
  filters: f,
  onChange,
  universe: u,
  algorithms,
  hazards,
  events,
}: Props) {
  const patch = (p: Partial<Filters>) => onChange({ ...f, ...p });

  const hazardOptions: PickerOption[] = hazards.map((h) => ({
    id: h.id,
    label: `${h.icon} ${h.label}`,
    color: h.color,
  }));

  const sensorOptions: PickerOption[] = algorithms.map((a) => ({
    id: a.id,
    label: a.title,
    color: modalityStyle(a.modality).color,
  }));

  const productOptions: PickerOption[] = allProducts(algorithms).map((r) => ({
    id: r.key,
    label: r.product.label,
    group: r.algorithm.title,
    color: modalityStyle(r.algorithm.modality).color,
  }));

  const modalityOptions: PickerOption[] = u.modalities.map((m) => ({
    id: m,
    label: modalityStyle(m).label,
    color: modalityStyle(m).color,
  }));

  /**
   * Quick-pick pills. The first click on a pill while the facet is wide open NARROWS TO THAT ONE —
   * "a wildfire just activated" should be one click, not clear-all-then-pick. After that it is a
   * plain toggle, and un-picking the last one returns the facet to "all", i.e. no filter.
   */
  function pill(current: Set<string>, all: string[], id: string): Set<string> {
    if (!isFacetActive(current, all)) return new Set([id]);
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next.size === 0 ? new Set(all) : next;
  }

  const selectedEvent = events.find((e) => e.id === f.eventId) ?? null;
  const aoiHits = eventsMatchingAoi(events, f.aoi);
  const activeCount = activeFacetCount(f, u);

  const hazardPickerLead = mode === "hazard";

  return (
    <div className="filterbar">
      <div className="toolbar">
        <div className="search">
          <span className="search-ico" aria-hidden>
            🔍
          </span>
          <input
            value={f.query}
            onChange={(e) => patch({ query: e.target.value })}
            placeholder="Search algorithms, vendors, products, keywords…"
            aria-label="Search algorithms"
          />
          {f.query && (
            <button className="search-x" onClick={() => patch({ query: "" })} aria-label="Clear search">
              ×
            </button>
          )}
        </div>

        {hazardPickerLead ? (
          <>
            <MultiPicker
              label="hazards"
              icon="🔥"
              options={hazardOptions}
              selected={f.hazards}
              onChange={(hz) => patch({ hazards: hz })}
              searchable
            />
            <MultiPicker
              label="modalities"
              icon="🏷️"
              options={modalityOptions}
              selected={f.modalities}
              onChange={(m) => patch({ modalities: m })}
            />
            <MultiPicker
              label="sensors"
              icon="🛰"
              options={sensorOptions}
              selected={f.sensors}
              onChange={(s) => patch({ sensors: s })}
            />
            <MultiPicker
              label="products"
              icon="🗂"
              options={productOptions}
              selected={f.products}
              onChange={(p) => patch({ products: p })}
              searchable
            />
          </>
        ) : (
          <>
            <MultiPicker
              label="sensors"
              icon="🛰"
              options={sensorOptions}
              selected={f.sensors}
              onChange={(s) => patch({ sensors: s })}
              searchable
            />
            <MultiPicker
              label="products"
              icon="🗂"
              options={productOptions}
              selected={f.products}
              onChange={(p) => patch({ products: p })}
              searchable
            />
            <MultiPicker
              label="modalities"
              icon="🏷️"
              options={modalityOptions}
              selected={f.modalities}
              onChange={(m) => patch({ modalities: m })}
            />
            <MultiPicker
              label="hazards"
              icon="🔥"
              options={hazardOptions}
              selected={f.hazards}
              onChange={(hz) => patch({ hazards: hz })}
              searchable
            />
          </>
        )}

        <button
          className="btn reset-btn"
          onClick={() => onChange(allSelected(u))}
          disabled={activeCount === 0}
        >
          ↺ Reset{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
      </div>

      {hazardPickerLead ? (
        <div className="pillrow" role="group" aria-label="Hazards">
          {hazards.map((h) => {
            const on = isFacetActive(f.hazards, u.hazards) && f.hazards.has(h.id);
            return (
              <button
                key={h.id}
                className={on ? "hpill on" : "hpill"}
                style={on ? { background: h.color, borderColor: h.color } : { borderColor: h.color }}
                onClick={() => patch({ hazards: pill(f.hazards, u.hazards, h.id) })}
                aria-pressed={on}
              >
                <span aria-hidden>{h.icon}</span> {h.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="pillrow" role="group" aria-label="Sensors">
          {algorithms.map((a) => {
            const on = isFacetActive(f.sensors, u.sensors) && f.sensors.has(a.id);
            const c = modalityStyle(a.modality).color;
            return (
              <button
                key={a.id}
                className={on ? "hpill on" : "hpill"}
                style={on ? { background: c, borderColor: c } : { borderColor: c }}
                onClick={() => patch({ sensors: pill(f.sensors, u.sensors, a.id) })}
                aria-pressed={on}
              >
                <span aria-hidden>{modalityStyle(a.modality).icon}</span> {a.title}
              </button>
            );
          })}
        </div>
      )}

      <div className="context panel">
        <div className="context-col">
          <div className="field">
            <label htmlFor="filter-event">Activation event</label>
            <select
              id="filter-event"
              value={f.eventId}
              onChange={(e) =>
                onChange(applyEvent(f, u, events.find((x) => x.id === e.target.value) ?? null))
              }
            >
              <option value="">— none —</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          {selectedEvent && (
            <p className="hint">
              Prefilled hazards, dates and AOI from <b>{selectedEvent.name}</b>. The{" "}
              {new Set(selectedEvent.layers.map((l) => l.algorithm)).size} algorithms it actually
              used are flagged <span className="used-flag">used here</span> below — the list itself
              is still filtered by the facets, not by the event.
            </p>
          )}
        </div>

        <div className="context-col">
          <div className="field">
            <label htmlFor="filter-aoi">
              Area of interest <span className="opt">(matches past activations only)</span>
            </label>
            <input
              id="filter-aoi"
              value={f.aoi}
              onChange={(e) => patch({ aoi: e.target.value })}
              placeholder="Los Angeles, CA"
            />
          </div>
          <p className="hint">
            AOI cannot narrow the algorithm list. Every sensor here is globally taskable and no
            algorithm in the catalog carries a coverage polygon, so there is nothing for a place
            name to be tested against — it searches the <b>locations of past activations</b>{" "}
            instead.
            {f.aoi.trim() && (
              <>
                {" "}
                <b>
                  {aoiHits.length} past activation{aoiHits.length === 1 ? "" : "s"}
                </b>
                {aoiHits.length > 0 && <>: {aoiHits.map((e) => e.name).join(", ")}</>}.
              </>
            )}
          </p>
        </div>

        <div className="context-col">
          <DateRange
            start={f.start}
            end={f.end}
            onChange={(start, end) => patch({ start, end })}
            hint="An algorithm records only when its data record BEGINS — there is no end date upstream — so the window keeps every algorithm whose record started on or before the later date you pick."
          />
        </div>
      </div>

      {isFacetActive(f.hazards, u.hazards) && f.hazards.size > 0 && (
        <div className="chosen" aria-label="Selected hazards">
          {[...f.hazards].map((id) => (
            <span
              key={id}
              className="hchip"
              style={{ background: hazardColor(id, hazards) }}
            >
              <span aria-hidden>{hazardIcon(id, hazards)}</span> {hazardLabel(id, hazards)}
              <button
                className="hchip-x"
                onClick={() => patch({ hazards: pill(f.hazards, u.hazards, id) })}
                aria-label={`Remove ${hazardLabel(id, hazards)}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
