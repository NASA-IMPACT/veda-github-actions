// The staged-requests cart: review everything you've queued, then open ONE prefilled PR.
// Same shape as dse-hub/src/ChangesCart.tsx, with a bigger URL budget (see requests.ts URL_LIMIT).

import "./request.css";
import { useRequests } from "./RequestsContext";
import { buildRequestFile, ghNewFileUrl, REQUEST_DIR, URL_LIMIT } from "./requests";

interface Props {
  onClose: () => void;
}

export default function RequestsCart({ onClose }: Props) {
  const { items, remove, clear } = useRequests();

  const { filename, json } =
    items.length > 0 ? buildRequestFile(items) : { filename: "", json: "" };

  const prUrl = items.length > 0 ? ghNewFileUrl(filename, json) : "";
  const urlTooLong = prUrl.length > URL_LIMIT;

  function submitPr() {
    if (!prUrl || urlTooLong) return;
    window.open(prUrl, "_blank", "noreferrer");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="req-modal-head">
          <h2>🧺 Staged requests</h2>
          <button className="req-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {items.length === 0 ? (
          <p className="hint" style={{ marginTop: "0.5rem" }}>
            No staged requests yet. Fill in the request form and click <b>➕ Add to requests</b>.
          </p>
        ) : (
          <>
            <ul className="req-cart-list">
              {items.map((item, i) => (
                <li key={item.id} className="req-cart-row">
                  <span className="req-cart-label">
                    <b>{item.event.name || item.id}</b>
                    <span className="req-cart-sub">
                      {item.event.stacName} · {item.event.hazards.join(", ") || "no hazards"} ·{" "}
                      {item.products.length} product{item.products.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <button
                    className="req-cart-remove"
                    onClick={() => remove(i)}
                    aria-label={`Remove ${item.event.name || item.id}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            <div className="req-cart-actions">
              <button className="req-linkbtn" onClick={clear}>
                Clear all
              </button>
            </div>

            {urlTooLong && (
              <p className="hint req-error" style={{ marginBottom: "0.5rem" }}>
                ⚠ Too many requests to fit in the GitHub URL ({prUrl.length.toLocaleString()} chars,
                limit {URL_LIMIT.toLocaleString()}). Use <b>Copy JSON</b> and paste it into a new
                file under <code>{REQUEST_DIR}/</code> instead.
              </p>
            )}

            <label className="jsonlabel">
              Bundle preview — <code>{filename}</code>
            </label>
            <pre className="urlbox">{json}</pre>

            <p className="hint" style={{ marginBottom: "0.5rem" }}>
              Opens one pull request containing every staged request. Nothing runs until the PR is
              reviewed and merged — merging is what puts the event in the catalog.
            </p>
          </>
        )}

        <div className="foot">
          {items.length > 0 && (
            <button className="btn" onClick={() => navigator.clipboard?.writeText(json)}>
              📋 Copy JSON
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
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
