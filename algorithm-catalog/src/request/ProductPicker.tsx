// "Add products" — the escape hatch from hazard auto-selection.
//
// The hazard -> product mapping in data/algorithms.json is hand-built and will never be complete:
// a responder who knows they want VIIRS night lights on a landslide must be able to say so. This
// picker lists EVERY algorithm × product in the catalog, grouped and searchable, and anything
// added here is tagged via:"manual" so the request stays traceable.

import { useMemo, useState } from "react";
import type { Algorithm } from "../types";
import { productKey } from "./drafts";

interface Props {
  algorithms: Algorithm[];
  /** productKey()s already on the request — shown as "added" and not clickable. */
  selected: Set<string>;
  onAdd: (algorithm: string, product: string) => void;
  onClose: () => void;
}

const MODALITY_ICON: Record<string, string> = {
  optical: "🛰️",
  sar: "📡",
  nightlights: "🌃",
  utility: "🧰",
};

export default function ProductPicker({ algorithms, selected, onAdd, onClose }: Props) {
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return algorithms
      .map((a) => {
        const algMatches =
          !needle ||
          a.title.toLowerCase().includes(needle) ||
          a.id.toLowerCase().includes(needle) ||
          a.vendor.toLowerCase().includes(needle) ||
          a.modality.toLowerCase().includes(needle) ||
          a.keywords.some((k) => k.toLowerCase().includes(needle));
        const products = a.products.filter(
          (p) =>
            algMatches ||
            p.label.toLowerCase().includes(needle) ||
            p.id.toLowerCase().includes(needle) ||
            p.hazards.some((h) => h.toLowerCase().includes(needle)),
        );
        return { alg: a, products };
      })
      .filter((g) => g.products.length > 0);
  }, [algorithms, q]);

  const total = groups.reduce((n, g) => n + g.products.length, 0);

  return (
    <div className="popover req-picker" onClick={(e) => e.stopPropagation()}>
      <div className="req-picker-head">
        <input
          className="req-picker-search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search sensors, products, hazards…"
          aria-label="Search products"
        />
        <button className="req-modal-x" onClick={onClose} aria-label="Close picker">
          ×
        </button>
      </div>

      <div className="req-picker-body">
        {total === 0 && <p className="req-picker-empty">No products match “{q}”.</p>}
        {groups.map((g) => (
          <div key={g.alg.id} className="req-picker-group">
            <div className="req-picker-group-head">
              <span>{MODALITY_ICON[g.alg.modality] ?? "🛰️"}</span>
              <b>{g.alg.title}</b>
              <span className="req-picker-meta">
                {g.alg.modality}
                {g.alg.status === "prototype" ? " · prototype" : ""}
              </span>
            </div>
            {g.products.map((p) => {
              const key = productKey({ algorithm: g.alg.id, product: p.id });
              const already = selected.has(key);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={already ? "req-picker-row is-added" : "req-picker-row"}
                  disabled={already}
                  onClick={() => onAdd(g.alg.id, p.id)}
                  title={p.note ?? p.label}
                >
                  <span className="req-picker-plus">{already ? "✓" : "＋"}</span>
                  <span className="req-picker-name">{p.label}</span>
                  <code className="req-picker-token">{p.id}</code>
                  {p.hazards.length > 0 && (
                    <span className="req-picker-haz">{p.hazards.join(" · ")}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p className="req-picker-foot">
        Added here counts as <b>manual</b> — it stays on the request even if you change hazards.
      </p>
    </div>
  );
}
