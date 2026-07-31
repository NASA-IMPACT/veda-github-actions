#!/usr/bin/env python3
"""Pull AWS **On-Demand** list prices from the PUBLIC Price List Bulk API and emit compact JSON
for the cost-dashboard calculator. Standard library only (`urllib` + `json`) — no `boto3`, no
`requests`, no pip deps, and **no AWS credentials** (the bulk files are public).

Data flow (per region, per service):
  offers/v1.0/aws/<OfferCode>/current/region_index.json   -> regions[<region>].currentVersionUrl
  offers/v1.0/aws/<OfferCode>/<ver>/<region>/index.json    -> {products{SKU:{productFamily,attributes}},
                                                               terms.OnDemand{SKU:{term:{priceDimensions}}}}
We filter each service down to the single standard On-Demand SKU a calculator needs, then write:

  pricing_<region>.json   all four services for one region (schema in write_region)
  index.json              manifest of every pricing_<region>.json in --out-dir (region selector + freshness)

Services + the EXACT attribute filters (verified live against us-west-2, incl. the decoy SKUs we reject):
  EC2 compute  productFamily "Compute Instance", operatingSystem Linux, tenancy Shared,
               preInstalledSw NA, capacitystatus Used (rejects *CapacityReservation), licenseModel
               "No License required" (capital L). Rate = OnDemand unit "Hrs".
  EBS          productFamily "Storage" (in the EC2 offer), keyed by volumeApiName (gp3/gp2/io1/...),
               unit "GB-Mo" or "GB-month".
  S3           storage: productFamily "Storage", storageClass "General Purpose", volumeType "Standard"
               (rejects volumeType "Annotations"); requests: productFamily "API Request",
               group "S3-API-Tier1"/"Tier2" (rejects *Annotation* rows). Data-transfer-out is $0 in
               the S3 file (real DTO lives in AWSDataTransfer, first GB free) -> documented static fallback.
  RDS          instance: productFamily "Database Instance", deploymentOption "Single-AZ", licenseModel
               "No license required" (lowercase l — differs from EC2; falls back to "License included"
               for SQL Server/Oracle). Keyed engine|instanceType. storage: productFamily "Database Storage".
  Lambda       productFamily "Serverless", group "AWS-Lambda-Requests" / "AWS-Lambda-Duration"; take the
               non-zero region row (rejects the $0 Global free-tier decoys) and first duration tier;
               exclude ARM/Provisioned/Edge/MicroVM/... variants -> standard x86 request + GB-second.

Inputs:
  --region us-west-2[,us-east-1]   region(s) to pull (repeatable or comma-separated)
Offline (no network — for tests, mirrors the other generators' offline modes):
  --sample-dir DIR                 read DIR/sample_<ec2|s3|rds|lambda>_region.json instead of fetching
  --offer-file AmazonEC2=PATH      point one offer at a local per-region index.json (repeatable)
  --reindex-only DIR               don't fetch anything; just rebuild DIR/index.json from its pricing_*.json
"""
import argparse
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request

BASE = "https://pricing.us-east-1.amazonaws.com"

# offer code per service + the sample-fixture basename used by --sample-dir.
OFFERS = {
    "ec2": {"code": "AmazonEC2", "sample": "sample_ec2_region.json"},
    "s3": {"code": "AmazonS3", "sample": "sample_s3_region.json"},
    "rds": {"code": "AmazonRDS", "sample": "sample_rds_region.json"},
    "lambda": {"code": "AWSLambda", "sample": "sample_lambda_region.json"},
}

REGION_LABELS = {
    "us-east-1": "US East (N. Virginia)", "us-east-2": "US East (Ohio)",
    "us-west-1": "US West (N. California)", "us-west-2": "US West (Oregon)",
    "eu-west-1": "EU (Ireland)", "eu-west-2": "EU (London)", "eu-west-3": "EU (Paris)",
    "eu-central-1": "EU (Frankfurt)", "eu-north-1": "EU (Stockholm)",
    "ca-central-1": "Canada (Central)", "sa-east-1": "South America (Sao Paulo)",
    "ap-south-1": "Asia Pacific (Mumbai)", "ap-northeast-1": "Asia Pacific (Tokyo)",
    "ap-northeast-2": "Asia Pacific (Seoul)", "ap-southeast-1": "Asia Pacific (Singapore)",
    "ap-southeast-2": "Asia Pacific (Sydney)",
}

