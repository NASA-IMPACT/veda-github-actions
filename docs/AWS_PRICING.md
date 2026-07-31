# AWS Cost Calculator

A live calculator: add EC2 / S3 / RDS / Lambda resources, tune the inputs, get a monthly total.
**All prices come straight from AWS** — pulled from the public **Price List Bulk API** (no
credentials), published to a git branch, and read by a static dashboard that does the math
client-side. Every price links back to its AWS source.

```
AWS public bulk pricing  ──urllib, no creds──►  aws-pricing/generate_aws_pricing.py
        │                                              │ compact JSON
        ▼                                              ▼
.github/workflows/aws-pricing.yml  ──git push──►  branch aws-pricing/data  (index.json + pricing_<region>.json)
        │  schedule (Mon) + workflow_dispatch          │ runtime fetch
        ▼                                              ▼
                                          cost-dashboard/  (Vite/React SPA) → total + CSV export
```

## Why the bulk API (not the Query API)
AWS's targeted **Price List Query API** (`GetProducts`) needs signed IAM credentials + a backend.
This tool is credential-free by design, so it uses the **public bulk files** instead:
`…/offers/v1.0/aws/<OfferCode>/current/region_index.json` → per-**region** `index.json`
(`products` keyed by SKU + `terms.OnDemand` → `priceDimensions` → `pricePerUnit.USD`). Pricing is
On-Demand only. "Live" = refreshed weekly by the workflow (and on demand), not per-keystroke.

## Generator — `aws-pricing/generate_aws_pricing.py`
Standard-library Python 3.12 (`urllib` + `json`), no pip deps. For each region it fetches the four
per-region price files, filters to the standard On-Demand SKU, and writes `pricing_<region>.json`
plus an `index.json` manifest. The EC2 region file is ~473 MB, so it streams to a temp file,
`json.load`s once, filters, and releases before the next service (peak ~1.9 GB RAM, ~9 s/region).

### Exact filters (verified live; the offline test proves each decoy is rejected)
| Service | Keep when… | Rejects (decoys) |
|---|---|---|
| **EC2** | `productFamily=Compute Instance`, `operatingSystem=Linux`, `tenancy=Shared`, `preInstalledSw=NA`, `capacitystatus=Used`, `licenseModel=No License required` | `UnusedCapacityReservation`, Windows/RHEL, `Compute Instance (bare metal)` |
| **EBS** | `productFamily=Storage`, keyed by `volumeApiName` (gp3/gp2/io1/…) | unit is `GB-Mo` **or** `GB-month` (io2) |
| **S3** | storage `Storage`/`General Purpose`/`volumeType=Standard`; requests `API Request` group `S3-API-Tier1`/`Tier2` | `volumeType=Annotations`, `*Annotation*` request rows |
| **RDS** | `Database Instance`, `Single-AZ`, `licenseModel=No license required` (lowercase l; falls back to `License included` for SQL Server/Oracle); storage `Database Storage`/`Single-AZ` (gp2/gp3/io1/io2/magnetic) | `Multi-AZ`, Outpost / on-premise engines, Aurora/consumption storage rows |
| **Lambda** | `Serverless`, group `AWS-Lambda-Requests` / `AWS-Lambda-Duration`, non-zero region row, first duration tier | `Global-*` $0 free-tier rows, ARM / Provisioned / Edge / MicroVM / … |

> **S3 data-transfer-out** reads $0 in the S3 file (the real tiered rate lives in the
> `AWSDataTransfer` offer, first GB free), so it's emitted as a documented **static fallback**
> (`0.09`, `dataTransferOutSource: "static-fallback"`) and flagged in the UI.

### Output schema
`pricing_<region>.json`: `ec2.instances{type:{vcpu,memoryGiB,hourlyUSD}}`, `ebs{type:usdPerGBMo}`,
`s3{standardStorageUsdPerGBMonth,putPer1k,getPer1k,dataTransferOutUsdPerGB,dataTransferOutSource}`,
`rds{instances{"engine|type":{hourlyUSD,engine,instanceType}},storage{type:usdPerGBMo}}`,
`lambda{requestUsd,gbSecondUsd}`, plus `sources` (AWS pricing-page + raw price-list URLs + version)
and `sourceVersions`. `index.json`: `{defaultRegion, hoursPerMonth:730, regions{code:{file,label,sourceVersions}}}`.

## Compute formulas (client-side, monthly; `HOURS_PER_MONTH = 730`)
- **EC2** `hourlyUSD × hours × count (+ ebsGB × ebs[type])`
- **S3** `storageGB × storage + (put/1000)×putPer1k + (get/1000)×getPer1k + dtoGB × dtoRate`
- **RDS** `hourlyUSD × hours × count + storageGB × rds.storage[type]`
- **Lambda** `requests × requestUsd + requests × (durationMs/1000) × (memoryMB/1024) × gbSecondUsd`

Hours hint: **720 = 30-day month · 730 = AWS's average-month convention.**

## Run / test
```bash
# Offline golden test (no network — proves filters keep real SKUs, reject decoys):
python3 aws-pricing/test_generate.py

# Live pull (public, no creds) for one or more regions:
python3 aws-pricing/generate_aws_pricing.py --region us-west-2 --out-dir reports --now "$(date -u +%FT%TZ)"

# Rebuild index.json from existing region files (what the workflow does after accumulating):
python3 aws-pricing/generate_aws_pricing.py --reindex-only reports

# Dashboard:
cd cost-dashboard && npm install && npm run dev     # or: npm run build
```
Add regions per-run via the workflow's `regions` input (comma-separated) or `--region a,b`. Regions
**accumulate** on `aws-pricing/data`: re-running a region overwrites its file; a new region adds one.

## Dashboard — `cost-dashboard/` (Pattern B Netlify site)
Vite/React SPA. Fetches `index.json` + `pricing_<region>.json` at runtime from `aws-pricing/data`
(via the commit-SHA raw URL to dodge the ~5 min CDN cache), falling back to the branch path, then the
bundled `public/data/` snapshot (badge shows **live** vs **snapshot**). Features: a "resource cart"
with a per-resource **name** ("Disasters Hub API"), live per-card + **grand total** (monthly & annual),
region selector, a single **Download / Save** menu (CSV / HTML / Markdown, plus **Save HTML or
Markdown → GitHub** which opens a prefilled new-file editor targeting the single `cost-reports/`
directory — you name the report; same prefilled-PR idea as leave-dashboard), a **"prices are
approximate"** notice, an in-app **"How to refresh prices"** guide (links the workflow), and a
"Where these prices come from" panel hyperlinking every service to its AWS pricing page + raw price
list + version.

Connect a Netlify site with **base directory `cost-dashboard`** (it reads `cost-dashboard/netlify.toml`;
there is no root `netlify.toml` — Pattern B).

## Caveats
On-Demand list prices only — **excludes** Free Tier, Savings Plans / Reserved Instances, volume &
EDP/PPA discounts, and taxes. It's an estimate, not a bill. If AWS renames an attribute, the offline
golden test drifts (guardrail) and the live smoke test catches empty-result regressions.

## Key files
`aws-pricing/generate_aws_pricing.py`, `aws-pricing/test_generate.py`, `aws-pricing/seed/*`,
`.github/workflows/aws-pricing.yml`, `cost-dashboard/src/{data,compute,export,report,defaults}.ts`,
`cost-dashboard/src/components/{ResourceCard,SourcePanel}.tsx`, `cost-dashboard/netlify.toml`,
`cost-reports/` (saved estimates land here).
