// Export the current estimate as a clean, itemized CSV: metadata header, one block per resource
// (config + line-item breakdown + subtotal), grand monthly/annual totals, and the AWS source links
// so provenance travels with the file. Opens cleanly in Excel / Google Sheets / Numbers.
import type { PricingDoc, Resource, Service } from "./types";
import { costOf } from "./compute";

function esc(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function row(...cells: (string | number)[]): string {
  return cells.map(esc).join(",");
}

export function configSummary(r: Resource): string {
  switch (r.service) {
    case "ec2":
      return `${r.params.count} × ${r.params.instanceType}, ${r.params.hours} h/mo` +
        (r.params.ebsGB > 0 ? `, EBS ${r.params.ebsType} ${r.params.ebsGB} GB` : "");
    case "s3":
      return `${r.params.storageGB} GB, ${r.params.putCount.toLocaleString()} PUT, ` +
        `${r.params.getCount.toLocaleString()} GET, ${r.params.dtoGB} GB out`;
    case "rds":
      return `${r.params.count} × ${r.params.instanceKey.replace("|", " ")}, ${r.params.hours} h/mo, ` +
        `${r.params.storageGB} GB ${r.params.storageType}`;
    case "lambda":
      return `${r.params.requests.toLocaleString()} reqs/mo, ${r.params.durationMs} ms, ${r.params.memoryMB} MB`;
  }
}

const SERVICES: Service[] = ["ec2", "s3", "rds", "lambda"];

export function resourcesToCsv(resources: Resource[], pricing: PricingDoc, exportedISO: string): string {
  const L: string[] = [];
  L.push(row("AWS Cost Calculator — monthly estimate"));
  L.push(row("Region", `${pricing.label} (${pricing.region})`));
  L.push(row("Priced from", "AWS Price List Bulk API — On-Demand list prices"));
  L.push(row("Data generated", pricing.generated));
  L.push(row("Exported", exportedISO));
  L.push("");
  L.push(row("Service", "Name", "Configuration", "Line item", "Amount (USD/mo)"));

  let grand = 0;
  for (const r of resources) {
    const c = costOf(r, pricing);
    grand += c.monthly;
    const cfg = configSummary(r);
    c.breakdown.forEach((ln, i) =>
      L.push(row(
        i === 0 ? r.service.toUpperCase() : "",
        i === 0 ? r.name : "",
        i === 0 ? cfg : "",
        ln.label,
        ln.amount.toFixed(2),
      )),
    );
    L.push(row("", "", "", "Subtotal", c.monthly.toFixed(2)));
    L.push("");
  }

  L.push(row("", "", "", "TOTAL (monthly)", grand.toFixed(2)));
  L.push(row("", "", "", "TOTAL (annual)", (grand * 12).toFixed(2)));
  L.push("");
  L.push(row("Prices are AWS On-Demand list rates only — exclude Free Tier, Savings Plans / Reserved Instances, volume & EDP discounts, and taxes."));
  for (const k of SERVICES) {
    const s = pricing.sources.services[k];
    L.push(row(`Source (${k.toUpperCase()})`, s.pricingPage, s.priceListUrl, `version ${s.version}`));
  }
  return L.join("\n");
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Defer cleanup: revoking the object URL synchronously after click() races the download and makes
  // some browsers save a UUID with no extension. Give the download time to start, then clean up.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}

export function downloadCsv(filename: string, text: string): void {
  downloadText(filename, "﻿" + text, "text/csv"); // BOM so Excel opens it cleanly
}
