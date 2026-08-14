// The date window: two native <input type="date">s, no date library (zero new deps — the whole app
// compares "YYYY-MM-DD" strings, which sort correctly as text, so no date math is needed at all).

interface Props {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  /** Honest note about what the window actually tests; omitted on the Events tab. */
  hint?: string;
  startLabel?: string;
  endLabel?: string;
}

export default function DateRange({
  start,
  end,
  onChange,
  hint,
  startLabel = "Start date",
  endLabel = "End date",
}: Props) {
  return (
    <div className="daterange">
      <div className="field two">
        <div>
          <label htmlFor="filter-start">{startLabel}</label>
          <input
            id="filter-start"
            type="date"
            value={start}
            max={end || undefined}
            onChange={(e) => onChange(e.target.value, end)}
          />
        </div>
        <div>
          <label htmlFor="filter-end">{endLabel}</label>
          <input
            id="filter-end"
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => onChange(start, e.target.value)}
          />
        </div>
      </div>
      {(start || end) && (
        <button type="button" className="linkbtn" onClick={() => onChange("", "")}>
          Clear dates
        </button>
      )}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
