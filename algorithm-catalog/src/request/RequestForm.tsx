// The submission form: describe an activation event, pick products, open a prefilled PR.
//
// DESIGN RULE: the user never learns anything about DPS. No queues, no run_command, no ram_min, no
// credentials, no YAML. They describe the event and choose products; everything a job actually
// needs is derived. The one concession to curiosity is the collapsed "What this will run" panel —
// read-only, so the mapping is traceable but never editable.
//
// VALIDATION: every field renders its own violations from src/rules.ts underneath itself, red for
// errors and amber for warnings, each naming the rule that produced it. Errors disable both submit
// buttons (isSubmittable); warnings never block.
//
// A field's violations stay HIDDEN until it has been touched (blurred, or clicked for the
// click-driven sections). This tab is the app's landing view, so an untouched form must not open
// on a wall of red — "Activation event name is required" before the user has typed a character is
// noise, not help. "Show all problems" reveals everything at once, which is the answer to "why is
// the submit button greyed out?" (a disabled button can't tell you itself — it emits no click).

import { useMemo, useState } from "react";
import "../request.css";
import type { Algorithm, AlgorithmInput, Hazard, RequestProduct } from "../types";
import type { Violation } from "../rules";
import { forField, isSubmittable, errorsOnly, validateRequest, STAC_EXAMPLE } from "../rules";
import {
  cleanLocations,
  draftToRequest,
  draftToShape,
  newDraft,
  productKey,
  syncProducts,
  type RequestDraft,
} from "./drafts";
import ProductPicker from "./ProductPicker";

/** Remembers the requester handle across visits — see the note where the draft is initialised. */
const REQUESTER_KEY = "algorithm-catalog:requester";
import { useRequests } from "../RequestsContext";
import { buildRequestFile, ghNewFileUrl, REQUEST_DIR, URL_LIMIT } from "../requests";

interface Props {
  /** The catalog. Passed in by App (which owns src/data.ts) so this component stays data-agnostic. */
  algorithms: Algorithm[];
  /** The controlled hazard vocabulary from data/hazards.json. */
  hazards: Hazard[];
}

// ---------------------------------------------------------------------------------------------
// Inline violation rendering
// ---------------------------------------------------------------------------------------------

