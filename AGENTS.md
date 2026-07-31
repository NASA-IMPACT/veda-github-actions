# AGENTS.md — guide for coding agents

This repo is a test station for VEDA GitHub Actions + Netlify dashboards. Full context is in
`CLAUDE.md`; app-specific docs are in `docs/`.

## Environment
- **Python 3.12, standard library only** for all generators (no `pip install`, no `requests`, no
  `boto3`). AWS pricing is pulled from AWS's **public** Price List Bulk API — **no credentials**.
- **Node 18+** for the dashboards (`cost-dashboard/`, `fte-dashboard/`, …): `cd <dir> && npm ci`.
- Quick checks: `python3 aws-pricing/test_generate.py` (offline golden test),
  `cd cost-dashboard && npm run typecheck && npm run build`.

## Conventions
- Match surrounding style; keep generators stdlib-only and deterministic (they take `--now`).
- Netlify "Pattern B": each dashboard owns its `<dir>/netlify.toml`; there is **no** root netlify.toml.

---

## ⭐ Scheduled task: **Weekly AWS pricing review** (run Monday evening)

**Goal:** pull the latest AWS On-Demand prices, compare to the committed snapshot, and open a PR that
updates it — and if any price moved **more than 1%**, make that **impossible to miss**.

**Do exactly this:**
1. Fetch fresh prices (heavy EC2 file ~473 MB; takes ~1–2 min):
   ```bash
   python3 aws-pricing/generate_aws_pricing.py --region us-west-2 \
     --out-dir /tmp/new --now "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
   ```
2. Diff against the committed snapshot and generate the change report:
   ```bash
   python3 aws-pricing/pricing_diff.py \
     --old cost-dashboard/public/data/pricing_us-west-2.json \
     --new /tmp/new/pricing_us-west-2.json \
     --threshold 1.0 --out-md PRICING_CHANGES.md --out-summary /tmp/summary.json
   ```
3. If `/tmp/summary.json` has `"changed": false`, **do nothing** (no PR).
4. Otherwise, in the PR:
   - Update `cost-dashboard/public/data/pricing_us-west-2.json` (and `index.json`) with the fresh files.
   - Save the report to `cost-reports/weekly-<YYYY-MM-DD>.md`.
   - **Use `PRICING_CHANGES.md` as the PR body verbatim** — it already contains the loud 🚨 spike
     banner and giant headers. Do not soften or summarize it away.
   - **Use `summary.json`'s `title` as the PR title** — for a spike it starts with `🚨 AWS pricing
     SPIKE ±X%` so it's impossible to miss in the PR list.
5. Spikes = any price where `|Δ| > 1%`. If there are spikes, the biggest one must be shouted at the
   very top of the PR body (the report already does this). Never bury a spike.

**Rules:** On-Demand prices only; they are approximate. Keep the report's alarm formatting loud — the
whole point is that a >1% move is obvious at a glance. One PR per run; if a same-day PR exists, update it.

> This runs automatically every Monday evening via `.github/workflows/aws-pricing-review.yml` (a plain
> price-diff — no external agent required). Test the alert formatting with its `demo_spike` input (or
> `pricing_diff.py --demo-spike`), which injects a synthetic +7.3% move.
