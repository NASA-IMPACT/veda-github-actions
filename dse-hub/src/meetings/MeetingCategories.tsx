import { useMemo, useState } from "react";
import type { Meeting } from "../types";
import { toISO } from "../calendar";
import { teamColor } from "../colors";
import MeetingDetail from "./MeetingDetail";
import { useViewTz } from "../TzContext";
import { formatRangeInTz } from "../tz";
import { nextOccurrence } from "./recurrence";
import { piCalendar } from "./data";

// Third view (next to List/Calendar): a grid of category cards → click a category → a searchable
// list of its meetings → click a meeting → expands to the shared MeetingDetail (same info + Edit).
interface Props {
  meetings: Meeting[];
  onEdit?: (m: Meeting) => void;
  onDelete?: (m: Meeting) => void;
}

function matchWithin(m: Meeting, q: string): boolean {
  if (!q) return true;
  const hay = [m.name, m.team, m.purpose, m.organizer, m.facilitator, m.notes, m.schedule.text]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default function MeetingCategories({ meetings, onEdit, onDelete }: Props) {
  const { tz: viewTz } = useViewTz();
  const today = toISO(new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const cats = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of meetings) {
      const c = (m.category && m.category.trim()) || "Uncategorized";
      const arr = map.get(c) ?? [];
      arr.push(m);
      map.set(c, arr);
    }
    return [...map.entries()]
      .map(([name, items]) => ({ name, items, teams: [...new Set(items.map((i) => i.team))].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [meetings]);

  if (!selected) {
    return (
      <div className="cat-view">
        {cats.length === 0 ? (
          <p className="empty">No meetings match your search.</p>
        ) : (
          <div className="cat-grid">
            {cats.map((c) => (
              <button
                key={c.name}
                className="cat-card"
                onClick={() => { setSelected(c.name); setQ(""); setExpanded(null); }}
              >
                <span className="cat-card-name">{c.name}</span>
                <span className="cat-card-count">{c.items.length} meeting{c.items.length === 1 ? "" : "s"}</span>
                <span className="cat-card-teams">
                  {c.teams.slice(0, 4).join(" · ")}{c.teams.length > 4 ? " …" : ""}
                </span>
                <span className="cat-card-cta">View meetings →</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const group = cats.find((c) => c.name === selected);
  const items = (group?.items ?? []).filter((m) => matchWithin(m, q));

  return (
    <div className="cat-view">
      <div className="cat-detail-head">
        <button className="btn" onClick={() => setSelected(null)}>← All categories</button>
        <h2 className="cat-detail-title">{selected}</h2>
        <span className="count">{items.length} meeting{items.length === 1 ? "" : "s"}</span>
      </div>

      <div className="search cat-search">
        <span className="search-ico" aria-hidden>🔍</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${selected} meetings…`}
          aria-label="Search category meetings"
        />
        {q && <button className="search-x" onClick={() => setQ("")} aria-label="Clear search">×</button>}
      </div>

      <div className="cat-mtg-list">
        {items.length === 0 ? (
          <p className="empty">No meetings match your search.</p>
        ) : (
          items.map((m) => {
            const sourceTz = m.schedule.tz ?? "America/Chicago";
            const refDate = nextOccurrence(m, today, piCalendar) ?? today;
            const time = formatRangeInTz(m.schedule.start, m.schedule.end, sourceTz, viewTz, refDate);
            const isOpen = expanded === m.id;
            return (
              <div key={m.id} className="pop-day-item">
                <button
                  className="pop-day-item-btn"
                  style={{ borderLeftColor: teamColor(m.team) }}
                  onClick={() => setExpanded(isOpen ? null : m.id)}
                  aria-expanded={isOpen}
                >
                  <span className="pop-day-item-dot" style={{ background: teamColor(m.team) }} />
                  <span className="pop-day-item-info">
                    <span className="pop-day-item-name">{m.name}</span>
                    <span className="pop-day-item-meta">
                      <span className="pop-day-item-team">{m.team}</span>
                      {time && <span className="pop-day-item-time">{time}</span>}
                    </span>
                  </span>
                  <span className="pop-day-item-chevron">{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div className="pop-day-item-detail">
                    <MeetingDetail
                      meeting={m}
                      onEdit={onEdit ? () => onEdit(m) : undefined}
                      onDelete={onDelete ? () => onDelete(m) : undefined}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
