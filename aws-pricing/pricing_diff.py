#!/usr/bin/env python3
"""Diff AWS pricing snapshots and write an impossible-to-miss change report.

Compares OLD prices against NEW ones, computes the % change of every price, and writes a Markdown
report (PRICING_CHANGES.md) plus a machine-readable summary. Any price that moves more than
--threshold percent (default 1%) is a **SPIKE** and is shouted at the top with 🚨 banners and giant
headers so it's impossible to miss in a PR. Standard library only.

Two modes:
  • single region:  --old <snapshot.json> --new <fresh.json>
  • many regions:   --regions us-east-1,us-west-2,eu-west-1 --old-dir <dir> --new-dir <dir>
                    (reads pricing_<region>.json from each dir; a missing OLD = a new baseline)

--demo-spike injects a synthetic +7.3% / -4.2% move into the (first) NEW snapshot so you can test the
alert formatting without waiting for a real price change.
"""
import argparse
import json
import os
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
    """Return (spikes, minor, added, removed), each sorted by |%| descending."""
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


TABLE_HEAD = ["| | Item | Old | New | Change |", "|:--:|---|---:|---:|:--:|"]


def diff_pair(label, old, new, threshold):
    """Diff one region -> a result dict (old may be None = first baseline)."""
    if old is None:
        return {"label": label, "o_gen": "—", "n_gen": (new.get("generated") or "?")[:10],
                "spikes": [], "minor": [], "added": [], "removed": [], "new_baseline": True}
    spikes, minor, added, removed = diff(old, new, threshold)
    return {"label": label, "o_gen": (old.get("generated") or "?")[:10],
            "n_gen": (new.get("generated") or "?")[:10],
            "spikes": spikes, "minor": minor, "added": added, "removed": removed,
            "new_baseline": False}


def region_block(reg, threshold):
    if reg["new_baseline"]:
        return [f"## {reg['label']} — 🆕 new baseline saved (nothing to compare yet)", ""]
    if not (reg["spikes"] or reg["minor"] or reg["added"] or reg["removed"]):
        return [f"## {reg['label']} — ✅ no changes ({reg['o_gen']} → {reg['n_gen']})", ""]
    L = [f"## {reg['label']} · {reg['o_gen']} → {reg['n_gen']}", ""]
    if reg["spikes"]:
        L += [f"**🚨 {len(reg['spikes'])} spike(s) over {threshold:g}%:**", *TABLE_HEAD,
              *[row(r) for r in reg["spikes"]], ""]
    if reg["minor"]:
        L += [f"<details><summary>{len(reg['minor'])} change(s) under {threshold:g}%</summary>", "",
              *TABLE_HEAD, *[row(r) for r in reg["minor"]], "", "</details>", ""]
    if reg["added"]:
        L += ["Newly listed: " + ", ".join(f"{k} ({fmt(v)})" for k, v in reg["added"]), ""]
    if reg["removed"]:
        L += ["No longer listed: " + ", ".join(f"{k} (was {fmt(v)})" for k, v in reg["removed"]), ""]
    return L


def all_spikes(regions):
    return sorted(((r["label"], s) for r in regions for s in r["spikes"]),
                  key=lambda x: abs(x[1]["pct"]), reverse=True)


def changed(regions):
    return any(r["new_baseline"] or r["spikes"] or r["minor"] or r["added"] or r["removed"]
               for r in regions)


def build_md(regions, threshold):
    sp = all_spikes(regions)
    L = []
    if sp:
        lbl, top = sp[0]
        nregs = len({l for l, _ in sp})
        L += [
            "# 🚨🚨🚨 AWS PRICE SPIKE ALERT 🚨🚨🚨", "",
            f"## ‼️ {len(sp)} price change(s) over {threshold:g}% across {nregs} region(s) — "
            "REVIEW BEFORE MERGING ‼️", "",
            f"> # {arrow(top['pct'])} BIGGEST MOVE: {top['key']} ({lbl}) &nbsp; **{top['pct']:+.2f}%**",
            f"> ## {fmt(top['old'])} → {fmt(top['new'])}", "", "---", "",
        ]
    elif changed(regions):
        L += [f"# ✅ Weekly AWS pricing update — no spikes over {threshold:g}%", ""]
    else:
        L += ["# ✅ Weekly AWS pricing update — no changes", ""]
    for reg in regions:
        L += region_block(reg, threshold)
    L += [
        "---",
        "_On-Demand list prices from AWS's public Price List Bulk API. Approximate — exclude Free "
        "Tier, Savings Plans/RIs, discounts, and taxes. Generated by `aws-pricing/pricing_diff.py`._",
    ]
    return "\n".join(L) + "\n"


