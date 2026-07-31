// "Where do these prices come from?" — hyperlinks every service back to its AWS source,
// plus the exact bulk-file URL and the AWS-published version stamp for this region's data.
import type { PricingDoc, Service } from "../types";

const ORDER: Service[] = ["ec2", "s3", "rds", "lambda"];
const SHORT: Record<Service, string> = { ec2: "EC2", s3: "S3", rds: "RDS", lambda: "Lambda" };

function fmtVersion(v: string): string {
  // AWS versions look like "20260728175247" (YYYYMMDDHHMMSS) → "2026-07-28".
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : v;
}

export function SourcePanel({ pricing }: { pricing: PricingDoc }) {
  const s = pricing.sources;
  return (
    <details className="sources" open>
      <summary>
        <span className="sources-title">Where these prices come from</span>
        <span className="sources-sub">
          On-Demand list prices pulled from AWS's public{" "}
          <a href={s.bulkApiDoc} target="_blank" rel="noreferrer">
            Price List Bulk API
          </a>{" "}
          for <strong>{pricing.label}</strong> — no estimates, no middle-man.
        </span>
      </summary>
      <table className="sources-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>AWS pricing page</th>
            <th>Raw price list (JSON)</th>
            <th>AWS version</th>
          </tr>
        </thead>
        <tbody>
          {ORDER.map((k) => {
            const svc = s.services[k];
            return (
              <tr key={k}>
                <td>{SHORT[k]}</td>
                <td>
                  <a href={svc.pricingPage} target="_blank" rel="noreferrer">
                    {svc.pricingPage.replace("https://", "")}
                  </a>
                </td>
                <td>
                  <a href={svc.priceListUrl} target="_blank" rel="noreferrer">
                    {svc.offerCode}
                  </a>
                </td>
                <td className="mono">{fmtVersion(svc.version)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="sources-foot">
        Prices are AWS On-Demand list rates only — they exclude Free Tier, Savings Plans / Reserved
        Instances, volume &amp; EDP discounts, and taxes. Use as an estimate, not a bill.
      </p>
    </details>
  );
}
