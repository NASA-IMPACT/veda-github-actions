import { useMemo } from "react";
import type { JoinMethod, Meeting, Weekday } from "../types";
import { JOIN_LABEL, JOIN_ORDER } from "../colors";
import { buildMeetingFile, draftToMeeting, draftValid, MeetingDraft } from "./drafts";
import TimePicker from "./TimePicker";
import { TZ_OPTIONS } from "../tz";

const WEEK_ORDER: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const WEEK_LABEL: Record<Weekday, string> = {
  MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun",
};

interface Props {
  mode: "add" | "edit";
  editId?: string;
  draft: MeetingDraft;
  setDraft: (updater: MeetingDraft | ((d: MeetingDraft) => MeetingDraft)) => void;
  teams: string[];
  onPreview: () => void;
  onClose: () => void;
  onStage: (m: Meeting) => void;
}

export default function AddMeetingForm({ mode, editId, draft, setDraft, teams, onPreview, onClose, onStage }: Props) {
  const isEdit = mode === "edit";
  const patch = (p: Partial<MeetingDraft>) => setDraft((d) => ({ ...d, ...p }));

  function toggleDay(wd: Weekday) {
    setDraft((d) => {
      const has = d.byday.includes(wd);
      const next = has ? d.byday.filter((x) => x !== wd) : [...d.byday, wd];
      next.sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
      return { ...d, byday: next };
    });
  }

  const { filename, json } = useMemo(() => buildMeetingFile(draft, isEdit ? editId : undefined), [draft, isEdit, editId]);
  const valid = draftValid(draft);

  function handleStage() {
    const m = draftToMeeting(draft);
    if (isEdit && editId) m.id = editId;
    onStage(m);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isEdit ? "Edit meeting" : "Add meeting"}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="hint">
          Fill in the details below, then click <b>Add to changes</b> to stage this
          {isEdit ? " edit" : " meeting"} into the Changes cart. Open the cart (🧺 in the header)
          to submit all staged changes as one pull request.
          Use <b>Preview</b> to check the meeting on the calendar first.
        </p>

        <div className="field two">
          <div>
            <label>Team</label>
            <input list="teamlist" value={draft.team} onChange={(e) => patch({ team: e.target.value })} placeholder="Disasters — or a new team" />
            <datalist id="teamlist">{teams.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
          <div>
            <label>Meeting name</label>
            <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Weekly Check-In" />
          </div>
        </div>

        <div className="field two">
          <div>
            <label>Category <span className="opt">(optional)</span></label>
            <input
              list="catlist"
              value={draft.category}
              onChange={(e) => patch({ category: e.target.value })}
              placeholder="Sprint Planning, Check In, …"
            />
            <datalist id="catlist">
              {["Sprint Planning","Sprint Review","Check In","Tag Up","Standup","Sync","Team Lead Sync","Portal Design","Backlog Grooming","Retro","Project Office"].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label>Purpose <span className="opt">(optional)</span></label>
            <input value={draft.purpose} onChange={(e) => patch({ purpose: e.target.value })} placeholder="What this meeting is for" />
          </div>
        </div>

        <div className="field two">
          <div>
            <label>Organizer <span className="opt">(optional)</span></label>
            <input value={draft.organizer} onChange={(e) => patch({ organizer: e.target.value })} placeholder="@name" />
          </div>
          <div>
            <label>Facilitator <span className="opt">(optional)</span></label>
            <input value={draft.facilitator} onChange={(e) => patch({ facilitator: e.target.value })} placeholder="@name" />
          </div>
        </div>

        <fieldset className="sched">
          <legend>Schedule</legend>
          <div className="field two">
            <div>
              <label>Recurs</label>
              <select value={draft.freq} onChange={(e) => patch({ freq: e.target.value as MeetingDraft["freq"] })}>
                <option value="weekly">Weekly (pick weekdays)</option>
                <option value="monthly">Monthly (nth weekday)</option>
                <option value="sprint">Sprint-relative (nth weekday of sprint)</option>
                <option value="sprint-week">Sprint week (weekday of Nth week)</option>
                <option value="tbd">TBD / unscheduled</option>
              </select>
            </div>
            <div>
              <label>Timezone</label>
              <select value={draft.tz} onChange={(e) => patch({ tz: e.target.value })}>
                {TZ_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Time</label>
            <div className="times">
              <TimePicker
                value={draft.startTime}
                onChange={(v) => patch({ startTime: v })}
                placeholder="Start time"
              />
              <span className="times-dash">–</span>
              <TimePicker
                value={draft.endTime}
                onChange={(v) => patch({ endTime: v })}
                placeholder="End time"
              />
            </div>
          </div>

          {draft.freq === "weekly" && (
            <>
              <div className="field">
                <label>Weekdays</label>
                <div className="daypicker">
                  {WEEK_ORDER.map((wd) => (
                    <button key={wd} type="button" className={draft.byday.includes(wd) ? "day on" : "day"} onClick={() => toggleDay(wd)}>
                      {WEEK_LABEL[wd]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field two">
                <div>
                  <label>Frequency</label>
                  <select value={draft.interval} onChange={(e) => patch({ interval: Number(e.target.value) as 1 | 2 })}>
                    <option value={1}>Every week</option>
                    <option value={2}>Every other week</option>
                  </select>
                </div>
                {draft.interval === 2 && (
                  <div>
                    <label>Anchor date <span className="opt">(a known occurrence)</span></label>
                    <input type="date" value={draft.anchor} onChange={(e) => patch({ anchor: e.target.value })} />
                  </div>
                )}
              </div>
            </>
          )}

          {(draft.freq === "monthly" || draft.freq === "sprint" || draft.freq === "sprint-week") && (
            <div className="field two">
              <div>
                <label>Weekday</label>
                <select value={draft.byday[0] ?? "MO"} onChange={(e) => patch({ byday: [e.target.value as Weekday] })}>
                  {WEEK_ORDER.map((wd) => <option key={wd} value={wd}>{WEEK_LABEL[wd]}</option>)}
                </select>
              </div>
              {draft.freq === "monthly" && (
                <div>
                  <label>Which</label>
                  <select value={draft.setpos} onChange={(e) => patch({ setpos: e.target.value })}>
                    <option value="1">1st</option>
                    <option value="2">2nd</option>
                    <option value="3">3rd</option>
                    <option value="4">4th</option>
                    <option value="-1">Last</option>
                  </select>
                </div>
              )}
              {draft.freq === "sprint" && (
                <div>
                  <label>Occurrence(s) in sprint</label>
                  <input value={draft.setpos} onChange={(e) => patch({ setpos: e.target.value })} placeholder='e.g. "1", "-1" (last), "2,3"' />
                </div>
              )}
              {draft.freq === "sprint-week" && (
                <div>
                  <label>Sprint week #</label>
                  <input type="number" min={1} max={4} value={draft.week} onChange={(e) => patch({ week: Number(e.target.value) })} />
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label>Schedule text <span className="opt">(shown as-is; auto-filled if blank)</span></label>
            <input value={draft.scheduleText} onChange={(e) => patch({ scheduleText: e.target.value })} placeholder="e.g. Thursdays, 9:30-10AM" />
          </div>
        </fieldset>

        <fieldset className="sched">
          <legend>How to join</legend>
          <div className="field two">
            <div>
              <label>Method</label>
              <select value={draft.joinMethod} onChange={(e) => patch({ joinMethod: e.target.value as JoinMethod })}>
                {JOIN_ORDER.map((j) => <option key={j} value={j}>{JOIN_LABEL[j]}</option>)}
              </select>
            </div>
            <div>
              <label>Link <span className="opt">(optional)</span></label>
              <input value={draft.joinUrl} onChange={(e) => patch({ joinUrl: e.target.value })} placeholder="https://meet.google.com/…" />
            </div>
          </div>
          <div className="field">
            <label>Join note <span className="opt">(optional)</span></label>
            <input value={draft.joinNote} onChange={(e) => patch({ joinNote: e.target.value })} placeholder="e.g. In person in 3098" />
          </div>
        </fieldset>

        <div className="field">
          <label>Notes <span className="opt">(optional)</span></label>
          <textarea value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} rows={2} placeholder="Anything else" />
        </div>

        <label className="jsonlabel">File preview — <code>{filename}</code></label>
        <pre className="urlbox">{json}</pre>

        <div className="foot">
          <button className="btn" onClick={() => navigator.clipboard?.writeText(json)}>Copy JSON</button>
          <button className="btn" disabled={!valid} onClick={onPreview} title={draftToMeeting(draft).name}>👁 Preview on calendar</button>
          <button className="btn primary" disabled={!valid} onClick={handleStage}>
            ➕ Add to changes
          </button>
        </div>
      </div>
    </div>
  );
}
