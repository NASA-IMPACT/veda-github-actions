// Client-side monthly cost math. Pure functions of the pricing doc + the user's input params.
// Formulas match docs/AWS_PRICING.md; all On-Demand, no free tiers / discounts / taxes.
import type { Cost, LineItem, PricingDoc, Resource, Service } from "./types";
import { money, rate } from "./format";

export const DEFAULT_HOURS = 730; // hours in an average month (matches AWS's own calculator)

export const SERVICE_LABEL: Record<Service, string> = {
  ec2: "EC2 — virtual server",
  s3: "S3 — object storage",
  rds: "RDS — managed database",
  lambda: "Lambda — serverless functions",
};

export function costOf(r: Resource, p: PricingDoc): Cost {
  const b: LineItem[] = [];

  if (r.service === "ec2") {
    const inst = p.ec2.instances[r.params.instanceType];
    const hourly = inst?.hourlyUSD ?? 0;
    b.push({
      label: `${r.params.count} × ${r.params.instanceType} @ ${rate(hourly)}/hr × ${r.params.hours} h`,
      amount: hourly * r.params.hours * r.params.count,
    });
    if (r.params.ebsGB > 0) {
      const ebs = p.ebs[r.params.ebsType] ?? 0;
      b.push({
        label: `EBS ${r.params.ebsType} — ${r.params.ebsGB} GB @ ${rate(ebs)}/GB-mo`,
        amount: r.params.ebsGB * ebs,
      });
    }
    return total(b);
  }

  if (r.service === "s3") {
    const s3 = p.s3;
    b.push({
      label: `Storage — ${r.params.storageGB} GB @ ${rate(s3.standardStorageUsdPerGBMonth)}/GB-mo`,
      amount: r.params.storageGB * s3.standardStorageUsdPerGBMonth,
    });
    if (r.params.putCount > 0)
      b.push({
        label: `PUT/POST/LIST — ${r.params.putCount.toLocaleString()} reqs @ ${rate(s3.putPer1k)}/1k`,
        amount: (r.params.putCount / 1000) * s3.putPer1k,
      });
    if (r.params.getCount > 0)
      b.push({
        label: `GET/other — ${r.params.getCount.toLocaleString()} reqs @ ${rate(s3.getPer1k)}/1k`,
        amount: (r.params.getCount / 1000) * s3.getPer1k,
      });
    if (r.params.dtoGB > 0)
      b.push({
        label: `Data transfer out — ${r.params.dtoGB} GB @ ${rate(s3.dataTransferOutUsdPerGB)}/GB`,
        amount: r.params.dtoGB * s3.dataTransferOutUsdPerGB,
      });
    const note =
      r.params.dtoGB > 0 && s3.dataTransferOutSource === "static-fallback"
        ? "Data-transfer-out uses a documented flat rate (not from the live price file); first GB/mo is free in reality."
        : undefined;
    return total(b, note);
  }

  if (r.service === "rds") {
    const inst = p.rds.instances[r.params.instanceKey];
    const hourly = inst?.hourlyUSD ?? 0;
    const label = inst ? `${inst.engine} ${inst.instanceType}` : r.params.instanceKey;
    b.push({
      label: `${r.params.count} × ${label} @ ${rate(hourly)}/hr × ${r.params.hours} h`,
      amount: hourly * r.params.hours * r.params.count,
    });
    if (r.params.storageGB > 0) {
      const st = p.rds.storage[r.params.storageType] ?? 0;
      b.push({
        label: `Storage ${r.params.storageType} — ${r.params.storageGB} GB @ ${rate(st)}/GB-mo`,
        amount: r.params.storageGB * st,
      });
    }
    return total(b);
  }

  // lambda
  const lam = p.lambda;
  const reqCost = r.params.requests * lam.requestUsd;
  const gbSec = r.params.requests * (r.params.durationMs / 1000) * (r.params.memoryMB / 1024);
  b.push({
    label: `Requests — ${r.params.requests.toLocaleString()} @ ${rate(lam.requestUsd)} each`,
    amount: reqCost,
  });
  b.push({
    label: `Compute — ${Math.round(gbSec).toLocaleString()} GB-seconds @ ${rate(lam.gbSecondUsd)} each`,
    amount: gbSec * lam.gbSecondUsd,
  });
  return total(b);
}

function total(breakdown: LineItem[], note?: string): Cost {
  return { monthly: breakdown.reduce((s, x) => s + x.amount, 0), breakdown, note };
}

// Sum a whole cart.
export function grandTotal(resources: Resource[], p: PricingDoc): number {
  return resources.reduce((s, r) => s + costOf(r, p).monthly, 0);
}

export function monthlyLabel(n: number): string {
  return `${money(n)}/mo`;
}
