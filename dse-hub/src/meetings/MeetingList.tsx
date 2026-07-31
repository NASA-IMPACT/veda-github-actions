import type { Meeting, PiCalendar } from "../types";
import { teamColor } from "../colors";
import { formatShortDate } from "../calendar";
import { nextOccurrence } from "./recurrence";
import MeetingDetail from "./MeetingDetail";
import { useViewTz } from "../TzContext";
import { formatRangeInTz } from "../tz";

interface Props {
  meetings: Meeting[];
  pi: PiCalendar | null;
  today: string;
  draftIds: Set<string>;
  onEdit?: (m: Meeting) => void;
  onDelete?: (m: Meeting) => void;
}

// Compact "when" line for the collapsed card: the human schedule text, plus the next real date.
function whenSummary(m: Meeting, today: string, pi: PiCalendar | null, viewTz: string): { text: string; next: string | null } {
  const iso = nextOccurrence(m, today, pi);
  const sourceTz = m.schedule.tz ?? "America/Chicago";
  const time = iso
    ? formatRangeInTz(m.schedule.start, m.schedule.end, sourceTz, viewTz, iso)
    : formatRangeInTz(m.schedule.start, m.schedule.end, sourceTz, viewTz, today);
  const next = iso ? `${formatShortDate(iso)}${time ? ` · ${time}` : ""}` : null;
  return { text: m.schedule.text, next };
}

export default function MeetingList({ meetings, pi, today, draftIds, onEdit, onDelete }: Props) {
  const { tz: viewTz } = useViewTz();

  if (!meetings.length) {
    return <p className="empty">No meetings match your search.</p>;
  }

  // Group by team (meetings arrive pre-sorted by team then name).
  const groups: { team: string; items: Meeting[] }[] = [];
  for (const m of meetings) {
    const g = groups[groups.length - 1];
    if (g && g.team === m.team) g.items.push(m);
    else groups.push({ team: m.team, items: [m] });
  }

  return (
    <div className="mlist">
      {groups.map((g) => (
        <section key={g.team} className="mgroup">
          <h2 className="mgroup-head">
            <span className="team-dot" style={{ background: teamColor(g.team) }} />
            {g.team}
            <span className="mgroup-count">{g.items.length}</span>
          </h2>
          <div className="mcards">
            {g.items.map((m) => {
              const w = whenSummary(m, today, pi, viewTz);
              return (
                <article
                  key={m.id}
                  className={`mcard ${draftIds.has(m.id) ? "draft" : ""}`}
                  tabIndex={0}
                  style={{ borderLeftColor: teamColor(m.team) }}
                >
                  <div className="mcard-top">
                    <h3 className="mcard-name">{m.name}</h3>
                    {draftIds.has(m.id) && <span className="draft-tag">preview</span>}
                  </div>
                  <div className="mcard-when">
                    <span className="when-text">{w.text}</span>
                    {w.next ? (
                      <span className="when-next">Next: {w.next}</span>
                    ) : (
                      <span className="when-next tbd">Unscheduled</span>
                    )}
                  </div>
                  <div className="mcard-body">
                    <MeetingDetail
                      meeting={m}
                      onEdit={onEdit ? () => onEdit(m) : undefined}
                      onDelete={onDelete ? () => onDelete(m) : undefined}
                    />
                  </div>
                  <span className="mcard-hint">Hover / focus for details</span>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