def build_title(regions, date):
    sp = all_spikes(regions)
    if sp:
        lbl, t = sp[0]
        return f"🚨 AWS pricing SPIKE {t['pct']:+.1f}% ({t['key']}, {lbl}) — weekly review {date}"
    if changed(regions):
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
    ap.add_argument("--old", help="single mode: previous pricing_<region>.json")
    ap.add_argument("--new", help="single mode: freshly generated pricing_<region>.json")
    ap.add_argument("--regions", help="multi mode: comma-separated regions (needs --old-dir/--new-dir)")
    ap.add_argument("--old-dir", help="multi mode: dir of committed pricing_<region>.json baselines")
    ap.add_argument("--new-dir", help="multi mode: dir of freshly generated pricing_<region>.json")
    ap.add_argument("--threshold", type=float, default=1.0, help="spike threshold in %% (default 1.0)")
    ap.add_argument("--out-md", default="PRICING_CHANGES.md")
    ap.add_argument("--out-summary", default="pricing_changes_summary.json")
    ap.add_argument("--demo-spike", action="store_true", help="inject a synthetic spike (testing)")
    args = ap.parse_args()

    regions = []
    if args.regions:
        want = [r.strip() for r in args.regions.split(",") if r.strip()]
        loaded = []  # (label, old, new)
        for r in want:
            new = load(os.path.join(args.new_dir, f"pricing_{r}.json"))
            old_path = os.path.join(args.old_dir, f"pricing_{r}.json")
            old = load(old_path) if os.path.isfile(old_path) else None
            loaded.append((new.get("label", r), old, new))
        if args.demo_spike and loaded:
            # inject into the first region that has a baseline (so the spike is comparable)
            i = next((j for j, (_, o, _) in enumerate(loaded) if o is not None), 0)
            demo_spike(loaded[i][2])
        for label, old, new in loaded:
            regions.append(diff_pair(label, old, new, args.threshold))
    elif args.old and args.new:
        new = load(args.new)
        if args.demo_spike:
            new = demo_spike(new)
        old = load(args.old)
        regions.append(diff_pair(new.get("label", new.get("region", "?")), old, new, args.threshold))
    else:
        ap.error("give either --old/--new (single) or --regions/--old-dir/--new-dir (multi)")

    date = max((r["n_gen"] for r in regions), default="")[:10]
    with open(args.out_md, "w", encoding="utf-8") as fh:
        fh.write(build_md(regions, args.threshold))

    sp = all_spikes(regions)
    total = sum(len(r["spikes"]) + len(r["minor"]) + len(r["added"]) + len(r["removed"]) for r in regions)
    summary = {
        "changed": changed(regions),
        "spikes": len(sp),
        "changes": total,
        "threshold": args.threshold,
        "max_pct": round(sp[0][1]["pct"], 3) if sp else 0.0,
        "max_item": f"{sp[0][1]['key']} ({sp[0][0]})" if sp else "",
        "title": build_title(regions, date),
    }
    with open(args.out_summary, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    print(f"pricing-diff: {len(sp)} spike(s) >{args.threshold:g}% across "
          f"{len(regions)} region(s), {total} total change(s)", file=sys.stderr)
    if sp:
        lbl, t = sp[0]
        print(f"  biggest: {t['key']} ({lbl}) {t['pct']:+.2f}% ({fmt(t['old'])} → {fmt(t['new'])})", file=sys.stderr)


if __name__ == "__main__":
    main()
