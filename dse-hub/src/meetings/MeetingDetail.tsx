import type { Meeting } from "../types";
import { JOIN_ICON, JOIN_LABEL } from "../colors";
import { useViewTz } from "../TzContext";
import { formatRangeInTz } from "../tz";
import { toISO } from "../calendar";
import { nextOccurrence } from "./recurrence";
import { piCalendar } from "./data";
import HoldToDelete from "./HoldToDelete";

// The full, expanded content for a meeting — reused as the hover body of a list card and as the
// body of the calendar popover, so both show the same complete information.
export default function MeetingDetail({
  meeting,
  onEdit,
  onDelete,
}: {
  meeting: Meeting;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { schedule, join } = meeting;
  const { tz: viewTz } = useViewTz();
  const today = toISO(new Date());
  const refDate = nextOccurrence(meeting, today, piCalendar) ?? today;
  const sourceTz = meeting.schedule.tz ?? "America/Chicago";
  const convertedTime = schedule.start
    ? formatRangeInTz(schedule.start, schedule.end, sourceTz, viewTz, refDate)
    : null;

  return (
    <>
      <dl className="mdetail">
      {meeting.category && (
        <div className="mrow">
          <dt>Category</dt>
          <dd><span className="cat-badge">{meeting.category}</span></dd>
        </div>
      )}
      {meeting.purpose && (
        <div className="mrow">
          <dt>Purpose</dt>
          <dd>{meeting.purpose}</dd>
        </div>
      )}
      <div className="mrow">
        <dt>When</dt>
        <dd>
          {schedule.text}
          {convertedTime && (
            <span className="ct"> · {convertedTime}</span>
          )}
        </dd>
      </div>
      {meeting.organizer && (
        <div className="mrow">
          <dt>Organizer</dt>
          <dd>{meeting.organizer}</dd>
        </div>
      )}
      {meeting.facilitator && (
        <div className="mrow">
          <dt>Facilitator</dt>
          <dd>{meeting.facilitator}</dd>
        </div>
      )}
      {join && (
        <div className="mrow">
          <dt>Join</dt>
          <dd>
            <span className="join-icon">{JOIN_ICON[join.method]}</span>{" "}
            {join.url ? (
              <a href={join.url} target="_blank" rel="noreferrer">
                {JOIN_LABEL[join.method]} ↗
              </a>
            ) : (
              JOIN_LABEL[join.method]
            )}
            {join.note ? ` — ${join.note}` : ""}
          </dd>
        </div>
      )}
      {meeting.notes && (
        <div className="mrow">
          <dt>Notes</dt>
          <dd>{meeting.notes}</dd>
        </div>
      )}
      </dl>
      {(onEdit || onDelete) && (
        <div className="mdetail-actions">
          {onEdit && <button className="btn" onClick={onEdit}>✎ Edit meeting</button>}
          {onDelete && <HoldToDelete onComplete={onDelete} />}
        </div>
      )}
    </>
  );
}
