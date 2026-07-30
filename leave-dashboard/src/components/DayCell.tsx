import { useState } from "react";
import type { GridDay, PersonLeave } from "../compute";
import { personColor, STATUS_LABEL } from "../colors";

interface Props {
  day: GridDay;
  entries: PersonLeave[];
  today: string;
}

const MAX_BARS = 4;

export default function DayCell({ day, entries, today }: Props) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? entries : entries.slice(0, MAX_BARS);
  const hidden = entries.length - shown.length;
  const cls = ["cell"];
  if (day.weekend) cls.push("weekend");
  if (!day.inMonth) cls.push("out-month");
  if (day.iso === today) cls.push("today");

  return (
    <div className={cls.join(" ")}>
      <div className="daynum">{day.date.getDate()}</div>
      {shown.map(({ person, leave }) => (
        <span
          key={person.slug}
          className={`bar ${leave.status === "limited" ? "limited" : ""}`}
          style={{ background: personColor(person.slug) }}
          title={`${person.name} — ${STATUS_LABEL[leave.status]}${leave.note ? ` (${leave.note})` : ""}`}
        >
          <span className="n">{person.name}</span>
        </span>
      ))}
      {hidden > 0 && (
        <span className="more" onClick={() => setExpanded(true)}>
          +{hidden} more
        </span>
      )}
    </div>
  );
}