function Issues({ all, field, show }: { all: Violation[]; field: string; show: boolean }) {
  const vs = forField(all, field);
  if (!show || vs.length === 0) return null;
  return (
    <ul className="req-issues">
      {vs.map((v, i) => (
        <li key={i} className={v.severity === "error" ? "req-error" : "req-warn"}>
          <span className="req-issue-icon">{v.severity === "error" ? "⛔" : "⚠"}</span>
          <code className="req-issue-rule">{v.field}.{v.rule}</code>
          <span>{v.message}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------
// "What this will run" — derive each algorithm's DPS inputs from what the user typed.
// Purely informational; nothing here is editable and nothing is submitted from it.
// ---------------------------------------------------------------------------------------------

interface DerivedInput {
  input: AlgorithmInput;
  value: string;
  source: string;
}

function deriveInput(input: AlgorithmInput, d: RequestDraft, tokens: string[]): DerivedInput {
  const n = input.name.toLowerCase();
  const has = (s: string) => n.includes(s);
  if (has("activation") || n === "event" || has("event_name")) {
    return { input, value: d.stacName, source: "STAC metadata event name" };
  }
  if (has("product") || has("layer")) {
    return { input, value: tokens.join(" "), source: "products you selected" };
  }
  if (has("start") || n === "date_from" || n === "from_date") {
    return { input, value: d.start, source: "start date" };
  }
  if (has("end") || n === "date_to" || n === "to_date") {
    return { input, value: d.end, source: "end date" };
  }
  if (has("bbox") || has("bound") || has("extent")) {
    return { input, value: d.bbox, source: "bounding box" };
  }
  // Single-acquisition algorithms take one `date` (or `download_date` / `process_date`) per job —
  // one job per day in the window. Show the first day so the shape of the run is obvious.
  if (n === "date" || n.endsWith("_date") || n.startsWith("date")) {
    return { input, value: d.start, source: "one job per day from the event window" };
  }
  if (input.default !== undefined) {
    return { input, value: input.default, source: "algorithm default" };
  }
  return { input, value: "", source: input.required ? "set by the operator at run time" : "not set" };
}

function WhatWillRun({
  algorithms,
  draft,
  products,
}: {
  algorithms: Algorithm[];
  draft: RequestDraft;
  products: RequestProduct[];
}) {
  const byAlg = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of products) {
      const list = m.get(p.algorithm) ?? [];
      list.push(p.product);
      m.set(p.algorithm, list);
    }
    return m;
  }, [products]);

  const rows = algorithms.filter((a) => byAlg.has(a.id));

  return (
    <details className="req-whatruns panel">
      <summary>
        🔍 What this will run <span className="req-whatruns-n">{rows.length} algorithm{rows.length === 1 ? "" : "s"}</span>
      </summary>
      <p className="hint">
        Read-only. You never have to fill any of this in — it is derived from the event and products
        above, and is shown only so the request is traceable back to the job it becomes.
      </p>
      {rows.length === 0 && <p className="req-picker-empty">Pick some products first.</p>}
      {rows.map((a) => {
        const tokens = byAlg.get(a.id) ?? [];
        return (
          <div key={a.id} className="req-runblock">
            <div className="req-runblock-head">
              <b>{a.title}</b>
              <code>{a.algorithmName}</code>
              <span className="req-picker-meta">@{a.version}</span>
              {a.status === "prototype" && <span className="req-badge req-badge-warn">prototype</span>}
            </div>
            <table className="req-runtable">
              <tbody>
                {a.inputs.map((input) => {
                  const d = deriveInput(input, draft, tokens);
                  return (
                    <tr key={input.name}>
                      <th>
                        <code>{input.name}</code>
                        {input.required && <span className="req-req">required</span>}
                      </th>
                      <td>
                        {d.value ? <code className="req-runval">{d.value}</code> : <span className="req-muted">—</span>}
                        <span className="req-muted"> · {d.source}</span>
                      </td>
                    </tr>
                  );
                })}
                {a.inputs.length === 0 && (
                  <tr>
                    <td colSpan={2} className="req-muted">
                      This algorithm declares no inputs in its config.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}
    </details>
  );
}

// ---------------------------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------------------------

export default function RequestForm({ algorithms, hazards }: Props) {
  // The app has no auth and no backend, so it cannot know your GitHub handle — a static page
  // can't read your github.com session. (GitHub captures the real author anyway: whoever clicks
  // "Open PR" is signed in there, so the PR carries their handle.) Best we can do is remember
  // what you typed last time.
  const [draft, setDraft] = useState<RequestDraft>(() => {
    const d = newDraft();
    try {
      d.requester = localStorage.getItem(REQUESTER_KEY) ?? "";
    } catch {
      /* ignore */
    }
    return d;
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [prodQuery, setProdQuery] = useState("");
  const [flash, setFlash] = useState("");
  // Which fields have been interacted with, and the "reveal everything" override.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  // Stable while typing so the JSON preview doesn't churn; refreshed whenever we actually submit.
  const [ts, setTs] = useState(() => new Date().toISOString());

  const { items, stage } = useRequests();

  const patch = (p: Partial<RequestDraft>) => setDraft((d) => ({ ...d, ...p }));
  const touch = (field: string) => setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  const shown = (field: string) => showAll || touched[field] === true;
  const pristine = !showAll && Object.keys(touched).length === 0;

  // Labels for the product chips.
  const productLabel = useMemo(() => {
    const m = new Map<string, { alg: string; product: string; modality: string }>();
    for (const a of algorithms) {
      for (const p of a.products) {
        m.set(productKey({ algorithm: a.id, product: p.id }), {
          alg: a.title,
          product: p.label,
          modality: a.modality,
        });
      }
    }
    return m;
  }, [algorithms]);

  const violations = useMemo(() => validateRequest(draftToShape(draft), hazards), [draft, hazards]);
  const errCount = errorsOnly(violations).length;
  const warnCount = violations.length - errCount;
  const ok = isSubmittable(violations);

  const request = useMemo(() => draftToRequest(draft, ts), [draft, ts]);
  const { filename, json } = useMemo(() => buildRequestFile([request]), [request]);
  const prUrl = useMemo(() => ghNewFileUrl(filename, json), [filename, json]);
  const urlTooLong = prUrl.length > URL_LIMIT;

  // --- hazards ---------------------------------------------------------------------------------
  function toggleHazard(id: string) {
    touch("hazards");
    setDraft((d) => {
      const next = d.hazards.includes(id) ? d.hazards.filter((h) => h !== id) : [...d.hazards, id];
      return { ...d, hazards: next, products: syncProducts(d.products, algorithms, next, d.dismissed) };
    });
  }

  // --- locations -------------------------------------------------------------------------------
  const setLocation = (i: number, v: string) =>
    setDraft((d) => ({ ...d, locations: d.locations.map((l, j) => (j === i ? v : l)) }));
  const addLocation = () => setDraft((d) => ({ ...d, locations: [...d.locations, ""] }));
  const rmLocation = (i: number) => {
    touch("locations");
    setDraft((d) => ({
      ...d,
      locations: d.locations.length > 1 ? d.locations.filter((_, j) => j !== i) : [""],
    }));
  };

  // --- products --------------------------------------------------------------------------------
  const selectedKeys = useMemo(() => new Set(draft.products.map(productKey)), [draft.products]);

  /**
   * Selected products, filtered by the box and bucketed by algorithm. Grouping turns what was a
   * flat wall of ~28 chips into a handful of labelled rows, so the algorithm name is stated once
   * instead of repeated on every chip. Algorithm order follows `algorithms` (catalog order), and
   * products keep their declared order within each group.
   */
  const groupedProducts = useMemo(() => {
    const q = prodQuery.trim().toLowerCase();
    const keep = draft.products.filter((p) => {
      if (!q) return true;
      const meta = productLabel.get(productKey(p));
      return `${meta?.alg ?? p.algorithm} ${meta?.product ?? p.product} ${p.algorithm} ${p.product}`
        .toLowerCase()
        .includes(q);
    });
    const order = new Map(algorithms.map((a, i) => [a.id, i]));
    const buckets = new Map<string, RequestProduct[]>();
    for (const p of keep) {
      const arr = buckets.get(p.algorithm);
      if (arr) arr.push(p);
      else buckets.set(p.algorithm, [p]);
    }
    return [...buckets.entries()].sort(
      (a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99),
    );
  }, [draft.products, prodQuery, productLabel, algorithms]);

  function removeProduct(p: RequestProduct) {
    touch("products");
    const key = productKey(p);
    setDraft((d) => ({
      ...d,
      products: d.products.filter((x) => productKey(x) !== key),
      // Remember dropped hazard-derived picks so a later hazard edit doesn't resurrect them.
      dismissed: p.via === "hazard" && !d.dismissed.includes(key) ? [...d.dismissed, key] : d.dismissed,
    }));
  }

  function addProduct(algorithm: string, product: string) {
    touch("products");
    const key = productKey({ algorithm, product });
    setDraft((d) =>
      d.products.some((x) => productKey(x) === key)
        ? d
        : {
            ...d,
            products: [...d.products, { algorithm, product, via: "manual" }],
            dismissed: d.dismissed.filter((k) => k !== key),
          },
    );
  }

  // --- submit ----------------------------------------------------------------------------------
  function addToRequests() {
    if (!ok) return;
    const now = new Date().toISOString();
    setTs(now);
    stage(draftToRequest(draft, now));
    setFlash(`Staged “${draft.name}” — open 🧺 Requests in the header to submit them together.`);
    window.setTimeout(() => setFlash(""), 4000);
  }

  function openPr() {
    if (!ok || urlTooLong) return;
    const now = new Date().toISOString();
    setTs(now);
    const built = buildRequestFile([draftToRequest(draft, now)]);
    window.open(ghNewFileUrl(built.filename, built.json), "_blank", "noreferrer");
  }

  const autoCount = draft.products.filter((p) => p.via === "hazard").length;
  const manualCount = draft.products.length - autoCount;

  return (
    <div className="req-form" onClick={() => pickerOpen && setPickerOpen(false)}>
      <div className="req-intro">
        <h2>📝 Request an activation</h2>
        <p>
          Describe the event and pick the products you need. We work out which algorithms produce
          them — you never touch a job config. Submitting opens a pull request for review; nothing
          runs until it is merged.
        </p>
        {items.length > 0 && (
          <div className="req-cartnote">
            🧺 {items.length} staged — submit them together from <b>Requests</b> in the header.
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- 1. Event ------------ */}
      <section className="panel req-section">
        <h3>1 · Event</h3>

        <div className="field">
          <label htmlFor="req-name">Activation event name</label>
          <input
            id="req-name"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            onBlur={() => touch("name")}
            placeholder="California Wildfires January 2025"
            aria-invalid={shown("name") && forField(violations, "name").some((v) => v.severity === "error")}
          />
          <div className="req-help">The human-readable name shown on the website.</div>
          <Issues all={violations} field="name" show={shown("name")} />
        </div>

        <div className="field">
          <label htmlFor="req-stac">STAC metadata event name</label>
          <input
            id="req-stac"
            className="req-mono"
            value={draft.stacName}
            onChange={(e) => patch({ stacName: e.target.value })}
            onBlur={() => touch("stacName")}
            placeholder={STAC_EXAMPLE}
            aria-invalid={shown("stacName") && forField(violations, "stacName").some((v) => v.severity === "error")}
          />
          <div className="req-help">
            <code>YYYYMM_Hazard_Location</code> — checked live against the same rule the pipeline
            uses, e.g. <code>{STAC_EXAMPLE}</code> or <code>202501_Fire_CA</code>.
          </div>
          <Issues all={violations} field="stacName" show={shown("stacName")} />
        </div>

        <div className="field two">
          <div>
            <label htmlFor="req-start">Start date</label>
            <input
              id="req-start"
              type="date"
              value={draft.start}
              onChange={(e) => patch({ start: e.target.value })}
              onBlur={() => touch("start")}
            />
            <Issues all={violations} field="start" show={shown("start")} />
          </div>
          <div>
            <label htmlFor="req-end">End date</label>
            <input
              id="req-end"
              type="date"
              value={draft.end}
              min={draft.start || undefined}
              onChange={(e) => patch({ end: e.target.value })}
              onBlur={() => touch("end")}
            />
            <Issues all={violations} field="end" show={shown("end")} />
          </div>
        </div>

        <div className="field two">
          <div>
            <label htmlFor="req-requester">
              Requested by <span className="opt">(optional)</span>
            </label>
            <input
              id="req-requester"
              value={draft.requester}
              onChange={(e) => {
                patch({ requester: e.target.value });
                try {
                  localStorage.setItem(REQUESTER_KEY, e.target.value);
                } catch {
                  /* ignore */
                }
              }}
              placeholder="@github-handle or name"
            />
            <div className="req-help">
              Remembered on this browser. GitHub records the real author of the PR anyway — this is
              only needed when you're filing on someone else's behalf.
            </div>
          </div>
          <div>
            <label htmlFor="req-notes">
              Notes <span className="opt">(optional)</span>
            </label>
            <input
              id="req-notes"
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Anything the reviewers should know"
            />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- 2. Hazards ---------- */}
      <section className="panel req-section">
        <h3>2 · Hazards</h3>
        <div className="req-help">
          Pick every hazard this activation covers. Selecting a hazard auto-selects the products
          suited to it (you can drop or add any of them in step 4).
        </div>
        <div className="req-hazards">
          {hazards.map((h) => {
            const on = draft.hazards.includes(h.id);
            return (
              <button
                key={h.id}
                type="button"
                className={on ? "req-haz is-on" : "req-haz"}
                style={on ? { borderColor: h.color, background: `${h.color}18`, color: h.color } : undefined}
                onClick={() => toggleHazard(h.id)}
                aria-pressed={on}
              >
                <span aria-hidden="true">{h.icon}</span> {h.label}
                <code className="req-haz-token">{h.token}</code>
              </button>
            );
          })}
          {hazards.length === 0 && (
            <p className="req-picker-empty">No hazard vocabulary loaded.</p>
          )}
        </div>
        <Issues all={violations} field="hazards" show={shown("hazards")} />
      </section>

      {/* ---------------------------------------------------------------- 3. Locations -------- */}
      <section className="panel req-section">
        <h3>3 · Locations</h3>
        <div className="field">
          <label>Places affected</label>
          {draft.locations.map((loc, i) => (
            <div className="req-row" key={i}>
              <input
                value={loc}
                onChange={(e) => setLocation(i, e.target.value)}
                onBlur={() => touch("locations")}
                placeholder="Los Angeles, CA"
                aria-label={`Location ${i + 1}`}
              />
              <button
                className="rm"
                type="button"
                onClick={() => rmLocation(i)}
                aria-label={`Remove location ${i + 1}`}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
          <button className="btn" type="button" onClick={addLocation}>
            ＋ Add location
          </button>
          <Issues all={violations} field="locations" show={shown("locations")} />
        </div>

        <div className="field">
          <label htmlFor="req-bbox">
            Bounding box <span className="opt">(optional)</span>
          </label>
          <input
            id="req-bbox"
            className="req-mono"
            value={draft.bbox}
            onChange={(e) => patch({ bbox: e.target.value })}
            onBlur={() => touch("bbox")}
            placeholder="-118.9,33.7,-117.6,34.4"
          />
          <div className="req-help">
            WGS84 <code>min_lon,min_lat,max_lon,max_lat</code>. Leave blank if you don't have one.
          </div>
          <Issues all={violations} field="bbox" show={shown("bbox")} />
        </div>

        {/* Scene selectors — for when you already know the exact tiles instead of a place name.
            These map straight onto sentinel2's `tile` and landsat's `process_tile` inputs. */}
        <div className="field two">
          <div>
            <label htmlFor="req-mgrs">
              Sentinel-2 tile(s) <span className="opt">(optional)</span>
            </label>
            <input
              id="req-mgrs"
              className="req-mono"
              value={draft.mgrsTiles}
              onChange={(e) => patch({ mgrsTiles: e.target.value })}
              onBlur={() => touch("mgrsTiles")}
              placeholder="T17RLN T17RLM"
            />
            <div className="req-help">
              MGRS tile IDs, space-separated. Feeds Sentinel-2's <code>tile</code> input.
            </div>
            <Issues all={violations} field="mgrsTiles" show={shown("mgrsTiles")} />
          </div>
          <div>
            <label htmlFor="req-wrs2">
              Landsat path/row <span className="opt">(optional)</span>
            </label>
            <input
              id="req-wrs2"
              className="req-mono"
              value={draft.wrs2Tiles}
              onChange={(e) => patch({ wrs2Tiles: e.target.value })}
              onBlur={() => touch("wrs2Tiles")}
              placeholder="171035"
            />
            <div className="req-help">
              WRS-2 path/row, 6 digits. Feeds Landsat's <code>process_tile</code> input.
            </div>
            <Issues all={violations} field="wrs2Tiles" show={shown("wrs2Tiles")} />
          </div>
        </div>
        <div className="req-help req-tile-note">
          Leave both blank to process everything in the area of interest. Fill one in only if you
          already know the exact scenes you need.
        </div>
      </section>

      {/* ---------------------------------------------------------------- 4. Products --------- */}
      <section className="panel req-section">
        <h3>4 · Products</h3>
        <div className="req-help">
          {autoCount} auto-selected from your hazards, {manualCount} added by hand. Anything the
          hazard mapping missed, add it yourself — the mapping is a hint, not a limit.
        </div>

        {/* Search over the SELECTED list. With a broad hazard set this can run to dozens of
            chips, so grouping by algorithm + a filter box keeps it scannable. */}
        {draft.products.length > 4 && (
          <div className="search req-prod-search">
            <span className="search-ico" aria-hidden>
              🔍
            </span>
            <input
              value={prodQuery}
              onChange={(e) => setProdQuery(e.target.value)}
              placeholder="Filter selected products — sensor or product name…"
              aria-label="Filter selected products"
            />
            {prodQuery && (
              <button
                className="search-x"
                type="button"
                onClick={() => setProdQuery("")}
                aria-label="Clear product filter"
              >
                ×
              </button>
            )}
          </div>
        )}

        <div className="req-prod-groups">
          {groupedProducts.map(([algId, rows]) => {
            const algLabel = productLabel.get(productKey(rows[0]))?.alg ?? algId;
            return (
              <div className="req-prod-group" key={algId}>
                <div className="req-prod-group-hd">
                  <span className="req-prod-group-name">{algLabel}</span>
                  <span className="req-prod-group-n">
                    {rows.length} product{rows.length === 1 ? "" : "s"}
                  </span>
                  <button
                    className="linkbtn req-group-clear"
                    type="button"
                    onClick={() => rows.forEach(removeProduct)}
                  >
                    Remove all
                  </button>
                </div>
                <div className="req-chips">
                  {rows.map((p) => {
                    const meta = productLabel.get(productKey(p));
                    return (
                      <span key={productKey(p)} className={`req-chip req-chip-${p.via}`}>
                        <span className="req-chip-prod">{meta?.product ?? p.product}</span>
                        <span
                          className={
                            p.via === "hazard" ? "req-badge req-badge-auto" : "req-badge req-badge-manual"
                          }
                        >
                          {p.via === "hazard" ? "auto" : "manual"}
                        </span>
                        <button
                          className="req-chip-x"
                          type="button"
                          onClick={() => removeProduct(p)}
                          aria-label={`Remove ${meta?.product ?? p.product}`}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {draft.products.length === 0 && (
            <p className="req-picker-empty">
              Nothing selected yet — pick a hazard above, or add products directly.
            </p>
          )}
          {draft.products.length > 0 && groupedProducts.length === 0 && (
            <p className="req-picker-empty">No selected product matches “{prodQuery}”.</p>
          )}
        </div>

        <div className="control req-addwrap" onClick={(e) => e.stopPropagation()}>
          <button className="btn" type="button" onClick={() => setPickerOpen((v) => !v)}>
            ＋ Add products
          </button>
          {pickerOpen && (
            <ProductPicker
              algorithms={algorithms}
              selected={selectedKeys}
              onAdd={addProduct}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>

        <Issues all={violations} field="products" show={shown("products")} />

        <WhatWillRun algorithms={algorithms} draft={draft} products={draft.products} />
      </section>

      {/* ---------------------------------------------------------------- 5. Review ----------- */}
      <section className="panel req-section">
        <h3>5 · Review &amp; submit</h3>

        <label className="jsonlabel">
          File preview — <code>{filename}</code>
        </label>
        <pre className="urlbox">{json}</pre>

        {urlTooLong && (
          <p className="hint req-error">
            ⚠ This request is too big for GitHub's prefilled editor ({prUrl.length.toLocaleString()}{" "}
            chars, limit {URL_LIMIT.toLocaleString()}). Use <b>📋 Copy JSON</b> and add the file to{" "}
            <code>{REQUEST_DIR}/</code> by hand.
          </p>
        )}

        {flash && <p className="hint req-flash">✅ {flash}</p>}

        <div className="req-submitbar">
          <div className="req-summarywrap">
            <div
              className={
                pristine
                  ? "req-summary req-neutral"
                  : errCount > 0
                    ? "req-summary req-error"
                    : warnCount > 0
                      ? "req-summary req-warn"
                      : "req-summary req-okay"
              }
            >
              {pristine
                ? "📝 Fill in the event, hazards and products — submitting unlocks when every rule passes."
                : errCount > 0
                  ? `⚠ ${errCount} problem${errCount === 1 ? "" : "s"} to fix`
                  : warnCount > 0
                    ? `⚠ ${warnCount} warning${warnCount === 1 ? "" : "s"} — you can still submit`
                    : `✅ Ready — ${cleanLocations(draft.locations).length} location${cleanLocations(draft.locations).length === 1 ? "" : "s"}, ${draft.products.length} product${draft.products.length === 1 ? "" : "s"}`}
            </div>
            {errCount > 0 && !showAll && (
              <button className="req-linkbtn" type="button" onClick={() => setShowAll(true)}>
                Show all problems
              </button>
            )}
          </div>
          <div className="foot">
            <button className="btn" type="button" onClick={() => navigator.clipboard?.writeText(json)}>
              📋 Copy JSON
            </button>
            <button className="btn" type="button" disabled={!ok} onClick={addToRequests}>
              ➕ Add to requests
            </button>
            <button className="btn primary" type="button" disabled={!ok || urlTooLong} onClick={openPr}>
              Open PR ↗
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
