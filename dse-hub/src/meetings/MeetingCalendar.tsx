import { useMemo, useState, type CSSProperties } from "react";
import type { Meeting, Pi, PiCalendar, Sprint } from "../types";
import { sprintAccent, sprintBand, teamColor } from "../colors";
import {
  addMonths, formatShortDate, MONTH_NAMES, monthEndISO, monthGrid,
  monthKey, monthStartISO, parseISO, WEEKDAYS,
} from "../calendar";
import { isUnscheduled, occurrencesInRange } from "./recurrence";
import { pis } from "../pi/data";
import { sprintForDate, sprintLabel } from "../pi/pi";
import MeetingDetail from "./MeetingDetail";
import { useViewTz } from "../TzContext";
import { formatRangeInTz } from "../tz";

interface Props {
  meetings: Meeting[];
  pi: PiCalendar | null;
  today: string;
  draftIds: Set<string>;
  onEdit?: (m: Meeting) => void;
}

// What's shown when a user clicks — either a single meeting or a whole day's list.
type Selection =
  | { kind: "meeting"; meeting: Meeting; iso: string }
  | { kind: "day"; iso: string; meetings: Meeting[] };

const MAX_VISIBLE = 3;

function MeetingPopoverContent({
  meeting,
  iso,
  isDraft,
  onClose,
  onEdit,
  viewTz,
}: {
  meeting: Meeting;
  iso: string;
  isDraft: boolean;
  onClose: () => void;
  onEdit?: () => void;
  viewTz: string;
}) {
  const sourceTz = meeting.schedule.tz ?? "America/Chicago";
  const time = formatRangeInTz(meeting.schedule.start, meeting.schedule.end, sourceTz, viewTz, iso);
  return (
    <>
      <div className="pop-head" style={{ borderTopColor: teamColor(meeting.team) }}>
        <span className="team-badge" style={{ background: teamColor(meeting.team) }}>
          {meeting.team}
        </span>
        <div className="pop-title-block">
          <h3 className="pop-title">{meeting.name}</h3>
          <div className="pop-when">
            {formatShortDate(iso)}
            {time ? ` · ${time}` : ""}
            {isDraft && <span className="draft-tag" style={{ marginLeft: "0.4rem" }}>preview</span>}
          </div>
        </div>
        <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="pop-body">
        <MeetingDetail meeting={meeting} onEdit={onEdit} />
      </div>
    </>
  );
}

