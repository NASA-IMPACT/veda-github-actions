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
  refreshing: boolean;
  onRefresh: () => void;
}

function relativeTime(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function Header(props: Props) {
  const { source, generated, view, onView, month, canPrev, canNext, onPrev, onNext, refreshing, onRefresh } = props;
  return (
    <div className="header">
      <div>
        <h1>Team Out-of-Office &amp; Leave</h1>
        <div className="sub">
          <span className={`badge ${source === "snapshot" ? "snapshot" : ""}`}>
            <span className="dot" />
            {source === "live" ? "Live" : "Snapshot"}
          </span>{" "}
          <span
            title={`Report generated ${generated ? new Date(generated).toLocaleString() : "—"}. A just-merged change can take a few minutes to appear (GitHub CDN).`}
          >
            Updated {relativeTime(generated)}
          </span>{" "}
          <button className="btn linkbtn" onClick={onRefresh} disabled={refreshing} title="Re-fetch the latest report">
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
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
