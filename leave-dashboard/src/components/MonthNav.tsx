// The primary control on the page: nearly everyone lands here to answer "who's out in <month>",
// so month traversal gets the centre of the layout rather than a corner of the header. Three ways
// to move, because different people reach for different ones: big arrows, a direct pill per month,
// and the ← / → keys.
import { useEffect } from "react";
import type { MonthKey } from "../compute";
import { MONTH_NAMES, sameMonth } from "../compute";

interface Props {
  months: MonthKey[];
  month: MonthKey;
  onMonth: (m: MonthKey) => void;
}

export default function MonthNav({ months, month, onMonth }: Props) {
  const idx = months.findIndex((m) => sameMonth(m, month));
  const canPrev = idx > 0;
  const canNext = idx >= 0 && idx < months.length - 1;

  // ← / → step months, but never while someone is typing in the person search or the add form.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft" && canPrev) { e.preventDefault(); onMonth(months[idx - 1]); }
      if (e.key === "ArrowRight" && canNext) { e.preventDefault(); onMonth(months[idx + 1]); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [months, idx, canPrev, canNext, onMonth]);

  const now = new Date();
  const thisMonth: MonthKey = { year: now.getFullYear(), month: now.getMonth() };
  const todayIdx = months.findIndex((m) => sameMonth(m, thisMonth));

  return (
    <div className="monthnav-big" role="group" aria-label="Choose month">
      <button
        className="mn-arrow"
        onClick={() => canPrev && onMonth(months[idx - 1])}
        disabled={!canPrev}
        aria-label="Previous month"
        title="Previous month (←)"
      >
        ‹
      </button>

      <div className="mn-center">
        <div className="mn-label">
          {MONTH_NAMES[month.month]} <span className="mn-year">{month.year}</span>
        </div>
        <div className="mn-pills">
          {months.map((m) => {
            const active = sameMonth(m, month);
            const isToday = sameMonth(m, thisMonth);
            return (
              <button
                key={`${m.year}-${m.month}`}
                className={`mn-pill${active ? " active" : ""}${isToday ? " today" : ""}`}
                onClick={() => onMonth(m)}
                aria-current={active ? "true" : undefined}
                title={`${MONTH_NAMES[m.month]} ${m.year}${isToday ? " · this month" : ""}`}
              >
                {MONTH_NAMES[m.month].slice(0, 3)}
                <span className="mn-pill-year">’{String(m.year).slice(2)}</span>
              </button>
            );
          })}
          {todayIdx >= 0 && !sameMonth(month, thisMonth) && (
            <button className="mn-today" onClick={() => onMonth(months[todayIdx])} title="Jump to the current month">
              Today
            </button>
          )}
        </div>
      </div>

      <button
        className="mn-arrow"
        onClick={() => canNext && onMonth(months[idx + 1])}
        disabled={!canNext}
        aria-label="Next month"
        title="Next month (→)"
      >
        ›
      </button>
    </div>
  );
}