# RDS reports storage by display name; normalize to the same short keys EBS uses.
RDS_STORAGE_KEY = {
    "General Purpose": "gp2", "General Purpose-GP3": "gp3",
    "Provisioned IOPS": "io1", "Provisioned IOPS-IO2": "io2", "Magnetic": "magnetic",
}

# Lambda usagetype fragments that are NOT the standard x86 request/duration product.
LAMBDA_EXCLUDE = ("Global", "ARM", "Provisioned", "Edge", "MicroVM", "Managed",
                  "Storage", "Ephemeral", "Snap")

DTO_FALLBACK_USD = 0.09  # S3 data-transfer-out static fallback (see module docstring).

# Human-facing AWS pricing pages, surfaced in the dashboard so users can see where prices come from.
PRICING_PAGES = {
    "ec2": "https://aws.amazon.com/ec2/pricing/on-demand/",
    "s3": "https://aws.amazon.com/s3/pricing/",
    "rds": "https://aws.amazon.com/rds/pricing/",
    "lambda": "https://aws.amazon.com/lambda/pricing/",
}
BULK_API_DOC = "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api.html"


def region_index_url(offer_code):
    """The stable (non-timestamped) public bulk-file URL a price was sourced from."""
    return f"{BASE}/offers/v1.0/aws/{offer_code}/current/region_index.json"


# ---------------------------------------------------------------- fetch (public, no auth)

def http_get(url, retries=5, timeout=300):
    """GET a URL, retrying transient network/5xx errors with backoff. Returns raw bytes.

    Mirrors the retrying wrapper the other generators use for `gh`, but for plain public HTTP."""
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "veda-aws-pricing/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last = e
            code = getattr(e, "code", None)
            transient = code in (429, 500, 502, 503, 504) or code is None
            if transient and attempt < retries:
                time.sleep(2 * attempt)
                continue
            raise RuntimeError(f"GET {url}: {e}") from e
    raise RuntimeError(f"GET {url}: exhausted retries ({last})")


def region_file_url(offer_code, region):
    """Resolve the per-region price-file URL via the (small) region_index.json."""
    idx = json.loads(http_get(f"{BASE}/offers/v1.0/aws/{offer_code}/current/region_index.json"))
    entry = idx.get("regions", {}).get(region)
    if not entry or not entry.get("currentVersionUrl"):
        raise RuntimeError(f"{offer_code}: region {region} not in region_index.json")
    return BASE + entry["currentVersionUrl"]


def load_region_data(offer_key, region, offer_files, sample_dir):
    """Return the parsed per-region price file for one service.

    Offline precedence: --offer-file override, then --sample-dir fixture; otherwise fetch live.
    The EC2 file is ~473 MB, so live fetches stream to a temp file and json.load once (never holds
    the raw bytes and the parsed dict at the same time)."""
    code = OFFERS[offer_key]["code"]
    local = offer_files.get(code)
    if not local and sample_dir:
        local = os.path.join(sample_dir, OFFERS[offer_key]["sample"])
    if local:
        with open(local, encoding="utf-8") as fh:
            return json.load(fh)

    url = region_file_url(code, region)
    tmp = tempfile.NamedTemporaryFile(prefix="awsprice_", suffix=".json", delete=False)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "veda-aws-pricing/1.0"})
        with urllib.request.urlopen(req, timeout=300) as r:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                tmp.write(chunk)
        tmp.close()
        with open(tmp.name, encoding="utf-8") as fh:
            return json.load(fh)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


# ---------------------------------------------------------------- price-dimension helpers

def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def ondemand_dims(terms, sku):
    """Yield every On-Demand priceDimension dict for one SKU."""
    for term in terms.get("OnDemand", {}).get(sku, {}).values():
        for dim in term.get("priceDimensions", {}).values():
            yield dim


def first_tier_usd(terms, sku, unit=None, nonzero=False):
    """Lowest-beginRange USD rate for a SKU (the price a fresh account pays first).

    `unit` filters by measurement unit (e.g. "Hrs"); `nonzero` drops $0 rows (Lambda free tier)."""
    candidates = []
    for dim in ondemand_dims(terms, sku):
        if unit and dim.get("unit", "").lower() != unit.lower():
            continue
        usd = to_float(dim.get("pricePerUnit", {}).get("USD"))
        if usd is None or (nonzero and usd == 0.0):
            continue
        begin = to_float(dim.get("beginRange")) or 0.0
        candidates.append((begin, usd))
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][1]


# ---------------------------------------------------------------- per-service extraction

