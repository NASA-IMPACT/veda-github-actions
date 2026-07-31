#!/usr/bin/env python3
"""Diff two AWS pricing snapshots and write an impossible-to-miss change report.

Compares an OLD pricing_<region>.json against a NEW one, computes the % change of every price, and
writes a Markdown report (PRICING_CHANGES.md) plus a machine-readable summary. Any price that moves
more than --threshold percent (default 1%) is a **SPIKE** and is shouted at the top of the report
with 🚨 banners and giant headers so it's impossible to miss in a PR. Standard library only.

Used by the weekly "AWS pricing review" job (GitHub Action or a Jules scheduled task): fetch fresh
prices, diff against the committed snapshot, and open a PR whose body is this report.

  python aws-pricing/pricing_diff.py --old <snapshot.json> --new <fresh.json> \
    --out-md PRICING_CHANGES.md --out-summary summary.json [--threshold 1.0] [--demo-spike]

--demo-spike injects a synthetic +7.3% move into the NEW data so you can test the alert formatting
without waiting for a real price change.
"""
import argparse
import json
import sys


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def flatten(doc):
    """A pricing doc -> {human label: price} for every comparable price in it."""
    out = {}
    for t, i in doc.get("ec2", {}).get("instances", {}).items():
        out[f"EC2 · {t}"] = i.get("hourlyUSD")
    for t, v in doc.get("ebs", {}).items():
        out[f"EBS · {t} (GB-mo)"] = v
    s = doc.get("s3", {})
    if "standardStorageUsdPerGBMonth" in s:
        out["S3 · Standard storage (GB-mo)"] = s["standardStorageUsdPerGBMonth"]
        out["S3 · PUT (per 1k)"] = s.get("putPer1k")
        out["S3 · GET (per 1k)"] = s.get("getPer1k")
    for _, i in doc.get("rds", {}).get("instances", {}).items():
        out[f"RDS · {i.get('engine')} {i.get('instanceType')}"] = i.get("hourlyUSD")
    for t, v in doc.get("rds", {}).get("storage", {}).items():
        out[f"RDS storage · {t} (GB-mo)"] = v
    lam = doc.get("lambda", {})
    if "requestUsd" in lam:
        out["Lambda · request"] = lam["requestUsd"]
        out["Lambda · GB-second"] = lam.get("gbSecondUsd")
    return {k: v for k, v in out.items() if isinstance(v, (int, float))}


def fmt(v):
    """Money-ish formatting that keeps precision for tiny per-request rates."""
    if v is None:
        return "—"
    if v == 0:
        return "$0"
    if v >= 1:
        return f"${v:,.2f}"
    if v >= 0.01:
        return f"${v:.4f}".rstrip("0").rstrip(".")
    return f"${v:.3g}"


def diff(old, new, threshold):
    """Return (spikes, minor, added, removed) lists, each sorted by |%| descending."""
    fo, fn = flatten(old), flatten(new)
    spikes, minor, added, removed = [], [], [], []
    for key in sorted(set(fo) | set(fn)):
        o, n = fo.get(key), fn.get(key)
        if o is None:
            added.append((key, n))
            continue
        if n is None:
            removed.append((key, o))
            continue
        if o == n:
            continue
        pct = ((n - o) / o * 100) if o else float("inf")
        rec = {"key": key, "old": o, "new": n, "pct": pct}
        (spikes if abs(pct) > threshold else minor).append(rec)
    spikes.sort(key=lambda r: abs(r["pct"]), reverse=True)
    minor.sort(key=lambda r: abs(r["pct"]), reverse=True)
    return spikes, minor, added, removed


def arrow(pct):
    return "🔺" if pct > 0 else "🔻"


def row(r):
    return f"| {arrow(r['pct'])} | **{r['key']}** | {fmt(r['old'])} | {fmt(r['new'])} | **{r['pct']:+.2f}%** |"


