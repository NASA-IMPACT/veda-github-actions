import type { MonthKey } from "../compute";
import { MONTH_NAMES } from "../compute";
import type { Theme } from "../theme";

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
  theme: Theme;
  onToggleTheme: () => void;
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

function absoluteTime(iso: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// The Google Sheet is re-exported hourly, so anything older than a few hours means the sync is
// broken — and a silently stale dashboard is the exact failure this app already had once.
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

function isStale(iso: string): boolean {
  const then = new Date(iso).getTime();
  return !Number.isNaN(then) && Date.now() - then > STALE_AFTER_MS;
}

export default function Header(props: Props) {
  const { source, generated, view, onView, month, canPrev, canNext, onPrev, onNext, refreshing, onRefresh, theme, onToggleTheme } = props;
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
            className={isStale(generated) ? "freshness stale" : "freshness"}
            title={
              `Leave data last updated ${generated ? new Date(generated).toLocaleString() : "—"}. ` +
              `The Google Sheet is re-read every hour; an "Add leave" PR merges itself and shows up ` +
              `within a couple of minutes.` +
              (isStale(generated) ? " This is older than expected — the hourly sync may be failing." : "")
            }
          >
            {isStale(generated) ? "⚠ " : ""}Updated {absoluteTime(generated)} ({relativeTime(generated)})
          </span>{" "}
          <button className="btn linkbtn" onClick={onRefresh} disabled={refreshing} title="Re-fetch the latest report">
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </div>
      <div className="monthnav">
        <button
          className="btn iconbtn"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
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
