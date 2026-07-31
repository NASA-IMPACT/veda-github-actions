import { useMemo } from "react";
import type { Pi } from "../types";
import { buildPiFile, draftToPi, newSprintDraft, PiDraft, piDraftValid } from "./drafts";

interface Props {
  mode: "add" | "edit";
  editId?: string;
  draft: PiDraft;
  setDraft: (u: PiDraft | ((d: PiDraft) => PiDraft)) => void;
  onClose: () => void;
  onStage: (pi: Pi) => void;
}

export default function AddPiForm({ mode, editId, draft, setDraft, onClose, onStage }: Props) {
  const isEdit = mode === "edit";
  const patch = (p: Partial<PiDraft>) => setDraft((d) => ({ ...d, ...p }));
  function patchSprint(i: number, p: Partial<PiDraft["sprints"][number]>) {
    setDraft((d) => ({ ...d, sprints: d.sprints.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  }
  function addSprint() {
    setDraft((d) => ({ ...d, sprints: [...d.sprints, newSprintDraft(d.sprints.length + 1)] }));
  }
  function removeSprint(i: number) {
    setDraft((d) => ({ ...d, sprints: d.sprints.length > 1 ? d.sprints.filter((_, j) => j !== i) : d.sprints }));
  }

  const { filename, json } = useMemo(
    () => buildPiFile(draft, isEdit ? editId : undefined),
    [draft, isEdit, editId],
  );
  const shortName = filename.replace("dse-hub/data/pis/", "");
  const valid = piDraftValid(draft);

  function handleStage() {
    const pi = draftToPi(draft);
    if (isEdit && editId) pi.id = editId;
    onStage(pi);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isEdit ? "Edit PI" : "Add PI"}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="hint">
          {isEdit ? (
            <>
              Add / edit / remove sprints below. Click <b>Add to changes</b> to stage this edit
              into the Changes cart, then submit all staged changes as one pull request from the
              cart (🧺 in the header).
            </>
          ) : (
            <>
              A PI needs at least one sprint — add them below. Click <b>Add to changes</b> to
              stage <code>{shortName}</code> into the Changes cart; it goes live once the PR is
              approved &amp; merged.
            </>
          )}
        </p>

        <div className="field two">
          <div>
            <label>PI name</label>
            <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="PI 26.5" />
          </div>
          <div>
            <label>Board link <span className="opt">(optional)</span></label>
            <input value={draft.boardUrl} onChange={(e) => patch({ boardUrl: e.target.value })} placeholder="https://github.com/orgs/…/projects/…" />
          </div>
        </div>
        <div className="field">
          <label>PI goal <span className="opt">(optional)</span></label>
          <input value={draft.goal} onChange={(e) => patch({ goal: e.target.value })} placeholder="Theme / objective for the PI" />
        </div>

        <fieldset className="sched">
          <legend>Sprints {!valid && <span className="opt">— add at least one with dates</span>}</legend>
          {draft.sprints.map((s, i) => (
            <div key={i} className="sprint-draft-row">
              <div className="field sd-idx">
                <label>#</label>
                <input type="number" min={1} value={s.index} onChange={(e) => patchSprint(i, { index: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label>Name <span className="opt">(opt)</span></label>
                <input value={s.name} onChange={(e) => patchSprint(i, { name: e.target.value })} placeholder={`Sprint ${s.index}`} />
              </div>
              <div className="field">
                <label>Start</label>
                <input type="date" value={s.start} onChange={(e) => patchSprint(i, { start: e.target.value })} />
              </div>
              <div className="field">
                <label>End</label>
                <input type="date" value={s.end} min={s.start || undefined} onChange={(e) => patchSprint(i, { end: e.target.value })} />
              </div>
              <button className="rm" title="Remove sprint" onClick={() => removeSprint(i)}>×</button>
            </div>
          ))}
          <button className="btn" onClick={addSprint}>＋ Add sprint</button>
        </fieldset>

        <label className="jsonlabel">File preview — <code>{filename}</code></label>
        <pre className="urlbox">{json}</pre>

        <div className="foot">
          <button className="btn" onClick={() => navigator.clipboard?.writeText(json)}>Copy JSON</button>
          <button className="btn primary" disabled={!valid} onClick={handleStage}>
            ➕ Add to changes
          </button>
        </div>
      </div>
    </div>
  );
}
