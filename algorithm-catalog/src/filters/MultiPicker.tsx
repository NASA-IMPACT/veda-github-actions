// ONE multi-select pill+popover, used by every facet in the app.
//
// Factored from dse-hub's TeamFilter (flat list) and SprintFilter (2-level groups) — they were the
// same component twice with a nesting level in between — plus leave-dashboard's PersonPicker
// in-popover search. Grouping turns on when an option carries a `group`; the search box turns on
// with `searchable`. Nothing else about the three differed.

import { useMemo, useRef, useState } from "react";
import { useClickAway } from "../useClickAway";

export interface PickerOption {
  id: string;
  label: string;
  /** Data color (hazard color, modality accent) — rendered as a swatch, never themed. */
  color?: string;
  /** Optional group heading; options with the same group render under one toggleable header. */
  group?: string;
}

interface Props {
  /** Plural noun for the button: "hazards" → "All hazards" / "2 of 10 hazards". */
  label: string;
  icon?: string;
  options: PickerOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
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

  const grouped = options.some((o) => o.group);

  // Group order follows first appearance, which keeps catalog order (optical → SAR → night lights)
  // instead of re-alphabetizing it.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map<string, PickerOption[]>();
    for (const o of options) {
      if (needle && !o.label.toLowerCase().includes(needle) && !o.id.toLowerCase().includes(needle)) {
        const g = (o.group ?? "").toLowerCase();
        if (!g.includes(needle)) continue;
      }
      const key = o.group ?? "";
      const arr = out.get(key) ?? [];
      arr.push(o);
      out.set(key, arr);
    }
    return [...out.entries()];
  }, [options, q]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function toggleGroup(members: PickerOption[]) {
    const allOn = members.every((m) => selected.has(m.id));
    const next = new Set(selected);
    for (const m of members) {
      if (allOn) next.delete(m.id);
      else next.add(m.id);
    }
    onChange(next);
  }

  const buttonLabel =
    selected.size === options.length
      ? `All ${label}`
      : selected.size === 0
        ? `No ${label}`
        : `${selected.size} of ${options.length} ${label}`;

  const narrowed = selected.size !== options.length;

  return (
    <div className="control" ref={ref}>
      <button
        type="button"
        className={narrowed ? "btn narrowed" : "btn"}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {icon && <span aria-hidden>{icon}</span>} {buttonLabel} <span aria-hidden>▾</span>
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
            <button type="button" onClick={() => onChange(new Set(options.map((o) => o.id)))}>
              All
            </button>
            <button type="button" onClick={() => onChange(new Set())}>
              Clear
            </button>
          </div>

          {groups.map(([group, members]) => (
            <div key={group || "_"} className={grouped ? "pop-group" : undefined}>
              {grouped && group && (
                <label className="row row-group">
                  <input
                    type="checkbox"
                    checked={members.every((m) => selected.has(m.id))}
                    onChange={() => toggleGroup(members)}
                  />
                  <span className="row-group-name">{group}</span>
                </label>
              )}
              {members.map((o) => (
                <label key={o.id} className={grouped && group ? "row row-child" : "row"}>
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                  {o.color && <span className="sw" style={{ background: o.color }} aria-hidden />}
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          ))}

          {groups.length === 0 && <p className="pop-empty">No matches</p>}
        </div>
      )}
    </div>
  );
}
