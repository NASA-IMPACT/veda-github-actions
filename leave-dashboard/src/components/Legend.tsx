import { useMemo } from "react";
import type { Person } from "../types";
import { personColor } from "../colors";

interface Props {
  people: Person[]; // people visible in the current calendar view (with a leave shown)
}

// Per-person legend, grouped by team.
export default function Legend({ people }: Props) {
  const byTeam = useMemo(() => {
    const m = new Map<string, Person[]>();
    for (const p of people) {
      const arr = m.get(p.team) ?? [];
      arr.push(p);
      m.set(p.team, arr);
    }
    return [...m.entries()]
      .map(([team, members]) => [team, members.sort((a, b) => a.name.localeCompare(b.name))] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [people]);

  return (
    <div className="legend panel">
      <h3>People by team</h3>
      {people.length === 0 ? (
        <span className="item">No one out in this view.</span>
      ) : (
        <div className="legend-teams">
          {byTeam.map(([team, members]) => (
            <div className="legend-team" key={team}>
              <div className="lt-name">{team} <span className="lt-count">({members.length})</span></div>
              <div className="items">
                {members.map((p) => (
                  <span className="item" key={p.slug}>
                    <span className="sw" style={{ background: personColor(p.slug) }} />
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
