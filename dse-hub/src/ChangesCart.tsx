import { useChanges } from "./ChangesContext";
import { buildChangesFile } from "./changes";

const REPO = "NASA-IMPACT/veda-github-actions";
const BASE_BRANCH = "main";
const URL_LIMIT = 7500;

interface Props {
  onClose: () => void;
}

export default function ChangesCart({ onClose }: Props) {
  const { items, remove, clear } = useChanges();

  const { filename, json } = items.length > 0
    ? buildChangesFile(items)
    : { filename: "", json: "" };

  const prUrl = items.length > 0
    ? `https://github.com/${REPO}/new/${BASE_BRANCH}?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(json)}`
    : "";

  const urlTooLong = prUrl.length > URL_LIMIT;

  function submitPr() {
    if (!prUrl || urlTooLong) return;
    window.open(prUrl, "_blank", "noreferrer");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <h2>Staged changes</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {items.length === 0 ? (
          <p className="hint" style={{ marginTop: "0.5rem" }}>No staged changes yet. Edit or add meetings / PIs and click "Add to changes".</p>
        ) : (
          <>
            <ul className="cart-list">
              {items.map((item, i) => (
                <li key={i} className="cart-row">
                  <span className="cart-label">{item.label}</span>
                  <button
                    className="cart-remove"
                    onClick={() => remove(i)}
                    aria-label={`Remove ${item.label}`}
                  >×</button>
                </li>
              ))}
            </ul>

            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.6rem" }}>
              <button className="linkbtn" onClick={clear}>Clear all</button>
            </div>

            {urlTooLong && (
              <p className="hint" style={{ color: "var(--error)", marginBottom: "0.5rem" }}>
                Too many changes to fit in the GitHub URL ({prUrl.length} chars). Use "Copy JSON" and
                paste into a new file at <code>dse-hub/data/changes/</code> instead.
              </p>
            )}

            <label className="jsonlabel">Bundle preview — <code>{filename}</code></label>
            <pre className="urlbox">{json}</pre>

            <p className="hint" style={{ marginBottom: "0.5rem" }}>
              Opens one PR with all staged changes; changes go live after the PR is merged and Netlify rebuilds.
            </p>
          </>
        )}

        <div className="foot">
          {items.length > 0 && (
            <button className="btn" onClick={() => navigator.clipboard?.writeText(json)}>Copy JSON</button>
          )}
          <button
            className="btn primary"
            disabled={items.length === 0 || urlTooLong}
            onClick={submitPr}
          >
            Submit PR ↗
          </button>
        </div>
      </div>
    </div>
  );
}
