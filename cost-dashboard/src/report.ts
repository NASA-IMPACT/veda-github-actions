// Build a shareable estimate as Markdown or self-contained HTML, and a GitHub "new file" URL that
// prefills either into the repo's cost-reports/ directory (the user names it, reviews, and commits —
// same prefilled-PR idea as leave-dashboard's overrides). No backend, no token.
import type { PricingDoc, Resource, Service } from "./types";
import { costOf } from "./compute";
import { configSummary } from "./export";
import { money } from "./format";

const OWNER_REPO = "NASA-IMPACT/veda-github-actions";
export const REPORT_DIR = "cost-reports";
const SERVICES: Service[] = ["ec2", "s3", "rds", "lambda"];
const DISCLAIMER =
  "Prices are AWS On-Demand list rates only — they exclude Free Tier, Savings Plans / Reserved " +
  "Instances, volume & EDP discounts, and taxes. Use as an estimate, not a bill.";

export function slugName(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "aws-estimate";
}

function grandOf(resources: Resource[], p: PricingDoc): number {
  return resources.reduce((s, r) => s + costOf(r, p).monthly, 0);
}

// ---------------- Markdown ----------------

const mdEsc = (s: string) => s.replace(/\|/g, "\\|");

export function buildMarkdown(resources: Resource[], p: PricingDoc, name: string, exportedISO: string): string {
  const grand = grandOf(resources, p);
  const rows = resources.map((r) => {
    const c = costOf(r, p);
    return `| ${r.service.toUpperCase()} | ${mdEsc(r.name || "—")} | ${mdEsc(configSummary(r))} | ${money(c.monthly)} |`;
  });
  const sources = SERVICES.map((k) => {
    const s = p.sources.services[k];
    return `- **${k.toUpperCase()}** — [pricing page](${s.pricingPage}) · [price list](${s.priceListUrl}) · version ${s.version}`;
  });
  return [
    `# ${name.trim() || "AWS Cost Estimate"}`,
    "",
    `- **Region:** ${p.label} (${p.region})`,
    `- **Priced from:** AWS Price List Bulk API — On-Demand list prices _(approximate)_`,
    `- **Data generated:** ${p.generated}`,
    `- **Exported:** ${exportedISO}`,
    "",
    "| Service | Name | Configuration | Monthly (USD) |",
    "|---|---|---|---|",
    ...rows,
    `| **Total** | | | **${money(grand)} / mo · ${money(grand * 12)} / yr** |`,
    "",
    `> ${DISCLAIMER}`,
    "",
    "## Sources",
    ...sources,
    "",
  ].join("\n");
}

// ---------------- HTML (self-contained) ----------------

const htmlEsc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildHtml(resources: Resource[], p: PricingDoc, name: string, exportedISO: string): string {
  const title = name.trim() || "AWS Cost Estimate";
  const grand = grandOf(resources, p);
  const rows = resources
    .map((r) => {
      const c = costOf(r, p);
      const lines = c.breakdown
        .map((l) => `<div class="li"><span>${htmlEsc(l.label)}</span><span>${money(l.amount)}</span></div>`)
        .join("");
      return `<tr>
        <td><span class="b b-${r.service}">${r.service.toUpperCase()}</span></td>
        <td class="name">${htmlEsc(r.name || "—")}</td>
        <td>${htmlEsc(configSummary(r))}<div class="lines">${lines}</div></td>
        <td class="amt">${money(c.monthly)}</td>
      </tr>`;
    })
    .join("");
  const sources = SERVICES.map((k) => {
    const s = p.sources.services[k];
    return `<tr><td>${k.toUpperCase()}</td>
      <td><a href="${s.pricingPage}">${htmlEsc(s.pricingPage.replace("https://", ""))}</a></td>
      <td><a href="${s.priceListUrl}">${s.offerCode}</a></td><td>${htmlEsc(s.version)}</td></tr>`;
  }).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEsc(title)} — AWS cost estimate</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#16191f;background:#f4f6f8;margin:0;padding:28px}
  .wrap{max-width:900px;margin:0 auto}
  header{background:linear-gradient(180deg,#232f3e,#2f3d4f);color:#fff;padding:20px 24px;border-radius:12px}
  header h1{margin:0 0 4px;font-size:22px}
  header .meta{font-size:12px;color:#c4ccd6}
  .card{background:#fff;border:1px solid #e3e7ec;border-radius:12px;margin-top:16px;overflow:hidden}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-size:12px;color:#5a6572;padding:10px 14px;border-bottom:1px solid #e3e7ec;background:#fbfcfd}
  td{padding:12px 14px;border-bottom:1px solid #f0f2f5;font-size:13px;vertical-align:top}
  td.amt{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
  td.name{font-weight:600}
  .lines{margin-top:6px}
  .li{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:#5a6572}
  .b{font-size:11px;font-weight:800;color:#fff;padding:2px 7px;border-radius:5px;background:#5a6572}
  .b-ec2{background:#ff9900;color:#232f3e}.b-s3{background:#3f9c35}.b-rds{background:#2e73b8}.b-lambda{background:#c8511b}
  .total{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;background:#232f3e;color:#fff;border-radius:12px;margin-top:16px}
  .total .g{font-size:26px;font-weight:800;color:#ff9900}
  .note{font-size:12px;color:#5a6572;margin:14px 2px}
  h2{font-size:14px;margin:22px 2px 8px}
  a{color:#2e73b8;text-decoration:none}
</style></head>
<body><div class="wrap">
  <header>
    <h1>${htmlEsc(title)}</h1>
    <div class="meta">${htmlEsc(p.label)} (${p.region}) · On-Demand (approximate) · data ${htmlEsc(
      p.generated,
    )} · exported ${htmlEsc(exportedISO)}</div>
  </header>
  <div class="card"><table>
    <thead><tr><th>Service</th><th>Name</th><th>Configuration</th><th>Monthly</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <div class="total"><span>Grand total</span><span><span class="g">${money(grand)}</span> / mo · ${money(
    grand * 12,
  )} / yr</span></div>
  <p class="note">${DISCLAIMER}</p>
  <h2>Where these prices come from</h2>
  <div class="card"><table>
    <thead><tr><th>Service</th><th>AWS pricing page</th><th>Raw price list</th><th>Version</th></tr></thead>
    <tbody>${sources}</tbody>
  </table></div>
</div></body></html>`;
}

// ---------------- GitHub prefilled new-file URL ----------------

export function ghNewFileUrl(path: string, content: string): string {
  return `https://github.com/${OWNER_REPO}/new/main?filename=${encodeURIComponent(
    path,
  )}&value=${encodeURIComponent(content)}`;
}
