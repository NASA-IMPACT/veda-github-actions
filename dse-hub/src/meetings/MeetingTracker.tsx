import { useMemo, useRef, useState } from "react";
import type { Meeting, Pi } from "../types";
import { toISO } from "../calendar";
import { useClickAway } from "../useClickAway";
import { allTeams, loadMeetings, piCalendar } from "./data";
import { occurrencesInRange } from "./recurrence";
import { pis } from "../pi/data";
import { sprintLabel } from "../pi/pi";
import { draftToMeeting, meetingToDraft, MeetingDraft, newMeetingDraft } from "./drafts";
import MeetingList from "./MeetingList";
import MeetingCalendar from "./MeetingCalendar";
import AddMeetingForm from "./AddMeetingForm";
import MeetingCategories from "./MeetingCategories";
import { useChanges } from "../ChangesContext";

type View = "list" | "calendar" | "categories";

function matches(m: Meeting, q: string): boolean {
  if (!q) return true;
  const hay = [
    m.team, m.name, m.purpose, m.organizer, m.facilitator, m.notes,
    m.schedule.text, m.join?.url, m.join?.note,
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default function MeetingTracker() {
  const meetings = useMemo(() => loadMeetings(), []);
  const teams = useMemo(() => allTeams(meetings), [meetings]);
  const { stage } = useChanges();
  const today = useMemo(() => toISO(new Date()), []);

  const [query, setQuery] = useState("");
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(() => new Set(teams));
  const allSprintKeys = useMemo(() => pis.flatMap((p) => p.sprints.map((s) => `${p.id}#${s.index}`)), []);
  const sprintWindows = useMemo(() => {
    const m = new Map<string, { start: string; end: string }>();
    for (const p of pis) for (const s of p.sprints) m.set(`${p.id}#${s.index}`, { start: s.start, end: s.end });
    return m;
  }, []);
  const [selectedSprints, setSelectedSprints] = useState<Set<string>>(() => new Set(allSprintKeys));
  const [view, setView] = useState<View>("calendar");
  const [mtgForm, setMtgForm] = useState<{ mode: "add" | "edit"; editId?: string } | null>(null);
  const [draft, setDraft] = useState<MeetingDraft>(newMeetingDraft);
  const [preview, setPreview] = useState<Meeting | null>(null);

  // A meeting passes the sprint filter if it has ≥1 occurrence inside any selected sprint's window.
  // "All selected" == no filter (keeps TBD meetings, which have no dates to place in a sprint).
  const sprintFilterActive = selectedSprints.size !== allSprintKeys.length;
  function inSelectedSprint(m: Meeting): boolean {
    if (!sprintFilterActive) return true;
    for (const key of selectedSprints) {
      const w = sprintWindows.get(key);
      if (w && occurrencesInRange(m, w.start, w.end, piCalendar).length > 0) return true;
    }
    return false;
  }

  const filtered = meetings.filter(
    (m) => selectedTeams.has(m.team) && matches(m, query) && inSelectedSprint(m),
  );
  const shown = useMemo(() => {
    const arr = preview ? [...filtered, preview] : filtered;
    return [...arr].sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedTeams, selectedSprints, preview, meetings]);
  const draftIds = preview ? new Set([preview.id]) : new Set<string>();

  function doPreview() {
    setPreview(draftToMeeting(draft));
    setMtgForm(null);
    setView("calendar");
  }

  function openAddMeeting() {
    setDraft(newMeetingDraft());
    setMtgForm({ mode: "add" });
  }
  function openEditMeeting(m: Meeting) {
    setDraft(meetingToDraft(m));
    setMtgForm({ mode: "edit", editId: m.id });
  }

  return (
    <div className="tracker">
      <div className="toolbar">
        <div className="search">
          <span className="search-ico" aria-hidden>🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search meetings, teams, people, notes…"
            aria-label="Search meetings"
          />
          {query && <button className="search-x" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
        </div>

        <TeamFilter teams={teams} selected={selectedTeams} onChange={setSelectedTeams} />

        <SprintFilter pis={pis} selected={selectedSprints} onChange={setSelectedSprints} allKeys={allSprintKeys} />

        <div className="seg" role="tablist" aria-label="View">
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>☰ List</button>
          <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>▦ Calendar</button>
          <button className={view === "categories" ? "active" : ""} onClick={() => setView("categories")}>🗂 Categories</button>
        </div>

        <button className="btn primary add-btn" onClick={openAddMeeting}>＋ Add meeting</button>
      </div>

      <div className="tracker-sub">
        <span className="count">{filtered.length} of {meetings.length} meetings</span>
        {preview && (
          <span className="preview-banner">
            Previewing draft: <b>{preview.name || "(unnamed)"}</b>
            <button className="linkbtn" onClick={() => setMtgForm({ mode: "add" })}>Edit</button>
            <button className="linkbtn" onClick={() => setPreview(null)}>Clear</button>
          </span>
        )}
      </div>

      {view === "list" && (
        <MeetingList meetings={shown} pi={piCalendar} today={today} draftIds={draftIds} onEdit={openEditMeeting} />
      )}
      {view === "calendar" && (
        <MeetingCalendar meetings={shown} pi={piCalendar} today={today} draftIds={draftIds} onEdit={openEditMeeting} />
      )}
      {view === "categories" && (
        <MeetingCategories meetings={shown} onEdit={openEditMeeting} />
      )}

      {mtgForm && (
        <AddMeetingForm
          mode={mtgForm.mode}
          editId={mtgForm.editId}
          draft={draft}
          setDraft={setDraft}
          teams={teams}
          onPreview={doPreview}
          onClose={() => setMtgForm(null)}
          onStage={(m) => {
            stage({
              kind: "meeting",
              op: "upsert",
              ts: new Date().toISOString(),
              data: m,
              label: `${mtgForm.mode === "edit" ? "Edit" : "Add"} meeting: ${m.name}`,
            });
            setMtgForm(null);
          }}
        />
      )}
    </div>
  );
}

function TeamFilter({
  teams, selected, onChange,
}: {
  teams: string[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);

  function toggle(t: string) {
    const next = new Set(selected);
    next.has(t) ? next.delete(t) : next.add(t);
    onChange(next);
  }
  const label = selected.size === teams.length ? "All teams" : `${selected.size} team${selected.size === 1 ? "" : "s"}`;

  return (
    <div className="control" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>🏷️ {label} ▾</button>
      {open && (
        <div className="popover panel">
          <div className="actions">
            <button onClick={() => onChange(new Set(teams))}>All</button>
            <button onClick={() => onChange(new Set())}>Clear</button>
          </div>
          {teams.map((t) => (
            <label key={t} className="row">
              <input type="checkbox" checked={selected.has(t)} onChange={() => toggle(t)} />
              <span>{t}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function SprintFilter({
  pis: allPis, selected, onChange, allKeys,
}: {
  pis: Pi[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  allKeys: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);

  function toggle(key: string) {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange(next);
  }
  function togglePi(p: Pi) {
    const keys = p.sprints.map((s) => `${p.id}#${s.index}`);
    const allOn = keys.every((k) => selected.has(k));
    const next = new Set(selected);
    keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
    onChange(next);
  }

  const label =
    selected.size === allKeys.length ? "All sprints"
      : selected.size === 0 ? "No sprints"
        : `${selected.size} sprint${selected.size === 1 ? "" : "s"}`;

  return (
    <div className="control" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>🗓️ {label} ▾</button>
      {open && (
        <div className="popover panel sprint-pop">
          <div className="actions">
            <button onClick={() => onChange(new Set(allKeys))}>All</button>
            <button onClick={() => onChange(new Set())}>Clear</button>
          </div>
          {allPis.map((p) => (
            <div key={p.id} className="sprint-pop-group">
              <label className="row row-pi">
                <input
                  type="checkbox"
                  checked={p.sprints.every((s) => selected.has(`${p.id}#${s.index}`))}
                  onChange={() => togglePi(p)}
                />
                <span className="row-pi-name">{p.name}</span>
              </label>
              {p.sprints.map((s) => {
                const key = `${p.id}#${s.index}`;
                return (
                  <label key={key} className="row row-sprint">
                    <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
                    <span>{sprintLabel(s)}</span>
                  </label>
                );
              })}
            </div>
          ))}
          {allPis.length === 0 && <p className="tray-empty" style={{ padding: "0.3rem" }}>No PIs defined.</p>}
        </div>
      )}
    </div>
  );
}
