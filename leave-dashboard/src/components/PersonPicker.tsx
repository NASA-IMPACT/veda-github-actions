import { useMemo, useState } from "react";
import type { Person } from "../types";
import { personColor } from "../colors";

interface Props {
  people: Person[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

// "Build a calendar from a chosen subset of people" — a searchable multi-select grouped by team.
export default function PersonPicker({ people, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const byTeam = new Map<string, Person[]>();
    for (const p of people) {
      if (q && !p.name.toLowerCase().includes(q.toLowerCase()) && !p.team.toLowerCase().includes(q.toLowerCase()))
        continue;
      const arr = byTeam.get(p.team) ?? [];
      arr.push(p);
      byTeam.set(p.team, arr);
    }
    return [...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [people, q]);

  function toggle(slug: string) {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onChange(next);
  }
  function setAll(on: boolean) {
    onChange(on ? new Set(people.map((p) => p.slug)) : new Set());
  }

  const label =
    selected.size === people.length ? "All people" : `${selected.size} of ${people.length} people`;

  return (
    <div className="control">
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        👥 {label} ▾
      </button>
      {open && (
        <div className="popover panel" onMouseLeave={() => setOpen(false)}>
          <input
            className="search"
            placeholder="Search people or teams…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="actions">
            <button onClick={() => setAll(true)}>Select all</button>
            <button onClick={() => setAll(false)}>Clear</button>
          </div>
          {groups.map(([team, members]) => (
            <div key={team}>
              <div className="grouphdr">{team}</div>
              {members.map((p) => (
                <label key={p.slug} className="row">
                  <input
                    type="checkbox"
                    checked={selected.has(p.slug)}
                    onChange={() => toggle(p.slug)}
                  />
                  <span className="sw" style={{ background: personColor(p.slug) }} />
                  <span>{p.name}</span>
                  {p.role && <span className="team">{p.role}</span>}
                </label>
              ))}
            </div>
          ))}
          {groups.length === 0 && <div className="grouphdr">No matches</div>}
        </div>
      )}
    </div>
  );
}
