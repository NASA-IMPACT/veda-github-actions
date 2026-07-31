import { useMemo, useState } from "react";
import type { Meeting, Pi } from "../types";
import { toISO } from "../calendar";
import { sprintAccent } from "../colors";
import { loadMeetings, piCalendar } from "../meetings/data";
import { occurrencesInRange } from "../meetings/recurrence";
import { pis } from "./data";
import { piDateRange, piStatus, sprintLabel } from "./pi";
import { draftToPi, newPiDraft, PiDraft, piToDraft } from "./drafts";
import AddPiForm from "./AddPiForm";
import { useChanges } from "../ChangesContext";

function fmtRange(start: string, end: string): string {
  if (!start || !end) return "—";
  const s = new Date(start + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const e = new Date(end + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${s} – ${e}`;
}

export default function PiRoadmap() {
  const meetings = useMemo(() => loadMeetings(), []);
  const today = useMemo(() => toISO(new Date()), []);
  const { stage } = useChanges();
  const [expandedId, setExpandedId] = useState<string | null>(() => {
    // Open the current PI by default.
    const cur = pis.find((p) => piStatus(p, toISO(new Date())) === "current");
    return cur?.id ?? pis[0]?.id ?? null;
  });
  const [form, setForm] = useState<{ mode: "add" | "edit"; editId?: string } | null>(null);
  const [draft, setDraft] = useState<PiDraft>(newPiDraft);

  function openAdd() {
    setDraft(newPiDraft());
    setForm({ mode: "add" });
  }
  function openEdit(pi: Pi) {
    setDraft(piToDraft(pi));
    setForm({ mode: "edit", editId: pi.id });
  }

  return (
    <div className="pi-roadmap">
      <div className="pi-toolbar">
        <h2 className="section-title">PI Roadmap</h2>
        <button className="btn primary" onClick={openAdd}>{"＋"} Add PI</button>
      </div>

      <div className="pi-grid">
        {pis.map((p) => (
          <PiCard
            key={p.id}
            pi={p}
            today={today}
            meetings={meetings}
            expanded={expandedId === p.id}
            onToggle={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
            onEdit={() => openEdit(p)}
          />
        ))}
        {pis.length === 0 && <p className="empty">No PIs yet &mdash; use &ldquo;Add PI&rdquo;.</p>}
      </div>

      {form && (
        <AddPiForm
          mode={form.mode}
          editId={form.editId}
          draft={draft}
          setDraft={setDraft}
          onClose={() => setForm(null)}
          onStage={(pi) => {
            const label = `${form.mode === "edit" ? "Edit" : "Add"} PI: ${draftToPi(draft).name}`;
            stage({
              kind: "pi",
              op: "upsert",
              ts: new Date().toISOString(),
              data: pi,
              label,
            });
            setForm(null);
          }}
        />
      )}
    </div>
  );
}

function PiCard({
  pi, today, meetings, expanded, onToggle, onEdit,
}: {
  pi: Pi;
  today: string;
  meetings: Meeting[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const { start, end } = piDateRange(pi);
  const status = piStatus(pi, today);

  const [openSprints, setOpenSprints] = useState<Set<number>>(() => new Set());
  function toggleSprint(i: number) {
    setOpenSprints((prev) => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }

  // Meetings with >=1 occurrence inside each sprint's window.
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of pi.sprints) {
      let c = 0;
      for (const mt of meetings) if (occurrencesInRange(mt, s.start, s.end, piCalendar).length > 0) c++;
      m.set(s.index, c);
    }
    return m;
  }, [pi, meetings]);

  return (
    <div className={`pi-card ${status} ${expanded ? "expanded" : ""}`}>
      <button className="pi-card-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="pi-card-name">{pi.name}</span>
        <span className={`pi-status ${status}`}>{status}</span>
        <span className="pi-card-range">{fmtRange(start, end)}</span>
        <span className="pi-card-meta">{pi.sprints.length} sprint{pi.sprints.length === 1 ? "" : "s"}</span>
        <span className="pi-card-chevron">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="pi-card-body">
          {pi.goal && <p className="pi-goal">{pi.goal}</p>}
          <div className="sprint-drops">
            {pi.sprints.map((s) => {
              const open = openSprints.has(s.index);
              const current = s.start <= today && today <= s.end;
              const count = counts.get(s.index) ?? 0;
              return (
                <div key={s.index} className={`sprint-drop ${current ? "current" : ""}`}>
                  <button
                    className="sprint-drop-head"
                    onClick={() => toggleSprint(s.index)}
                    aria-expanded={open}
                    style={{ borderLeftColor: sprintAccent(pi.id, s.index) }}
                  >
                    <span className="sprint-drop-name">{sprintLabel(s)}</span>
                    {current && <span className="sprint-now">current</span>}
                    <span className="sprint-drop-count">{count} mtg{count === 1 ? "" : "s"}</span>
                    <span className="sprint-drop-chevron">{open ? "▲" : "▼"}</span>
                  </button>
                  {open && (
                    <dl className="sprint-drop-body mdetail">
                      <div className="mrow"><dt>Dates</dt><dd>{fmtRange(s.start, s.end)}</dd></div>
                      <div className="mrow"><dt>Meetings</dt><dd>{count} in this sprint</dd></div>
                      {s.goal && <div className="mrow"><dt>Goal</dt><dd>{s.goal}</dd></div>}
                    </dl>
                  )}
                </div>
              );
            })}
          </div>
          <div className="pi-card-actions">
            <button className="btn" onClick={onEdit}>{"✎"} Edit / add sprints</button>
            {pi.boardUrl && <a className="btn" href={pi.boardUrl} target="_blank" rel="noreferrer">Board {"↗"}</a>}
          </div>
        </div>
      )}
    </div>
  );
}
