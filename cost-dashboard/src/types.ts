// Data models — mirror aws-pricing/generate_aws_pricing.py output.

export interface Ec2Instance {
  vcpu: number | null;
  memoryGiB: number | null;
  hourlyUSD: number;
}

export interface RdsInstance {
  hourlyUSD: number;
  engine: string;
  instanceType: string;
}

export interface ServiceSource {
  offerCode: string;
  priceListUrl: string;
  pricingPage: string;
  version: string;
}

export interface Sources {
  bulkApiDoc: string;
  services: Record<Service, ServiceSource>;
}

export interface PricingDoc {
  region: string;
  label: string;
  generated: string;
  currency: string;
  sourceVersions: Record<Service, string>;
  sources: Sources;
  ec2: { instances: Record<string, Ec2Instance> };
  ebs: Record<string, number>;
  s3: {
    standardStorageUsdPerGBMonth: number;
    putPer1k: number;
    getPer1k: number;
    dataTransferOutUsdPerGB: number;
    dataTransferOutSource: string;
  };
  rds: { instances: Record<string, RdsInstance>; storage: Record<string, number> };
  lambda: { requestUsd: number; gbSecondUsd: number };
}

export interface RegionEntry {
  file: string;
  label: string;
  generated: string;
  sourceVersions: Record<Service, string>;
}

export interface IndexDoc {
  generated: string;
  schemaVersion: number;
  defaultRegion: string;
  hoursPerMonth: number;
  regions: Record<string, RegionEntry>;
}

export interface Dataset {
  source: "live" | "snapshot";
  index: IndexDoc;
  pricing: PricingDoc;
}

// ---- the "resource cart" (what the user builds) ----

export type Service = "ec2" | "s3" | "rds" | "lambda";

export interface Ec2Params {
  instanceType: string;
  count: number;
  hours: number;
  ebsType: string;
  ebsGB: number;
}
export interface S3Params {
  storageGB: number;
  putCount: number;
  getCount: number;
  dtoGB: number;
}
export interface RdsParams {
  instanceKey: string; // "engine|instanceType"
  count: number;
  hours: number;
  storageType: string;
  storageGB: number;
}
export interface LambdaParams {
  requests: number;
  durationMs: number;
  memoryMB: number;
}

// `name` is a user label so a cart with several EC2s stays legible ("Disasters Hub API", "worker").
export type Resource =
  | { id: string; name: string; service: "ec2"; params: Ec2Params }
  | { id: string; name: string; service: "s3"; params: S3Params }
  | { id: string; name: string; service: "rds"; params: RdsParams }
  | { id: string; name: string; service: "lambda"; params: LambdaParams };

export interface LineItem {
  label: string;
  amount: number;
}
export interface Cost {
  monthly: number;
  breakdown: LineItem[];
  note?: string;
}