function DayPopoverContent({
  iso,
  meetings,
  draftIds,
  onClose,
  onEdit,
  viewTz,
}: {
  iso: string;
  meetings: Meeting[];
  draftIds: Set<string>;
  onClose: () => void;
  onEdit?: (m: Meeting) => void;
  viewTz: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      <div className="pop-head pop-head-day">
        <h3 className="pop-title">{formatShortDate(iso)}</h3>
        <span className="pop-day-count">{meetings.length} meetings</span>
        <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="pop-body pop-day-list">
        {meetings.map((m) => {
          const sourceTz = m.schedule.tz ?? "America/Chicago";
          const time = formatRangeInTz(m.schedule.start, m.schedule.end, sourceTz, viewTz, iso);
          const isOpen = expanded === m.id;
          return (
            <div key={m.id} className={`pop-day-item ${draftIds.has(m.id) ? "draft" : ""}`}>
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
                    {m.category && (
                      <span className="cat-badge">{m.category}</span>
                    )}
                    {time && <span className="pop-day-item-time">{time}</span>}
                  </span>
                </span>
                <span className="pop-day-item-chevron">{isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div className="pop-day-item-detail">
                  <MeetingDetail meeting={m} onEdit={onEdit ? () => onEdit(m) : undefined} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function MeetingCalendar({ meetings, pi, today, draftIds, onEdit }: Props) {
  const { tz: viewTz } = useViewTz();
  const [month, setMonth] = useState(() => monthKey(parseISO(today)));
  const [selection, setSelection] = useState<Selection | null>(null);

  const weeks = monthGrid(month);
  const startISO = monthStartISO(month);
  const endISO = monthEndISO(month);

  // isoDate -> meetings occurring that day, sorted by start time then name.
  const byDate = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of meetings) {
      if (isUnscheduled(m)) continue;
      for (const iso of occurrencesInRange(m, startISO, endISO, pi)) {
        const arr = map.get(iso) ?? [];
        arr.push(m);
        map.set(iso, arr);
      }
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ta = a.schedule.start ?? "99:99";
        const tb = b.schedule.start ?? "99:99";
        return ta.localeCompare(tb) || a.name.localeCompare(b.name);
      });
    }
    return map;
  }, [meetings, startISO, endISO, pi]);

  const unscheduled = meetings.filter(isUnscheduled);

  // Sprints intersecting the visible month — drives the band tint + the legend below the grid.
  const visibleSprints = useMemo(() => {
    const seen = new Set<string>();
    const out: { pi: Pi; sprint: Sprint }[] = [];
    for (const p of pis) {
      for (const s of p.sprints) {
        const key = `${p.id}#${s.index}`;
        if (s.start <= endISO && s.end >= startISO && !seen.has(key)) {
          seen.add(key);
          out.push({ pi: p, sprint: s });
        }
      }
    }
    return out;
  }, [startISO, endISO]);

  function openMeeting(m: Meeting, iso: string) {
    setSelection({ kind: "meeting", meeting: m, iso });
  }

  function openDay(iso: string, dayMeetings: Meeting[]) {
    setSelection({ kind: "day", iso, meetings: dayMeetings });
  }

  function closeSelection() {
    setSelection(null);
  }

  function handleEdit(m: Meeting) {
    setSelection(null);
    onEdit?.(m);
  }

  return (
    <div className="cal-wrap">
      <div className="cal-main">
        {/* Month navigation */}
        <div className="cal-head">
          <button
            className="navbtn"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            aria-label="Previous month"
          >
            ‹
          </button>
          <h2 className="cal-title">
            {MONTH_NAMES[month.month]} {month.year}
          </h2>
          <button
            className="navbtn"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label="Next month"
          >
            ›
          </button>
          <button
            className="btn today-btn"
            onClick={() => setMonth(monthKey(parseISO(today)))}
          >
            Today
          </button>
        </div>

        {/* Calendar grid */}
        <div className="cal">
          <div className="dow">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className={i === 0 || i === 6 ? "we" : ""}>
                {d}
              </div>
            ))}
          </div>

          {weeks.map((week, wi) => (
            <div className="week" key={wi}>
              {week.map((day) => {
                const items = byDate.get(day.iso) ?? [];
                const visible = items.slice(0, MAX_VISIBLE);
                const overflow = items.length - MAX_VISIBLE;

                const ps = sprintForDate(pis, day.iso);
                const cellStyle: CSSProperties = {};
                if (ps && day.inMonth) {
                  // inset shadow (not a border) so the strip takes NO layout width — keeps every
                  // column perfectly aligned whether or not a day is inside a sprint.
                  cellStyle.boxShadow = `inset 3px 0 0 0 ${sprintAccent(ps.pi.id, ps.sprint.index)}`;
                  if (day.iso !== today && !day.weekend) {
                    cellStyle.background = sprintBand(ps.pi.id, ps.sprint.index);
                  }
                }

                const cls = ["cell"];
                if (day.weekend) cls.push("weekend");
                if (!day.inMonth) cls.push("out-month");
                if (day.iso === today) cls.push("today");

                return (
                  <div className={cls.join(" ")} style={cellStyle} key={day.iso}>
                    <div className="daynum-row">
                      <span className="daynum">{day.date.getDate()}</span>
                      {ps && day.iso === ps.sprint.start && (
                        <span
                          className="sprint-tag"
                          style={{ background: sprintAccent(ps.pi.id, ps.sprint.index) }}
                          title={`${ps.pi.name} · ${sprintLabel(ps.sprint)}`}
                        >
                          S{ps.sprint.index}
                        </span>
                      )}
                      {items.length > 0 && (
                        <span className="day-count">{items.length}</span>
                      )}
                    </div>

                    {visible.map((m) => {
                      const sourceTz = m.schedule.tz ?? "America/Chicago";
                      const time = m.schedule.start
                        ? formatRangeInTz(m.schedule.start, undefined, sourceTz, viewTz, day.iso)
                        : "";
                      const label = m.category ?? m.name;
                      return (
                        <button
                          key={m.id}
                          className={`chip ${draftIds.has(m.id) ? "draft" : ""}`}
                          style={{ background: teamColor(m.team) }}
                          title={`${m.team} — ${m.name}${time ? ` · ${time}` : ""}`}
                          onClick={() => openMeeting(m, day.iso)}
                        >
                          {time && (
                            <span className="chip-time">{time}</span>
                          )}
                          <span className="chip-name">{label}</span>
                        </button>
                      );
                    })}

                    {overflow > 0 && (
                      <button
                        className="chip-overflow"
                        onClick={() => openDay(day.iso, items)}
                      >
                        +{overflow} more
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {visibleSprints.length > 0 && (
          <div className="cal-legend">
            {visibleSprints.map(({ pi: p, sprint }) => (
              <span key={`${p.id}#${sprint.index}`} className="cal-legend-item">
                <span className="legend-sw" style={{ background: sprintAccent(p.id, sprint.index) }} />
                {p.name} · {sprintLabel(sprint)}
              </span>
            ))}
          </div>
        )}

        {/* Inline popover — rendered below the grid, absolutely positioned via JS would be complex;
            use a fixed overlay instead so it's always in view. */}
        {selection && (
          <div className="overlay" onClick={closeSelection}>
            <div
              className="cal-popover-wrap panel"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              {selection.kind === "meeting" ? (
                <MeetingPopoverContent
                  meeting={selection.meeting}
                  iso={selection.iso}
                  isDraft={draftIds.has(selection.meeting.id)}
                  onClose={closeSelection}
                  onEdit={onEdit ? () => handleEdit(selection.meeting) : undefined}
                  viewTz={viewTz}
                />
              ) : (
                <DayPopoverContent
                  iso={selection.iso}
                  meetings={selection.meetings}
                  draftIds={draftIds}
                  onClose={closeSelection}
                  onEdit={onEdit ? handleEdit : undefined}
                  viewTz={viewTz}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Unscheduled / TBD tray */}
      <aside className="cal-tray">
        <h3 className="tray-head">
          Unscheduled / TBD
          {unscheduled.length > 0 && (
            <span className="tray-count">{unscheduled.length}</span>
          )}
        </h3>
        {unscheduled.length === 0 ? (
          <p className="tray-empty">None — every meeting has a resolved schedule.</p>
        ) : (
          <ul className="tray-list">
            {unscheduled.map((m) => (
              <li key={m.id}>
                <button
                  className="tray-item"
                  style={{ borderLeftColor: teamColor(m.team) }}
                  onClick={() => openMeeting(m, today)}
                >
                  <span className="tray-team">{m.team}</span>
                  <span className="tray-name">{m.name}</span>
                  {m.category && (
                    <span className="cat-badge" style={{ alignSelf: "flex-start", marginTop: "0.15rem" }}>
                      {m.category}
                    </span>
                  )}
                  <span className="tray-text">{m.schedule.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
