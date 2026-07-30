import { useMemo, useState } from "react";
import type { Status } from "../types";
import { STATUS_LABEL, STATUS_ORDER } from "../colors";
import { buildOverrideFile, Draft, draftValid, newDraft } from "../drafts";

// GitHub's `new/<branch>?filename=&value=` route creates ONE new file on a fresh branch and
// offers a PR — no backend/OAuth. All the people added here go into that one file = one PR.
const REPO = "NASA-IMPACT/veda-github-actions";
const BASE_BRANCH = "main";

interface Props {
  teams: string[];
  pi: string;
  onClose: () => void;
  onPreview: (drafts: Draft[]) => void;
}

export default function AddPersonForm({ teams, pi, onClose, onPreview }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>([newDraft()]);

  function patch(i: number, p: Partial<Draft>) {
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));
  }
  function patchEntry(i: number, k: number, p: Partial<Draft["entries"][number]>) {
    setDrafts((ds) =>
      ds.map((d, j) =>
        j === i ? { ...d, entries: d.entries.map((e, m) => (m === k ? { ...e, ...p } : e)) } : d,
      ),
    );
  }

  const { filename, json } = useMemo(() => buildOverrideFile(drafts, pi), [drafts, pi]);
  const validCount = drafts.filter(draftValid).length;
  const prUrl = `https://github.com/${REPO}/new/${BASE_BRANCH}?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(json)}`;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <h2>Add {drafts.length > 1 ? "people" : "a person"}</h2>
        <p className="hint">
          Everyone below goes into <b>one</b> pull request (<code>{filename.replace("leave/overrides/", "")}</code>).
          Assign an existing team or type a brand-new one. Use <b>Preview</b> to see them on the calendar first.
        </p>

        {drafts.map((d, i) => {
          const isNewTeam = d.team.trim().length > 0 && !teams.includes(d.team.trim());
          return (
            <div key={i} className="panel" style={{ padding: "0.7rem 0.8rem", marginBottom: "0.7rem" }}>
              <div className="field two" style={{ gridTemplateColumns: "1.3fr 1fr auto", alignItems: "end" }}>
                <div>
                  <label>Name</label>
                  <input value={d.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Jane Doe" />
                </div>
                <div>
                  <label>Role (optional)</label>
                  <input value={d.role} onChange={(e) => patch(i, { role: e.target.value })} placeholder="Engineer" />
                </div>
                {drafts.length > 1 && (
                  <button className="rm" title="Remove person"
                    onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}>×</button>
                )}
              </div>
              <div className="field">
                <label>Team</label>
                <input list="teamlist" value={d.team} onChange={(e) => patch(i, { team: e.target.value })}
                  placeholder="DevSeed — or a new team name" />
                {isNewTeam && <div className="newteam">＋ New team “{d.team.trim()}” will be created</div>}
              </div>
              <div className="field">
                <label>Leave</label>
                {d.entries.map((e, k) => (
                  <div className="entryrow" key={k}>
                    <input type="date" value={e.start} onChange={(ev) => patchEntry(i, k, { start: ev.target.value })} />
                    <input type="date" value={e.end} min={e.start || undefined}
                      onChange={(ev) => patchEntry(i, k, { end: ev.target.value })} title="End (optional)" />
                    <select value={e.status} onChange={(ev) => patchEntry(i, k, { status: ev.target.value as Status })}>
                      {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      <option value="available">Available (clear)</option>
                    </select>
                    <button className="rm"
                      onClick={() => patch(i, { entries: d.entries.length > 1 ? d.entries.filter((_, m) => m !== k) : d.entries })}>×</button>
                  </div>
                ))}
                <button className="btn" onClick={() => patch(i, { entries: [...d.entries, { start: "", end: "", status: "planned_time_off", note: "" }] })}>
                  + Add date range
                </button>
              </div>
            </div>
          );
        })}
        <datalist id="teamlist">
          {teams.map((t) => <option key={t} value={t} />)}
        </datalist>

        <button className="btn" onClick={() => setDrafts((ds) => [...ds, newDraft()])}>＋ Add another person</button>

        <div className="urlbox">{json}</div>

        <div className="foot">
          <button className="btn" onClick={() => navigator.clipboard?.writeText(json)}>Copy JSON</button>
          <button className="btn" disabled={!validCount} onClick={() => onPreview(drafts.filter(draftValid))}>
            👁 Preview on calendar
          </button>
          <a className="btn primary" href={validCount ? prUrl : undefined} target="_blank" rel="noreferrer"
            style={validCount ? undefined : { opacity: 0.45, pointerEvents: "none" }}>
            Open PR{validCount > 1 ? ` (${validCount} people)` : ""} ↗
          </a>
        </div>
      </div>
    </div>
  );
}
