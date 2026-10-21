// "Add products" — the escape hatch from hazard auto-selection.
//
// The hazard -> product mapping in data/algorithms.json is hand-built and will never be complete:
// a responder who knows they want VIIRS night lights on a landslide must be able to say so. This
// picker lists EVERY algorithm × product in the catalog, and anything added here is tagged
// via:"manual" so the request stays traceable.
//
// Two columns, because one long list stops being navigable once the catalog grows past a handful
// of sensors: LEFT is every sensor in catalog order (a vertical tablist), RIGHT is the products of
// the one you picked (its tabpanel). Search filters both; while searching, an "All matches" entry
// at the top of the left column lists every hit grouped by sensor.
//
// Keyboard: ↓ from the search box enters the sensor list; ↑/↓/Home/End move through sensors
// (selection follows focus); → or Enter jumps into that sensor's products; ↑/↓ move among
// products; ← goes back to the sensor; Esc closes.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Algorithm, Product } from "../types";
import { modality } from "../colors";
import { productKey } from "./drafts";

interface Props {
  algorithms: Algorithm[];
  /** productKey()s already on the request — shown ✓; clicking one again removes it. */
  selected: Set<string>;
  onAdd: (algorithm: string, product: string) => void;
  onRemove: (algorithm: string, product: string) => void;
  onClose: () => void;
}

/**
 * Badge text for any status other than "production". Keyed by plain string (not the
 * AlgorithmStatus union) so a status added to the data before it reaches this map still renders —
 * as its raw value — instead of failing the typecheck.
 */
const STATUS_LABEL: Record<string, string> = {
  prototype: "prototype",
  external: "no algorithm yet",
};

function statusLabel(status: string): string | null {
  return status === "production" ? null : (STATUS_LABEL[status] ?? status);
}

/** The left-column id of the "All matches" entry — not a valid algorithm id. */
const ALL = "__all__";

interface Group {
  alg: Algorithm;
  products: Product[];
}

