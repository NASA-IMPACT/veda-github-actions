# AWS Cost Estimate — spreadsheet vs. the aws-cost app

**Ticket:** [#221 — AWS Cost Estimate from Alexandra](https://github.com/NASA-IMPACT/veda-github-actions/issues/221)
**Source estimate:** *Disasters API and Infra Cost Estimates 26.4* (the Google Sheet linked in #221; analyzed
from the `.xlsx` export — sheets **APIs, RDS, SM2A, Cumulative**).
**Compared against:** the [`cost-dashboard/`](../cost-dashboard/) AWS cost calculator
([`compute.ts`](../cost-dashboard/src/compute.ts), [`types.ts`](../cost-dashboard/src/types.ts)) using the
committed `us-west-2` pricing snapshot.

## TL;DR

Where the two overlap — **RDS instances** and **Lambda-as-API** — they share the same **On‑Demand** model, and
the app reproduces the spreadsheet's bare instance rates **exactly** for 2 of 3 RDS rows. They diverge in
**scope** and in **three specific figures**. The spreadsheet is a **project-specific planning doc** (Disasters
APIs + infra for PI 26.4) with dataset-scaling, scenario rollups, and cost-allocation judgment calls; the app is
a **generic per-resource On‑Demand calculator**.

## What each covers

| Cost area | Spreadsheet | aws-cost app | Overlap |
|---|---|---|---|
| **RDS** (PostgreSQL instances) | RDS sheet + parts of SM2A/Cumulative | ✅ `rds` service | ✅ yes |
| **Lambda** (STAC / Raster APIs) | APIs sheet | ✅ `lambda` service | ✅ yes (same model) |
| **ECS** (containers) | ✅ core of SM2A (`$215.85/mo`) | ❌ **no service** | ❌ **gap** |
| **EC2 + EBS** | ❌ none | ✅ `ec2` + EBS | ❌ app-only |
| **S3** (object storage) | ❌ none | ✅ `s3` | ❌ app-only |

The app supports only `Service = "ec2" | "s3" | "rds" | "lambda"`
([types.ts:70](../cost-dashboard/src/types.ts#L70)) — no ECS/Fargate, MWAA/Airflow, or API Gateway anywhere in
the app or the pricing generator.

## Where the numbers AGREE

Verified against `cost-dashboard/public/data/pricing_us-west-2.json` (hourly × 730 h/mo):

| Instance | Sheet $/mo | App $/mo | Match |
|---|---|---|---|
| `db.t3.small` | **26.28** | **26.28** ($0.036/hr) | ✅ exact |
| `db.r5.large` | **182.50** | **182.50** ($0.25/hr) | ✅ exact |

Both are **On‑Demand only**, both show **Monthly + Yearly** (sheet uses `=C*12`; app shows monthly & annual),
and both cite **calculator.aws**. The exact match confirms they sit on the **same price basis**.

## The 3 major numeric divergences

### 1. `db.t4g.medium` — sheet `$138.92/mo` vs app `$47.45/mo` (~2.9×)
The "sm2a airflow db" row (and the SM2A/Cumulative sheets) use `$138.92`, but the app's bare On‑Demand instance
rate is `$0.065/hr → $47.45/mo`. The 2.9× gap indicates the sheet's figure **bundles Multi‑AZ and/or
storage/backup/IOPS** into one number, whereas the app prices the *instance-hours* on that line and itemizes
storage separately ([compute.ts:63‑78](../cost-dashboard/src/compute.ts#L63)). It is also **internally
inconsistent within the spreadsheet** — its other two RDS rows are bare instance rates; this one is not.

### 2. Lambda absolute cost — sheet is ~8–25× the app for the same invocations/duration
The APIs sheet omits **memory (GB)**, which the app's Lambda formula requires
(`requests × (durMs/1000) × (memMB/1024) × gbSecondUsd`,
[compute.ts:82‑93](../cost-dashboard/src/compute.ts#L82)):

| API @10 datasets | Sheet | App @512 MB | App @1024 MB | App @~8 GB |
|---|---|---|---|---|
| STAC (20k inv, 200 ms) | **$1.00** | $0.04 | $0.07 | — |
| Raster (1.2M inv, 300 ms) | **$50.00** | $3.24 | $6.24 | ~$50 |

Same underlying model, but the sheet's numbers are **pre-baked from the AWS Lambda calculator** with a memory
assumption (~8 GB to reach $50 for Raster) and likely **API Gateway + rounding** (STAC's flat `$1.00` reads as a
floor, not a computed Lambda cost). The app reproduces them only if memory is set explicitly — it can't infer it.

### 3. ECS / SM2A is un-modelable in the app
`SM2A = 2/3 × ECS ($215.85) + db.t4g.medium ($138.92) = $282.82/mo` (SM2A sheet). The **dominant component is
ECS container cost**, for which the app has **no service**. So the SM2A line — and the "t3.small+SM2A" /
"r5.large+SM2A" scenarios on the Cumulative sheet — **cannot be built in the app today**.

## Structural differences (modeling philosophy)

| | Spreadsheet | aws-cost app |
|---|---|---|
| **Scaling** | Cost as a function of **# of datasets** (10/30/50/100); invocations `=B$6/10*A7` | Flat per-resource; no dataset/scaling concept |
| **Scenarios** | Named **what-if rollups** (Cumulative: option A vs B) | Single cart → one grand total |
| **Allocation** | Judgment heuristics ("2/3 of ECS"; "can't exceed cumulative because **untagged**") | None — exact params only |
| **Benchmarking** | "Using **ghgc STAC** catalog access patterns" | None |
| **Provenance** | **Hand-entered** from calculator.aws (RDS $, Lambda $ hardcoded) | **Live** AWS Price List Bulk API + transparent per-line formulas |
| **Output** | 4 Excel sheets | Live cards + monthly/annual + **CSV export**, 3 regions |

## Implications

- **The estimates are trustworthy where they overlap.** The app corroborates the spreadsheet's On‑Demand RDS
  rates exactly, so the RDS line items in Alexandra's estimate are sound.
- **`db.t4g.medium = $138.92` should be read as an all-in DB figure** (Multi‑AZ/storage), not a bare instance
  rate. If the intent was bare instance-hours, it is ~2.9× too high; if it's an all-in prod DB, it's reasonable
  but not comparable to the app's per-line instance rate.
- **The single biggest cost driver (ECS in SM2A) is invisible to the app.** Any "full picture" total from the
  app will understate real Disasters infra until ECS/Fargate is added.
- **Lambda-as-API totals aren't apples-to-apples** without capturing memory (and API Gateway). The sheet's
  numbers are defensible calculator outputs; the app's are transparent but need the missing inputs.

## Future work

To let the app reproduce (and eventually supersede) this spreadsheet, in priority order:

1. **ECS / Fargate service** — the largest modeling gap (SM2A is mostly ECS).
2. **RDS Multi‑AZ toggle** — reconciles the `db.t4g.medium` $138.92 vs $47.45 gap.
3. **API Gateway line on Lambda** + surface **memory (GB)** prominently so API estimates match calculator.aws.
4. **Lightweight "estimated" line items** for supporting services that are small but real —
   **CloudFront, Amplify, Secrets Manager**, etc. — as compact, editable flat contributions to the grand total
   so the app reflects the *full* monthly picture without a full pricing integration per service.
5. Optional: **scenario rollups** and **dataset-scaling** so the app can express the same what-if planning the
   spreadsheet does.

---
*Method: the `.xlsx` was parsed with Python stdlib (`zipfile` + `xml.etree`) — values, shared strings, and
formulas extracted per sheet — then compared cell-by-cell against the app's cost formulas and committed pricing
snapshot.*
