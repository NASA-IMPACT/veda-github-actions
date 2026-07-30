import type { Person } from "../types";
import { personColor } from "../colors";

interface Props {
  people: Person[]; // people visible in the current calendar view (with a leave shown)
}

// Per-person legend (matches the mockup) + a compact status key.
export default function Legend({ people }: Props) {
  return (
    <div className="legend panel">
      <h3>People</h3>
      <div className="items">
        {people.length === 0 && <span className="item">No one out in this view.</span>}
        {people.map((p) => (
          <span className="item" key={p.slug}>
            <span className="sw" style={{ background: personColor(p.slug) }} />
            {p.name}
            <span style={{ color: "var(--muted)" }}>· {p.team}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
