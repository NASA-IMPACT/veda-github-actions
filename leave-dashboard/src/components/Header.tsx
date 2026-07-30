import type { MonthKey } from "../compute";
import { MONTH_NAMES } from "../compute";

interface Props {
  source: "live" | "snapshot";
  generated: string;
  view: "calendar" | "risk";
  onView: (v: "calendar" | "risk") => void;
  month: MonthKey;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export default function Header(props: Props) {
  const { source, generated, view, onView, month, canPrev, canNext, onPrev, onNext } = props;
  const genLabel = generated ? new Date(generated).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  }) : "—";
  return (
    <div className="header">
      <div>
        <h1>Team Out-of-Office &amp; Leave</h1>
        <div className="sub">
          <span className={`badge ${source === "snapshot" ? "snapshot" : ""}`}>
            <span className="dot" />
            {source === "live" ? "Live" : "Snapshot"}
          </span>{" "}
          &nbsp;as of {genLabel}
        </div>
      </div>
      <div className="monthnav">
        <div className="seg" role="tablist" aria-label="View">
          <button className={view === "calendar" ? "active" : ""} onClick={() => onView("calendar")}>
            Calendar
          </button>
          <button className={view === "risk" ? "active" : ""} onClick={() => onView("risk")}>
            Team risk
          </button>
        </div>
        {view === "calendar" && (
          <>
            <button className="btn iconbtn" onClick={onPrev} disabled={!canPrev} aria-label="Previous month">
              ‹
            </button>
            <div className="label">
              {MONTH_NAMES[month.month]} {month.year}
            </div>
            <button className="btn iconbtn" onClick={onNext} disabled={!canNext} aria-label="Next month">
              ›
            </button>
          </>
        )}
      </div>
    </div>
  );
}