def parse_ec2(data):
    products, terms = data.get("products", {}), data.get("terms", {})
    instances, ebs = {}, {}
    for sku, prod in products.items():
        a = prod.get("attributes", {})
        fam = prod.get("productFamily")
        if fam == "Compute Instance":
            if (a.get("operatingSystem") == "Linux" and a.get("tenancy") == "Shared"
                    and a.get("preInstalledSw") == "NA" and a.get("capacitystatus") == "Used"
                    and a.get("licenseModel") == "No License required"):
                itype = a.get("instanceType")
                rate = first_tier_usd(terms, sku, unit="Hrs")
                if itype and rate is not None:
                    instances[itype] = {"vcpu": to_int(a.get("vcpu")),
                                        "memoryGiB": mem_gib(a.get("memory")),
                                        "hourlyUSD": rate}
        elif fam == "Storage":
            vt = a.get("volumeApiName")
            rate = first_tier_usd(terms, sku)
            if vt and rate is not None:
                ebs[vt] = rate
    return {"instances": dict(sorted(instances.items()))}, dict(sorted(ebs.items()))


def parse_s3(data):
    products, terms = data.get("products", {}), data.get("terms", {})
    storage = put = get = None
    for sku, prod in products.items():
        a = prod.get("attributes", {})
        fam = prod.get("productFamily")
        if fam == "Storage" and a.get("storageClass") == "General Purpose" \
                and a.get("volumeType") == "Standard":
            storage = first_tier_usd(terms, sku, unit="GB-Mo")
        elif fam == "API Request":
            group = a.get("group", "")
            if "Annotation" in group or "Annotation" in a.get("groupDescription", ""):
                continue
            rate = first_tier_usd(terms, sku)
            if rate is None:
                continue
            if group == "S3-API-Tier1":
                put = rate
            elif group == "S3-API-Tier2":
                get = rate
    return {
        "standardStorageUsdPerGBMonth": storage,
        "putPer1k": round(put * 1000, 8) if put is not None else None,
        "getPer1k": round(get * 1000, 8) if get is not None else None,
        "dataTransferOutUsdPerGB": DTO_FALLBACK_USD,
        "dataTransferOutSource": "static-fallback",
    }


def parse_rds(data):
    products, terms = data.get("products", {}), data.get("terms", {})
    # engine|instanceType -> (licenseModel, rate); prefer "No license required" when both exist.
    picked = {}
    storage = {}
    for sku, prod in products.items():
        a = prod.get("attributes", {})
        fam = prod.get("productFamily")
        if fam == "Database Instance" and a.get("deploymentOption") == "Single-AZ":
            lic = a.get("licenseModel")
            if lic not in ("No license required", "License included"):
                continue
            engine, itype = a.get("databaseEngine"), a.get("instanceType")
            # Skip Outpost / on-premise engine variants — niche, differently priced, clutter the UI.
            if not engine or not itype or "Outpost" in engine or "on-premise" in engine.lower():
                continue
            rate = first_tier_usd(terms, sku, unit="Hrs")
            if rate is None:
                continue
            key = f"{engine}|{itype}"
            prev = picked.get(key)
            if prev is None or (prev[0] == "License included" and lic == "No license required"):
                picked[key] = (lic, {"hourlyUSD": rate, "engine": engine, "instanceType": itype})
        elif fam == "Database Storage" and a.get("deploymentOption") == "Single-AZ":
            # Only the standard provisioned volume types the calculator offers; drop Aurora/consumption
            # storage (priced differently, and some rows are $0 in the file) and any unmapped names.
            vt = a.get("volumeType")
            rate = first_tier_usd(terms, sku)
            if vt in RDS_STORAGE_KEY and rate is not None:
                storage[RDS_STORAGE_KEY[vt]] = rate
    instances = {k: v for k, (_, v) in sorted(picked.items())}
    return {"instances": instances, "storage": dict(sorted(storage.items()))}


def parse_lambda(data):
    products, terms = data.get("products", {}), data.get("terms", {})

    def pick(group):
        best = None  # lowest first-tier non-zero rate among the standard x86 rows
        for sku, prod in products.items():
            a = prod.get("attributes", {})
            if prod.get("productFamily") != "Serverless" or a.get("group") != group:
                continue
            if any(x in a.get("usagetype", "") for x in LAMBDA_EXCLUDE):
                continue
            rate = first_tier_usd(terms, sku, nonzero=True)
            if rate is not None and (best is None or rate < best):
                best = rate
        return best

    return {"requestUsd": pick("AWS-Lambda-Requests"), "gbSecondUsd": pick("AWS-Lambda-Duration")}


