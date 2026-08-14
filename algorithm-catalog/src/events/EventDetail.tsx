// One activation, in full. The honest part is the coverage line and the greyed-out external
// layers: a real activation pulls in far more than this catalog can produce (OPERA, AVIRIS, GPM,
// commercial optical…), and pretending otherwise would send a responder looking for a button that
// does not exist. So every layer the event needed is listed — the ones we can run are clickable
// and jump to the Algorithms tab; the rest are shown, greyed, and inert.

import type { Algorithm, Hazard } from "../types";
import {
  algorithmById,
  formatRange,
  productById,
  productKey,
  type CatalogEvent,
} from "../data";
import { hazardColor, hazardIcon, hazardLabel, modality as modalityStyle } from "../colors";
import { navigate } from "../tabs";

interface Props {
  event: CatalogEvent;
  algorithms: Algorithm[];
  hazards: Hazard[];
  onClose: () => void;
}

export default function EventDetail({ event: ev, algorithms, hazards, onClose }: Props) {
  const resolved = ev.layers.map((l) => ({
    layer: l,
    algorithm: algorithmById(algorithms, l.algorithm),
    product: productById(algorithms, l.algorithm, l.product),
  }));
  const available = resolved.filter((r) => r.algorithm && r.product);
  const total = ev.layers.length + ev.externalLayers.length;

  function jump(algorithmId: string) {
    navigate({ tab: "algorithms", algorithm: algorithmId, event: ev.id });
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal panel wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{ev.name}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="detail-badges">
          <span className={`src-badge ${ev.source}`}>{ev.source}</span>
          <code className="stac">{ev.stacName}</code>
          <span className="vendor-badge">{formatRange(ev.start, ev.end)}</span>
        </div>

        <div className="ecard-hazards">
          {ev.hazards.map((h) => (
            <span key={h} className="hchip" style={{ background: hazardColor(h, hazards) }}>
              <span aria-hidden>{hazardIcon(h, hazards)}</span> {hazardLabel(h, hazards)}
            </span>
          ))}
        </div>

        <dl className="detail-grid">
          <dt>Locations</dt>
          <dd>{ev.locations.join(" · ") || <span className="opt">none recorded</span>}</dd>
          {ev.bbox && (
            <>
              <dt>Bounding box</dt>
              <dd>
                <code>{ev.bbox}</code>
              </dd>
            </>
          )}
        </dl>

        <p className="coverage">
          <b>
            {available.length} of {total} layers
          </b>{" "}
          available in this catalog.
          {ev.externalLayers.length > 0 && (
            <>
              {" "}
              The remaining {total - available.length} came from products this app does not
              catalog — they are listed below, greyed out, so the gap is visible rather than
              implied.
            </>
          )}
        </p>

        <h3 className="detail-h">
          In this catalog <span className="count">({available.length})</span>
        </h3>
        <div className="lchips">
          {resolved.map(({ layer, algorithm, product }) => {
            const key = productKey(layer.algorithm, layer.product);
            if (!algorithm || !product) {
              return (
                <span
                  key={key}
                  className="lchip ext"
                  title="This layer names an algorithm or product that is not in the catalog"
                >
                  {layer.algorithm} · {layer.product}
                </span>
              );
            }
            const m = modalityStyle(algorithm.modality);
            return (
              <button
                key={key}
                className="lchip"
                style={{ borderColor: m.color, color: m.ink, background: m.tint }}
                onClick={() => jump(algorithm.id)}
                title={`Show ${algorithm.title} in the Algorithms tab`}
              >
                <span aria-hidden>{m.icon}</span> {algorithm.title} · {product.label}{" "}
                <span aria-hidden>→</span>
              </button>
            );
          })}
          {resolved.length === 0 && <span className="opt">No catalog layers recorded.</span>}
        </div>

        {ev.externalLayers.length > 0 && (
          <>
            <h3 className="detail-h">
              Not in this catalog <span className="count">({ev.externalLayers.length})</span>
            </h3>
            <div className="lchips">
              {ev.externalLayers.map((l) => (
                <span key={l} className="lchip ext" title="No algorithm in this catalog produces this layer">
                  {l}
                </span>
              ))}
            </div>
          </>
        )}

        {ev.submissions.length > 0 && (
          <>
            <h3 className="detail-h">
              Submissions <span className="count">({ev.submissions.length})</span>
            </h3>
            <ul className="sub-list">
              {ev.submissions.map((s) => (
                <li key={`${s.id}-${s.ts}`} className="sub-row">
                  <div className="sub-head">
                    <b>{s.requester || "anonymous"}</b>
                    <span className="opt">{s.ts.slice(0, 10)}</span>
                    <span className="count">
                      {s.layers.length} product{s.layers.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {s.notes && <p className="sub-notes">{s.notes}</p>}
                </li>
              ))}
            </ul>
            <p className="hint">
              Submissions are requests, not results. Nothing runs until the pull request that
              carries them is reviewed and merged.
            </p>
          </>
        )}

        <div className="foot">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {available.length > 0 && (
            <button className="btn primary" onClick={() => jump(available[0].algorithm!.id)}>
              Open in Algorithms ↗
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
