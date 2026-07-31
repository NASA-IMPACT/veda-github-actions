import { useEffect, useMemo, useState } from "react";
import type { IndexDoc, PricingDoc, Resource, Service } from "./types";
import { loadDataset, loadRegion } from "./data";
import { makeResource } from "./defaults";
import { costOf, grandTotal, SERVICE_LABEL } from "./compute";
import { money } from "./format";
import { resourcesToCsv, downloadCsv, downloadText } from "./export";
import { buildHtml, buildMarkdown, ghNewFileUrl, slugName, REPORT_DIR } from "./report";
import { ResourceCard } from "./components/ResourceCard";
import { SourcePanel } from "./components/SourcePanel";

const ADD: Service[] = ["ec2", "s3", "rds", "lambda"];
const WORKFLOW_URL =
  "https://github.com/NASA-IMPACT/veda-github-actions/actions/workflows/aws-pricing.yml";

export default function App() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  const [source, setSource] = useState<"live" | "snapshot">("live");
  const [base, setBase] = useState("");
  const [index, setIndex] = useState<IndexDoc | null>(null);
  const [region, setRegion] = useState("");
  const [pricing, setPricing] = useState<PricingDoc | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [reportName, setReportName] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  // Initial load: index + default region's pricing, seeded with a couple of example resources.
  useEffect(() => {
    loadDataset()
      .then((d) => {
        setSource(d.source);
        setBase(d.base);
        setIndex(d.index);
        setRegion(d.pricing.region);
        setPricing(d.pricing);
        setResources([makeResource("ec2", d.pricing), makeResource("lambda", d.pricing)]);
        setStatus("ready");
      })
      .catch((e) => {
        setErr(String(e?.message ?? e));
        setStatus("error");
      });
  }, []);

  // Region switch: fetch that region's file from the same base (live SHA or snapshot).
  function changeRegion(next: string) {
    if (!index || next === region) return;
    const entry = index.regions[next];
    if (!entry) return;
    loadRegion(base, entry.file)
      .then((p) => {
        setRegion(next);
        setPricing(p);
      })
      .catch((e) => setErr(String(e?.message ?? e)));
  }

  const total = useMemo(
    () => (pricing ? grandTotal(resources, pricing) : 0),
    [resources, pricing],
  );

  // Per-service subtotals for the grand-total summary.
  const byService = useMemo(() => {
    const m = new Map<Service, number>();
    if (pricing)
      for (const r of resources) m.set(r.service, (m.get(r.service) ?? 0) + costOf(r, pricing).monthly);
    return m;
  }, [resources, pricing]);

  if (status === "loading") return <div className="splash">Loading AWS prices…</div>;
  if (status === "error" || !pricing || !index)
    return <div className="splash error">Couldn’t load pricing data.<br /><code>{err}</code></div>;

  const genDate = (pricing.generated || "").slice(0, 10);

  function saveReport(kind: "csv" | "html" | "md", where: "download" | "github") {
    setMenuOpen(false);
    const stamp = new Date().toISOString();
    const base = reportName.trim() ? slugName(reportName) : `aws-estimate_${region}_${stamp.slice(0, 10)}`;
    if (kind === "csv") {
      downloadCsv(`${base}.csv`, resourcesToCsv(resources, pricing!, stamp));
      return;
    }
    const content =
      kind === "html"
        ? buildHtml(resources, pricing!, reportName, stamp)
        : buildMarkdown(resources, pricing!, reportName, stamp);
    if (where === "download") {
      downloadText(`${base}.${kind}`, content, kind === "html" ? "text/html" : "text/markdown");
      return;
    }
    const url = ghNewFileUrl(`${REPORT_DIR}/${base}.${kind}`, content);
    if (url.length > 190000) {
      alert("This estimate is too large for GitHub's prefilled editor — use a Download option instead, then add the file to the cost-reports/ directory.");
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">$</span>
          <div>
            <h1>AWS Cost Calculator</h1>
            <p>Add resources, tune the inputs, get a live monthly total — priced from AWS directly.
              <strong> Estimates are approximate.</strong></p>
          </div>
        </div>
        <div className="freshness">
          <select className="region-select" value={region} onChange={(e) => changeRegion(e.target.value)}>
            {Object.entries(index.regions)
              .sort((a, b) => a[1].label.localeCompare(b[1].label))
              .map(([code, r]) => (
                <option key={code} value={code}>{r.label} ({code})</option>
              ))}
          </select>
          <span className={`pill ${source}`}>
            {source === "live" ? "● live from AWS" : "○ snapshot"}
          </span>
          {genDate && <span className="gen">updated {genDate}</span>}
        </div>
      </header>

      <div className="toolbar">
        <span className="toolbar-label">Add a resource:</span>
        {ADD.map((s) => (
          <button key={s} className="add-btn" data-service={s}
                  onClick={() => setResources((r) => [...r, makeResource(s, pricing)])}>
            + {s.toUpperCase()}
          </button>
        ))}
        <span className="spacer" />
        {resources.length > 0 && (
          <>
            <input
              className="report-name"
              value={reportName}
              placeholder="report name (optional)"
              onChange={(e) => setReportName(e.target.value)}
            />
            <div className="export-wrap">
              <button className="csv-btn" onClick={() => setMenuOpen((o) => !o)}>
                ⬇ Download / Save ▾
              </button>
              {menuOpen && (
                <>
                  <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                  <div className="export-menu">
                    <button onClick={() => saveReport("csv", "download")}>Spreadsheet (.csv)</button>
                    <button onClick={() => saveReport("html", "download")}>Web page (.html)</button>
                    <button onClick={() => saveReport("md", "download")}>Markdown (.md)</button>
                    <div className="menu-sep">Save to GitHub → {REPORT_DIR}/</div>
                    <button onClick={() => saveReport("html", "github")}>HTML → GitHub</button>
                    <button onClick={() => saveReport("md", "github")}>Markdown → GitHub</button>
                  </div>
                </>
              )}
            </div>
            <button className="ghost-btn" onClick={() => setResources([])}>Clear all</button>
          </>
        )}
      </div>

      <main className="cards">
        {resources.length === 0 && (
          <div className="empty">
            <p>No resources yet.</p>
            <p className="empty-sub">Add {ADD.map((s) => SERVICE_LABEL[s].split(" ")[0]).join(", ")} above to start estimating.</p>
          </div>
        )}
        {resources.map((r) => (
          <ResourceCard
            key={r.id}
            resource={r}
            pricing={pricing}
            onChange={(next) => setResources((list) => list.map((x) => (x.id === next.id ? next : x)))}
            onRemove={(id) => setResources((list) => list.filter((x) => x.id !== id))}
          />
        ))}
      </main>

      {resources.length > 0 && (
        <section className="summary">
          <div className="summary-left">
            <span className="summary-title">Grand total</span>
            <span className="summary-meta">
              {resources.length} resource{resources.length === 1 ? "" : "s"} · {region} · On-Demand · approximate
            </span>
            <div className="summary-chips">
              {[...byService.entries()].map(([svc, amt]) => (
                <span key={svc} className="chip" data-service={svc}>
                  {svc.toUpperCase()} {money(amt)}
                </span>
              ))}
            </div>
          </div>
          <div className="summary-right">
            <span className="grand">{money(total)}<small>/mo</small></span>
            <span className="grand-year">≈ {money(total * 12)} / year</span>
          </div>
        </section>
      )}

      <SourcePanel pricing={pricing} />

      <details className="howto">
        <summary>How to refresh prices to the latest</summary>
        <ol>
          <li>Prices refresh <strong>automatically every Monday</strong> — and can be re-run any time.</li>
          <li>
            To refresh now, open the{" "}
            <a href={WORKFLOW_URL} target="_blank" rel="noreferrer">AWS Pricing workflow</a> →
            <strong> Run workflow</strong> → (optionally set <code>regions</code>, comma-separated,
            e.g. <code>us-west-2,us-east-1</code>) → <strong>Run workflow</strong>. It re-pulls
            On-Demand prices from AWS and publishes them to the <code>aws-pricing/data</code> branch.
          </li>
          <li>
            When the run finishes (~1–2 min), <strong>reload this page</strong>. The app always fetches
            the newest published commit (by SHA), so a hard refresh isn’t needed — the “updated” date
            and version stamps above will move forward.
          </li>
        </ol>
        <p className="howto-foot">
          Currently showing data generated <strong>{genDate || "unknown"}</strong>
          {source === "snapshot" && " (bundled snapshot — the aws-pricing/data branch isn’t published yet; run the workflow above to go live)"}.
        </p>
      </details>

      {/* Sticky mini-total so the number is always in view while scrolling long carts. */}
      {resources.length > 0 && (
        <div className="stickytotal">
          <span>Total</span>
          <strong>{money(total)}<small>/mo</small></strong>
        </div>
      )}
    </div>
  );
}
