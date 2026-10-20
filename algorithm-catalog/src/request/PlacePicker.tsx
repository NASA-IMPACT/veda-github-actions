// Locations at any level of interest. Type "Alabama" for the whole state, or Narrow it to
// "Montgomery, Alabama" (or a county); Broaden goes back up. Every pick is a gazetteer entry
// (src/places.ts), so the name is spelled one way everywhere and its bounding box is known.
//
// Narrow/Broaden REPLACE the chip rather than adding a second one: the point is choosing the
// level of interest, and "Alabama + Montgomery" says the same thing twice (rules.ts warns on it).

import { useEffect, useMemo, useRef, useState } from "react";
import type { Place } from "../types";
import {
  canNarrow,
  childrenOf,
  citiesLoaded,
  getPlace,
  loadCities,
  parentId,
  placeLevel,
  searchPlaces,
} from "../places";
import { useClickAway } from "../useClickAway";

type Pick = { id: string; label: string };

interface Props {
  value: Pick[];
  onChange: (next: Pick[]) => void;
  onTouched: () => void;
}

const SHOW_CHILDREN = 60;

const pick = (p: Place): Pick => ({ id: p.id, label: p.label });

export default function PlacePicker({ value, onChange, onTouched }: Props) {
  const [q, setQ] = useState("");
  const [narrowing, setNarrowing] = useState<string | null>(null);
  const [childQ, setChildQ] = useState("");
  // Bumped when the city chunk lands, so the memos below re-run against the bigger index.
  const [, setCitiesTick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => (setQ(""), setNarrowing(null)), q !== "" || narrowing !== null);

  const needCities = () => {
    if (!citiesLoaded()) loadCities().then(() => setCitiesTick((t) => t + 1));
  };
  // Prefilled city picks (Edit page) need the chunk to Broaden/label correctly.
  useEffect(() => {
    if (value.some((p) => placeLevel(p.id) === "city")) needCities();
  }, [value]);

  const chosen = useMemo(() => new Set(value.map((p) => p.id)), [value]);
  const results = searchPlaces(q, chosen);
  const kids = useMemo(() => {
    if (!narrowing) return [];
    const needle = childQ.trim().toLowerCase();
    return childrenOf(narrowing).filter((p) => !chosen.has(p.id) && p.name.toLowerCase().includes(needle));
  }, [narrowing, childQ, chosen, citiesLoaded()]);

  function add(p: Place) {
    onTouched();
    onChange([...value, pick(p)]);
    setQ("");
  }
  function replace(id: string, p: Place) {
    onTouched();
    onChange(value.map((x) => (x.id === id ? pick(p) : x)));
    setNarrowing(null);
    setChildQ("");
  }
  function remove(id: string) {
    onTouched();
    onChange(value.filter((x) => x.id !== id));
  }

  return (
    <div className="place-picker" ref={ref}>
      {value.length > 0 && (
        <div className="req-chips place-chips">
          {value.map((p) => {
            const up = parentId(p.id);
            const parent = up ? getPlace(up) : undefined;
            return (
              <span key={p.id} className="req-chip place-chip">
                <span className="req-chip-prod">{p.label}</span>
                <span className={`req-badge place-lvl place-lvl-${placeLevel(p.id)}`}>{placeLevel(p.id)}</span>
                {canNarrow(p.id) && (
                  <button
                    type="button"
                    className="linkbtn place-act"
                    onClick={() => {
                      needCities();
                      setChildQ("");
                      setNarrowing(narrowing === p.id ? null : p.id);
                    }}
                    title={`Pick a county or city inside ${p.label}`}
                  >
                    Narrow ▾
                  </button>
                )}
                {parent && !chosen.has(parent.id) && (
                  <button
                    type="button"
                    className="linkbtn place-act"
                    onClick={() => replace(p.id, parent)}
                    title={`Replace with ${parent.label}`}
                  >
                    Broaden to {parent.name} ▴
                  </button>
                )}
                <button
                  className="req-chip-x"
                  type="button"
                  onClick={() => remove(p.id)}
                  aria-label={`Remove ${p.label}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {narrowing && (
        <div className="popover req-picker place-pop" role="dialog" aria-label="Narrow location">
          <div className="req-picker-head">
            <input
              className="req-picker-search"
              autoFocus
              value={childQ}
              onChange={(e) => setChildQ(e.target.value)}
              placeholder={`Inside ${getPlace(narrowing)?.label ?? narrowing} — type to filter…`}
              aria-label="Filter places inside"
            />
            <button className="req-modal-x" type="button" onClick={() => setNarrowing(null)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="req-picker-body">
            {placeLevel(narrowing) === "state" && !citiesLoaded() && (
              <p className="req-picker-empty">Loading cities…</p>
            )}
            {kids.slice(0, SHOW_CHILDREN).map((c) => (
              <PlaceRow key={c.id} place={c} onPick={() => replace(narrowing, c)} />
            ))}
            {kids.length === 0 && citiesLoaded() && <p className="req-picker-empty">Nothing matches “{childQ}”.</p>}
          </div>
          {kids.length > SHOW_CHILDREN && (
            <p className="req-picker-foot">
              Showing {SHOW_CHILDREN} of {kids.length} — type to filter.
            </p>
          )}
        </div>
      )}

      <div className="search place-search">
        <span className="search-ico" aria-hidden>
          📍
        </span>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value.trim().length >= 2) needCities();
          }}
          onBlur={onTouched}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              add(results[0]);
            }
          }}
          placeholder="Search a country, state, county or city — e.g. Alabama, Montgomery…"
          aria-label="Search places"
        />
      </div>
      {q.trim().length >= 2 && (
        <div className="popover req-picker place-pop" role="listbox" aria-label="Matching places">
          <div className="req-picker-body">
            {results.map((p) => (
              <PlaceRow key={p.id} place={p} onPick={() => add(p)} />
            ))}
            {results.length === 0 && (
              <p className="req-picker-empty">
                {citiesLoaded() ? `No place matches “${q}” — add it as free text below.` : "Searching…"}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PlaceRow({ place, onPick }: { place: Place; onPick: () => void }) {
  return (
    <button type="button" className="req-picker-row" onMouseDown={(e) => e.preventDefault()} onClick={onPick}>
      <span className="req-picker-plus">＋</span>
      <span className="req-picker-name">{place.label}</span>
      <span className={`req-badge place-lvl place-lvl-${place.level}`}>{place.level}</span>
    </button>
  );
}
