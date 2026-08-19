// ONE multi-select pill+popover, used by every facet in the app.
//
// Adapted from algorithm-catalog/src/filters/MultiPicker.tsx, with one semantic change: there,
// state starts fully selected and a facet narrows only as a strict subset. Here an EMPTY
// selection means "unconstrained", matching GitHub's grammar (`label:bug` means only bug) and
// suiting this board's large vocabularies — 33 sprints and 22 people are not something you
// narrow by unticking 21 boxes.
//
// Options carry live counts: how many items you would get if you also picked this one.

import { useMemo, useRef, useState } from "react";
import { useClickAway } from "../useClickAway";

export interface PickerOption {
  id: string;
  label: string;
  /** Data colour (person, label, status option) — rendered as a swatch, never themed. */
  color?: string;
  count?: number;
}

interface Props {
  /** Plural noun for the button: "labels" -> "All labels" / "2 labels". */
  label: string;
  icon?: string;
  options: PickerOption[];
  /** Currently included values. Empty = no constraint. */
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
}

export default function MultiPicker({
  label,
  icon,
  options,
  selected,
  onChange,
  searchable = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);

  const chosen = useMemo(
    () => new Set(selected.map((s) => s.toLowerCase())),
    [selected],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(needle) || o.id.toLowerCase().includes(needle),
    );
  }, [options, q]);

  function toggle(id: string) {
    onChange(
      chosen.has(id.toLowerCase())
        ? selected.filter((s) => s.toLowerCase() !== id.toLowerCase())
        : [...selected, id],
    );
  }

  const narrowed = selected.length > 0;
  const buttonLabel = narrowed
    ? selected.length === 1
      ? selected[0]
      : `${selected.length} ${label}`
    : `All ${label}`;

  return (
    <div className="control" ref={ref}>
      <button
        type="button"
        className={narrowed ? "btn narrowed" : "btn"}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {icon && <span aria-hidden>{icon}</span>} <span className="btn-label">{buttonLabel}</span>{" "}
        <span aria-hidden>▾</span>
      </button>

      {open && (
        <div className="popover panel">
          {searchable && (
            <input
              className="pop-search"
              placeholder={`Search ${label}…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={`Search ${label}`}
              autoFocus
            />
          )}

          <div className="actions">
            <span className="pop-count">
              {narrowed ? `${selected.length} selected` : "no filter"}
            </span>
            <button type="button" onClick={() => onChange([])} disabled={!narrowed}>
              Clear
            </button>
          </div>

          {shown.map((o) => (
            <label key={o.id} className="row">
              <input
                type="checkbox"
                checked={chosen.has(o.id.toLowerCase())}
                onChange={() => toggle(o.id)}
              />
              {o.color && <span className="sw" style={{ background: o.color }} aria-hidden />}
              <span className="row-name">{o.label}</span>
              {o.count !== undefined && <span className="row-count">{o.count}</span>}
            </label>
          ))}

          {shown.length === 0 && <p className="pop-empty">No matches</p>}
        </div>
      )}
    </div>
  );
}
