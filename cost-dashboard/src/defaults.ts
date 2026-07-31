// Sensible starting params when a resource is added to the cart.
import type { PricingDoc, Resource, Service } from "./types";
import { DEFAULT_HOURS } from "./compute";

let counter = 0;
const nextId = () => `r${++counter}`;

function firstKey(keys: string[], prefer: string): string {
  return keys.includes(prefer) ? prefer : (keys.slice().sort()[0] ?? "");
}

function pickEc2(p: PricingDoc): string {
  return firstKey(Object.keys(p.ec2.instances), "t3.micro");
}

function pickRds(p: PricingDoc): string {
  const keys = Object.keys(p.rds.instances);
  const pg = keys.filter((k) => k.startsWith("PostgreSQL|")).sort();
  return pg.find((k) => k.includes("db.t3.")) ?? pg[0] ?? firstKey(keys, "");
}

export function makeResource(service: Service, p: PricingDoc): Resource {
  const id = nextId();
  const name = "";
  if (service === "ec2")
    return {
      id, name, service,
      params: { instanceType: pickEc2(p), count: 1, hours: DEFAULT_HOURS,
                ebsType: firstKey(Object.keys(p.ebs), "gp3"), ebsGB: 0 },
    };
  if (service === "s3")
    return { id, name, service, params: { storageGB: 100, putCount: 100000, getCount: 1000000, dtoGB: 0 } };
  if (service === "rds")
    return {
      id, name, service,
      params: { instanceKey: pickRds(p), count: 1, hours: DEFAULT_HOURS,
                storageType: firstKey(Object.keys(p.rds.storage), "gp3"), storageGB: 20 },
    };
  if (service === "estimate")
    return { id, name, service, params: { category: "CloudFront", monthlyUSD: 10 } };
  return { id, name, service, params: { requests: 1000000, durationMs: 200, memoryMB: 512 } };
}