export default function ProductPicker({ algorithms, selected, onAdd, onRemove, onClose }: Props) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string>(algorithms[0]?.id ?? ALL);
  const uid = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The popover hangs off the "＋ Add products" button at left:0, so its usable width is the
  // viewport minus that anchor's x. Measured, because CSS alone can't know it (see .req-prodpick).
  const [left, setLeft] = useState(0);

  useLayoutEffect(() => {
    const measure = () =>
      setLeft(Math.max(0, rootRef.current?.parentElement?.getBoundingClientRect().left ?? 0));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Esc closes from anywhere while open — on the document, not the popover, because focus can
  // legitimately be outside it (e.g. on <body> after a click).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needle = q.trim().toLowerCase();

  const groups: Group[] = useMemo(() => {
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
  }, [algorithms, needle]);

  const total = groups.reduce((n, g) => n + g.products.length, 0);

  // The "All" entry only earns its place while searching — with no query it would just be the old
  // single long list again.
  const ids = useMemo(
    () => [...(needle ? [ALL] : []), ...groups.map((g) => g.alg.id)],
    [needle, groups],
  );

  // What is actually shown: the picked sensor if it is still visible, else the first match. Derived
  // rather than stored, so typing never leaves the right column pointing at a filtered-out sensor.
  const active = ids.includes(picked) ? picked : (groups[0]?.alg.id ?? ALL);
  const activeGroup = groups.find((g) => g.alg.id === active);

  useEffect(() => {
    panelRef.current?.scrollTo?.({ top: 0 });
  }, [active, needle]);

  const tabId = (id: string) => `${uid}-tab-${id}`;
  const panelId = `${uid}-panel`;

  const focusTab = (id: string) =>
    listRef.current?.querySelector<HTMLElement>(`[data-sensor="${CSS.escape(id)}"]`)?.focus();

  const enabledRows = () => [
    ...(panelRef.current?.querySelectorAll<HTMLElement>(".req-picker-row:not(:disabled)") ?? []),
  ];

  const focusProducts = () => (enabledRows()[0] ?? panelRef.current)?.focus();

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = ids.indexOf(active);
    let next: string | undefined;
    if (e.key === "ArrowDown") next = ids[Math.min(i + 1, ids.length - 1)];
    else if (e.key === "ArrowUp") next = ids[Math.max(i - 1, 0)];
    else if (e.key === "Home") next = ids[0];
    else if (e.key === "End") next = ids[ids.length - 1];
    else if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      focusProducts();
      return;
    }
    if (next === undefined) return;
    e.preventDefault();
    setPicked(next);
    focusTab(next);
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusTab(active);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = enabledRows();
    if (rows.length === 0) return;
    e.preventDefault();
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const j = e.key === "ArrowDown" ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0);
    rows[j].focus();
  };

  const row = (alg: Algorithm, p: Product) => {
    const key = productKey({ algorithm: alg.id, product: p.id });
    const already = selected.has(key);
    return (
      <button
        key={key}
        type="button"
        className={already ? "req-picker-row is-added" : "req-picker-row"}
        // A toggle: ＋ adds the product, clicking its ✓ again removes it. The row never disables,
        // so focus stays on it either way.
        aria-pressed={already}
        onClick={() => (already ? onRemove(alg.id, p.id) : onAdd(alg.id, p.id))}
        title={already ? `Remove ${p.label}` : (p.note ?? p.label)}
      >
        <span className="req-picker-plus" aria-hidden="true">
          {already ? (
            <>
              <span className="req-picker-on">✓</span>
              <span className="req-picker-off">−</span>
            </>
          ) : (
            "＋"
          )}
        </span>
        <span className="req-picker-name">{p.label}</span>
        {/* The STAC asset name, pasted from the live STAC by scripts/sync_stac_assets.py; a product
            no live collection carries yet shows its own token, marked as such. Read-only. */}
        {p.stacAsset ? (
          <code className="req-picker-token" title={`STAC asset “${p.stacAsset}” in ${p.stacCollections?.join(", ")}`}>
            {p.stacAsset}
          </code>
        ) : (
          <code className="req-picker-token is-nostac" title="Not in the Disasters STAC yet — this is the product's own token">
            {p.id}
          </code>
        )}
        {p.hazards.length > 0 && (
          <span className="req-picker-haz" title={p.hazards.join(" · ")}>
            {p.hazards.join(" · ")}
          </span>
        )}
      </button>
    );
  };

  const badge = (alg: Algorithm) => {
    const label = statusLabel(alg.status);
    return label ? <span className={`req-picker-status is-${alg.status}`}>{label}</span> : null;
  };

  return (
    <div
      ref={rootRef}
      className="popover req-picker req-prodpick"
      style={{ ["--pick-left" as string]: `${left}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="req-picker-head">
        <input
          className="req-picker-search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && ids.length > 0) {
              e.preventDefault();
              focusTab(active);
            }
          }}
          placeholder="Search sensors, products, hazards…"
          aria-label="Search products"
        />
        <button className="req-modal-x" onClick={onClose} aria-label="Close picker">
          ×
        </button>
      </div>

      {total === 0 ? (
        <p className="req-picker-empty req-picker-none">No products match “{q}”.</p>
      ) : (
        <div className="req-picker-cols">
          <div
            ref={listRef}
            className="req-picker-sensors"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Sensors"
            onKeyDown={onListKey}
          >
            {needle && (
              <button
                type="button"
                role="tab"
                id={tabId(ALL)}
                data-sensor={ALL}
                aria-selected={active === ALL}
                aria-controls={panelId}
                tabIndex={active === ALL ? 0 : -1}
                className={active === ALL ? "req-picker-sensor is-all is-active" : "req-picker-sensor is-all"}
                onClick={() => setPicked(ALL)}
              >
                <span className="req-picker-sicon" aria-hidden="true">
                  🔎
                </span>
                <span className="req-picker-stitle">All matches</span>
                <span className="req-picker-count" title={`${total} matching products`}>
                  {total}
                </span>
              </button>
            )}
            {groups.map(({ alg, products }) => {
              const m = modality(alg.modality);
              const isActive = active === alg.id;
              const nSel = alg.products.filter((p) =>
                selected.has(productKey({ algorithm: alg.id, product: p.id })),
              ).length;
              return (
                <button
                  key={alg.id}
                  type="button"
                  role="tab"
                  id={tabId(alg.id)}
                  data-sensor={alg.id}
                  aria-selected={isActive}
                  aria-controls={panelId}
                  tabIndex={isActive ? 0 : -1}
                  className={isActive ? "req-picker-sensor is-active" : "req-picker-sensor"}
                  style={{ ["--acc" as string]: m.color }}
                  onClick={() => setPicked(alg.id)}
                >
                  <span className="req-picker-sicon" aria-hidden="true" title={m.label}>
                    {m.icon}
                  </span>
                  <span className="req-picker-stitle">
                    {alg.title}
                    {badge(alg)}
                  </span>
                  {needle ? (
                    <span className="req-picker-count is-match" title={`${products.length} matching products`}>
                      {products.length}
                    </span>
                  ) : (
                    <span
                      className={nSel > 0 ? "req-picker-count has-sel" : "req-picker-count"}
                      title={`${nSel} of ${alg.products.length} products on this request`}
                    >
                      {nSel} / {alg.products.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div
            ref={panelRef}
            id={panelId}
            className="req-picker-products"
            role="tabpanel"
            aria-labelledby={tabId(active)}
            tabIndex={-1}
            onKeyDown={onPanelKey}
          >
            {activeGroup ? (
              <>
                <div className="req-picker-group-head" style={{ ["--acc" as string]: modality(activeGroup.alg.modality).color }}>
                  <b>{activeGroup.alg.title}</b>
                  {badge(activeGroup.alg)}
                  <span className="req-picker-meta">
                    {modality(activeGroup.alg.modality).label}
                    {activeGroup.alg.resolution ? ` · ${activeGroup.alg.resolution}` : ""}
                    {needle
                      ? ` · ${activeGroup.products.length} of ${activeGroup.alg.products.length} match`
                      : ` · ${activeGroup.alg.products.length} products`}
                  </span>
                </div>
                {activeGroup.products.map((p) => row(activeGroup.alg, p))}
              </>
            ) : (
              groups.map((g) => (
                <div key={g.alg.id} className="req-picker-group">
                  <div className="req-picker-group-head" style={{ ["--acc" as string]: modality(g.alg.modality).color }}>
                    <span aria-hidden="true">{modality(g.alg.modality).icon}</span>
                    <b>{g.alg.title}</b>
                    {badge(g.alg)}
                    <span className="req-picker-meta">{g.products.length}</span>
                  </div>
                  {g.products.map((p) => row(g.alg, p))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <p className="req-picker-foot">
        Added here counts as <b>manual</b> — it stays on the request even if you change hazards.
        Click a ✓ to remove it.
      </p>
    </div>
  );
}