# ---------------------------------------------------------------- small parsers

def to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def mem_gib(v):
    """'8 GiB' -> 8.0."""
    if not v:
        return None
    return to_float(str(v).replace("GiB", "").replace(",", "").strip())


# ---------------------------------------------------------------- emit

def build_region(region, offer_files, sample_dir, now):
    """Extract all four services for one region into the compact pricing_<region>.json shape."""
    versions = {}
    per = {}
    for key, parser in (("ec2", parse_ec2), ("s3", parse_s3),
                        ("rds", parse_rds), ("lambda", parse_lambda)):
        data = load_region_data(key, region, offer_files, sample_dir)
        versions[key] = data.get("version") or data.get("publicationDate") or "unknown"
        per[key] = parser(data)
        del data  # release the (large, for EC2) parsed dict before the next service
    ec2, ebs = per["ec2"]
    # Provenance so the dashboard can hyperlink every number back to its AWS source.
    sources = {"bulkApiDoc": BULK_API_DOC, "services": {}}
    for key in ("ec2", "s3", "rds", "lambda"):
        sources["services"][key] = {
            "offerCode": OFFERS[key]["code"],
            "priceListUrl": region_index_url(OFFERS[key]["code"]),
            "pricingPage": PRICING_PAGES[key],
            "version": versions[key],
        }
    return {
        "region": region, "label": REGION_LABELS.get(region, region),
        "generated": now, "currency": "USD", "sourceVersions": versions, "sources": sources,
        "ec2": ec2, "ebs": ebs, "s3": per["s3"], "rds": per["rds"], "lambda": per["lambda"],
    }


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, sort_keys=True, ensure_ascii=False)
        fh.write("\n")


def rebuild_index(out_dir, now, default_region):
    """(Re)write index.json from every pricing_<region>.json present in out_dir."""
    regions = {}
    for fn in sorted(os.listdir(out_dir)):
        if not (fn.startswith("pricing_") and fn.endswith(".json")):
            continue
        with open(os.path.join(out_dir, fn), encoding="utf-8") as fh:
            doc = json.load(fh)
        regions[doc["region"]] = {"file": fn, "label": doc.get("label", doc["region"]),
                                  "generated": doc.get("generated", "unknown"),
                                  "sourceVersions": doc.get("sourceVersions", {})}
    if default_region not in regions and regions:
        default_region = sorted(regions)[0]
    index = {"generated": now, "schemaVersion": 1, "defaultRegion": default_region,
             "hoursPerMonth": 730, "regions": regions}
    write_json(os.path.join(out_dir, "index.json"), index)
    return index


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", action="append", default=[],
                    help="region(s) to pull; repeatable or comma-separated (default us-west-2)")
    ap.add_argument("--out-dir", default="reports")
    ap.add_argument("--now", default="unknown", help="ISO timestamp stamped into outputs")
    ap.add_argument("--sample-dir", help="offline: read sample_<svc>_region.json fixtures, no network")
    ap.add_argument("--offer-file", action="append", default=[], metavar="CODE=PATH",
                    help="offline: point one offer (e.g. AmazonEC2) at a local per-region file")
    ap.add_argument("--reindex-only", metavar="DIR",
                    help="no fetch: rebuild DIR/index.json from its pricing_*.json and exit")
    args = ap.parse_args()

    if args.reindex_only:
        idx = rebuild_index(args.reindex_only, args.now, "us-west-2")
        print(f"aws-pricing: reindexed {len(idx['regions'])} region(s) in {args.reindex_only}",
              file=sys.stderr)
        return

    regions = [r.strip() for spec in args.region for r in spec.split(",") if r.strip()] or ["us-west-2"]
    offer_files = dict(kv.split("=", 1) for kv in args.offer_file)
    os.makedirs(args.out_dir, exist_ok=True)

    for region in regions:
        doc = build_region(region, offer_files, args.sample_dir, args.now)
        write_json(os.path.join(args.out_dir, f"pricing_{region}.json"), doc)
        print(f"aws-pricing: {region} — {len(doc['ec2']['instances'])} EC2 types, "
              f"{len(doc['rds']['instances'])} RDS, lambda gb-s={doc['lambda']['gbSecondUsd']}, "
              f"s3 ${doc['s3']['standardStorageUsdPerGBMonth']}/GB-mo", file=sys.stderr)

    rebuild_index(args.out_dir, args.now, regions[0])


if __name__ == "__main__":
    main()
