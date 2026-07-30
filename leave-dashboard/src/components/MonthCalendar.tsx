import { useState } from "react";
import type { MonthKey, PersonLeave } from "../compute";
import { monthGrid, WEEKDAYS } from "../compute";
import DayCell from "./DayCell";

interface Props {
  month: MonthKey;
  byDate: Map<string, PersonLeave[]>;
  today: string;
}

export default function MonthCalendar({ month, byDate, today }: Props) {
  const weeks = monthGrid(month);
  // Hovering a person's bar spotlights that person across the whole calendar and dims everyone else.
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div className={`cal panel ${hovered ? "dimming" : ""}`}>
      <div className="dow">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={i === 0 || i === 6 ? "we" : ""}>
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div className="week" key={wi}>
          {week.map((day) => (
            <DayCell
              key={day.iso}
              day={day}
              entries={byDate.get(day.iso) ?? []}
              today={today}
              hovered={hovered}
              onHover={setHovered}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
