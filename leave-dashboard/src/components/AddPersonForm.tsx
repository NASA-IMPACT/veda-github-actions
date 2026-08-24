import { useMemo } from "react";
import type { Person, Status } from "../types";
import { STATUS_LABEL, STATUS_ORDER } from "../colors";
import { buildOverrideFile, Draft, draftValid, newDraft } from "../drafts";

// GitHub's `new/<branch>?filename=&value=` route creates ONE new file on a fresh branch and
// offers a PR — no backend/OAuth. All the people added here go into that one file = one PR.
const REPO = "NASA-IMPACT/veda-github-actions";
const BASE_BRANCH = "main";

interface Props {
  teams: string[];
  people: Person[];
  pi: string;
  drafts: Draft[];
  setDrafts: (updater: Draft[] | ((ds: Draft[]) => Draft[])) => void;
  onClose: () => void;
  onPreview: (drafts: Draft[]) => void;
}

export default function AddPersonForm({ teams, people, pi, drafts, setDrafts, onClose, onPreview }: Props) {
  const byName = useMemo(() => {
    const m = new Map<string, Person>();
    people.forEach((p) => m.set(p.name.trim().toLowerCase(), p));
    return m;
  }, [people]);

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
  // Existing-person mode: typing/selecting a known name locks their slug/team/role so the
  // override merges onto that person (you're adding new leave dates, not a duplicate).
  function pickExisting(i: number, value: string) {
    const p = byName.get(value.trim().toLowerCase());
    if (p) patch(i, { name: p.name, team: p.team, role: p.role, slug: p.slug });
    else patch(i, { name: value, slug: undefined, team: "", role: "" });
  }

  const { filename, json } = useMemo(() => buildOverrideFile(drafts, pi), [drafts, pi]);
  const validCount = drafts.filter(draftValid).length;
  const prUrl = `https://github.com/${REPO}/new/${BASE_BRANCH}?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(json)}`;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Add leave</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close" title="Close (your entries are kept)">×</button>
        </div>
        <p className="hint">
          Everyone below goes into <b>one</b> pull request (<code>{filename.replace("leave/overrides/", "")}</code>).
          Add dates to an <b>existing person</b>, or create a <b>new</b> one (and a new team if needed).
          Use <b>Preview</b> to see them on the calendar first. <b>Closing keeps your entries</b> — reopen “Add leave” to continue.
        </p>
        <p className="hint">
          On GitHub, click <b>Commit changes</b> → <b>Propose changes</b> → <b>Create pull request</b>.
          The PR then <b>merges itself</b> and your dates appear here within about two minutes — nobody
          has to approve it. If something in an entry is wrong, a comment on the PR says what to fix.
        </p>

        {drafts.map((d, i) => {
          const known = d.mode === "existing" ? byName.get(d.name.trim().toLowerCase()) : undefined;
          const isNewTeam = d.mode === "new" && d.team.trim().length > 0 && !teams.includes(d.team.trim());
          return (
            <div key={i} className="panel" style={{ padding: "0.7rem 0.8rem", marginBottom: "0.7rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}>
                <div className="seg">
                  <button className={d.mode === "existing" ? "active" : ""}
                    onClick={() => patch(i, { mode: "existing", slug: undefined, name: "", team: "", role: "" })}>
                    Existing person
                  </button>
                  <button className={d.mode === "new" ? "active" : ""}
                    onClick={() => patch(i, { mode: "new", slug: undefined, name: "", team: "", role: "" })}>
                    New person
                  </button>
                </div>
                {drafts.length > 1 && (
                  <button className="rm" title="Remove" style={{ marginLeft: "auto" }}
                    onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}>×</button>
                )}
              </div>

              {d.mode === "existing" ? (
                <div className="field">
                  <label>Person</label>
                  <input list={`people-${i}`} value={d.name}
                    onChange={(e) => pickExisting(i, e.target.value)}
                    placeholder="Start typing a name…" />
                  <datalist id={`people-${i}`}>
                    {people.map((p) => <option key={p.slug} value={p.name}>{p.team}</option>)}
                  </datalist>
                  {known
                    ? <div className="newteam" style={{ color: "var(--blue-ink)" }}>↳ {known.team}{known.role ? ` · ${known.role}` : ""} — adding new leave dates</div>
                    : d.name.trim() && <div className="newteam" style={{ color: "var(--red)" }}>Not on the sheet — switch to “New person”, or pick a match.</div>}
                </div>
              ) : (
                <>
                  <div className="field two" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
                    <div>
                      <label>Name</label>
                      <input value={d.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Jane Doe" />
                    </div>
                    <div>
                      <label>Role (optional)</label>
                      <input value={d.role} onChange={(e) => patch(i, { role: e.target.value })} placeholder="Engineer" />
                    </div>
                  </div>
                  <div className="field">
                    <label>Team</label>
                    <input list="teamlist" value={d.team} onChange={(e) => patch(i, { team: e.target.value })}
                      placeholder="DevSeed — or a new team name" />
                    {isNewTeam && <div className="newteam">＋ New team “{d.team.trim()}” will be created</div>}
                  </div>
                </>
              )}

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

        <button className="btn blue" onClick={() => setDrafts((ds) => [...ds, newDraft("existing")])}>＋ Add another person</button>

        <div className="urlbox">{json}</div>

        <div className="foot">
          <button className="btn" onClick={() => setDrafts([newDraft("existing")])}>Reset</button>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(json)}>Copy JSON</button>
          <button className="btn" onClick={onClose}>Close</button>
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