def build_md(old, new, spikes, minor, added, removed, threshold):
    region = new.get("label", new.get("region", "?"))
    o_gen = (old.get("generated") or "?")[:10]
    n_gen = (new.get("generated") or "?")[:10]
    L = []
    if spikes:
        top = spikes[0]
        L += [
            "# 🚨🚨🚨 AWS PRICE SPIKE ALERT 🚨🚨🚨",
            "",
            f"## ‼️ {len(spikes)} price change(s) exceed the {threshold:g}% threshold — REVIEW BEFORE MERGING ‼️",
            "",
            f"> # {arrow(top['pct'])} BIGGEST MOVE: {top['key']} &nbsp; **{top['pct']:+.2f}%**",
            f"> ## {fmt(top['old'])} → {fmt(top['new'])}",
            "",
            "| | Item | Old | New | Change |",
            "|:--:|---|---:|---:|:--:|",
            *[row(r) for r in spikes],
            "",
            "---",
            "",
        ]
    elif minor or added or removed:
        L += [f"# ✅ Weekly AWS pricing update — no spikes over {threshold:g}%", ""]
    else:
        L += ["# ✅ Weekly AWS pricing update — no changes", ""]

    L += [f"**Region:** {region} · **Data:** {o_gen} → {n_gen}", ""]

    if minor:
        L += [
            f"<details{' open' if not spikes else ''}><summary>Other changes under {threshold:g}% "
            f"({len(minor)})</summary>",
            "",
            "| | Item | Old | New | Change |",
            "|:--:|---|---:|---:|:--:|",
            *[row(r) for r in minor],
            "",
            "</details>",
            "",
        ]
    if added:
        L += ["**Newly listed:** " + ", ".join(f"{k} ({fmt(v)})" for k, v in added), ""]
    if removed:
        L += ["**No longer listed:** " + ", ".join(f"{k} (was {fmt(v)})" for k, v in removed), ""]

    L += [
        "---",
        "_On-Demand list prices from AWS's public Price List Bulk API. Approximate — exclude Free "
        "Tier, Savings Plans/RIs, discounts, and taxes. Generated by `aws-pricing/pricing_diff.py`._",
    ]
    return "\n".join(L) + "\n"


def title(spikes, minor, added, removed, n_gen):
    date = (n_gen or "")[:10]
    if spikes:
        t = spikes[0]
        return f"🚨 AWS pricing SPIKE {t['pct']:+.1f}% ({t['key']}) — weekly review {date}"
    if minor or added or removed:
        return f"AWS weekly pricing update — {date} (no spikes)"
    return f"AWS weekly pricing — no changes {date}"


def demo_spike(new):
    """Inject a synthetic +7.3% EC2 move + a -4.2% Lambda move so the alert can be tested."""
    inst = new.get("ec2", {}).get("instances", {})
    if inst:
        k = sorted(inst)[0]
        inst[k]["hourlyUSD"] = round(inst[k]["hourlyUSD"] * 1.073, 6)
    lam = new.get("lambda", {})
    if "gbSecondUsd" in lam:
        lam["gbSecondUsd"] = round(lam["gbSecondUsd"] * 0.958, 10)
    return new


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", required=True, help="previous pricing_<region>.json (the committed snapshot)")
    ap.add_argument("--new", required=True, help="freshly generated pricing_<region>.json")
    ap.add_argument("--threshold", type=float, default=1.0, help="spike threshold in %% (default 1.0)")
    ap.add_argument("--out-md", default="PRICING_CHANGES.md")
    ap.add_argument("--out-summary", default="pricing_changes_summary.json")
    ap.add_argument("--demo-spike", action="store_true", help="inject a synthetic spike into --new (testing)")
    args = ap.parse_args()

    old, new = load(args.old), load(args.new)
    if args.demo_spike:
        new = demo_spike(new)

    spikes, minor, added, removed = diff(old, new, args.threshold)
    md = build_md(old, new, spikes, minor, added, removed, args.threshold)
    with open(args.out_md, "w", encoding="utf-8") as fh:
        fh.write(md)

    total = len(spikes) + len(minor) + len(added) + len(removed)
    top = spikes[0] if spikes else None
    summary = {
        "changed": total > 0,
        "spikes": len(spikes),
        "changes": total,
        "threshold": args.threshold,
        "max_pct": round(top["pct"], 3) if top else 0.0,
        "max_item": top["key"] if top else "",
        "title": title(spikes, minor, added, removed, new.get("generated", "")),
    }
    with open(args.out_summary, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    print(f"pricing-diff: {len(spikes)} spike(s) >{args.threshold:g}%, {len(minor)} minor, "
          f"{len(added)} added, {len(removed)} removed", file=sys.stderr)
    if top:
        print(f"  biggest: {top['key']} {top['pct']:+.2f}% ({fmt(top['old'])} → {fmt(top['new'])})", file=sys.stderr)


if __name__ == "__main__":
    main()
