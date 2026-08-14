import type { Algorithm, Hazard } from "../types";
import { hazardColor, hazardIcon, hazardLabel, modality as modalityStyle } from "../colors";

interface Props {
  algorithm: Algorithm;
  hazards: Hazard[];
  /** Product ids currently satisfying the filters — highlighted so the match stays visible here. */
  matchedIds: Set<string>;
  onClose: () => void;
}

/** How the algorithm is pointed at a place. Mutually incompatible across algorithms, by design. */
const SELECTOR_LABEL: Record<string, string> = {
  bbox: "WGS84 bounding box — min_lon,min_lat,max_lon,max_lat",
  "mgrs-tile": "Sentinel-2 MGRS tile ID",
  "wrs2-pathrow": "Landsat WRS-2 path/row (NNNNNN)",
  "vendor-scene": "Vendor scene — the AOI is whatever the scene covers; select by date",
  "granule-file": "Operator-supplied granule (.tar / .zip)",
  none: "No spatial input",
};

export default function AlgorithmDetail({ algorithm: a, hazards, matchedIds, onClose }: Props) {
  const m = modalityStyle(a.modality);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal panel wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            <span aria-hidden>{m.icon}</span> {a.title}
          </h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="detail-badges">
          <span className="mbadge" style={{ background: m.tint, color: m.ink }}>
            {m.label}
          </span>
          {a.status === "prototype" ? (
            <span className="proto-badge">prototype — no DPS algorithm registered</span>
          ) : (
            <span className="prod-badge">production</span>
          )}
          <span className="vendor-badge">{a.vendor}</span>
        </div>

        <p className="detail-desc">{a.description}</p>

        <dl className="detail-grid">
          <dt>DPS algorithm</dt>
          <dd>
            <code>{a.algorithmName}</code> @ <code>{a.version}</code>
          </dd>
          <dt>Resolution</dt>
          <dd>{a.resolution}</dd>
          <dt>Data from</dt>
          <dd>
            {a.temporalStartApprox ? "~" : ""}
            {a.temporalStart}
            {a.temporalStartApprox && (
              <span className="opt"> (mission launch — approximate record start)</span>
            )}
          </dd>
          <dt>Spatial input</dt>
          <dd>{SELECTOR_LABEL[a.spatialSelector] ?? a.spatialSelector}</dd>
          <dt>Resources</dt>
          <dd>
            {a.resources.ramMin} GB RAM · {a.resources.coresMin} cores · {a.resources.outdirMax} GB
            output
          </dd>
          {a.keywords.length > 0 && (
            <>
              <dt>Keywords</dt>
              <dd>{a.keywords.join(", ")}</dd>
            </>
          )}
        </dl>

        <h3 className="detail-h">
          Products <span className="count">({a.products.length})</span>
        </h3>
        <ul className="prod-list">
          {a.products.map((p) => (
            <li key={p.id} className={matchedIds.has(p.id) ? "prod matched" : "prod"}>
              <div className="prod-head">
                <b>{p.label}</b>
                <code>{p.id}</code>
                <span className="opt">→ {p.folder}/</span>
                {matchedIds.has(p.id) && <span className="match-flag">matches filters</span>}
              </div>
              {p.note && <p className="prod-note">{p.note}</p>}
              <div className="prod-hazards">
                {p.hazards.map((h) => (
                  <span key={h} className="hchip sm" style={{ background: hazardColor(h, hazards) }}>
                    <span aria-hidden>{hazardIcon(h, hazards)}</span> {hazardLabel(h, hazards)}
                  </span>
                ))}
                {p.hazards.length === 0 && <span className="opt">no hazard mapping</span>}
              </div>
            </li>
          ))}
        </ul>

        <h3 className="detail-h">
          Job inputs <span className="count">({a.inputs.length})</span>
        </h3>
        <div className="inputs-wrap">
          <table className="inputs">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Required</th>
                <th>Default</th>
              </tr>
            </thead>
            <tbody>
              {a.inputs.map((i) => (
                <tr key={i.name}>
                  <td>
                    <code>{i.name}</code>
                    <div className="in-label">{i.label}</div>
                    {i.doc && <div className="in-doc">{i.doc}</div>}
                  </td>
                  <td>{i.type}</td>
                  <td>{i.required ? <b className="req">yes</b> : "no"}</td>
                  <td>{i.default ? <code>{i.default}</code> : <span className="opt">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="detail-h">Resources</h3>
        <p className="hint">
          Thumbnail: {a.thumbCredit}. Every figure above mirrors the algorithm's upstream
          <code> algorithm_config.yaml</code> — it is what DPS will actually enforce at run time.
        </p>

        <div className="foot">
          <a className="btn primary" href={a.configUrl} target="_blank" rel="noreferrer">
            algorithm_config.yaml ↗
          </a>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
