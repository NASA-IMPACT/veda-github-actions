# Weekly AWS pricing review — Jules setup

Every **Monday evening**: pull the latest AWS On-Demand prices, diff them against the committed
snapshot, and open a **PR** with the changes. Any price that moved **>1%** is a **spike** and is
shouted at the top of the PR (loud title + 🚨 banner) so it's **impossible to miss**.

There are two ways to run this. They do the same thing; pick one (or run both — the Action is a safe
fallback).

## Engine (already in the repo, no Jules needed)
`.github/workflows/aws-pricing-review.yml` is a scheduled GitHub Action (Mondays, 00:00 UTC Tue ≈
Mon evening US). It runs `aws-pricing/generate_aws_pricing.py` + `aws-pricing/pricing_diff.py` and
opens/updates the review PR. Test it any time:
```
Actions → "AWS Pricing Review" → Run workflow → demo_spike = true
```
That injects a synthetic +7.3% move and opens a **[DEMO — do not merge]** PR so you can see the alert.

## Jules (the "smart reviewer" that authors the PR)
Jules reads `AGENTS.md` (the task is spelled out there) and opens a reviewable PR from its own cloud VM.

**One-time connect (in your Jules account):**
1. Go to **jules.google.com** → sign in → **Connect GitHub** and authorize the
   `NASA-IMPACT/veda-github-actions` repo.

**Create the scheduled task:**
2. New task → repo `NASA-IMPACT/veda-github-actions`, branch `main`.
3. Set it to **recurring / scheduled** with cron **`0 0 * * 2`** (Monday evening, 00:00 UTC Tue). Adjust
   the hour to your timezone if you like.
4. Paste this prompt:

   > Run the **Weekly AWS pricing review** task from `AGENTS.md`. Fetch fresh us-west-2 prices with
   > `aws-pricing/generate_aws_pricing.py`, diff against the committed snapshot with
   > `aws-pricing/pricing_diff.py` (threshold 1%), and if anything changed, open ONE PR that updates
   > `cost-dashboard/public/data/pricing_us-west-2.json` (+ `index.json`), saves the report to
   > `cost-reports/weekly-<date>.md`, uses `PRICING_CHANGES.md` **verbatim** as the PR body, and uses
   > the `title` from the summary as the PR title. If a price moved **more than 1%**, the biggest spike
   > MUST be shouted at the very top of the PR — never soften or bury it. If nothing changed, do nothing.

5. Save. Jules now runs every Monday evening and opens the PR itself.

**Test Jules now:** open the task and click **Run** once — it should produce a PR (or "no changes"
if prices are flat; use the Action's `demo_spike` to force a visible spike for the demo).

### Optional: trigger Jules from a workflow instead of its own scheduler
If you'd rather keep the cron in GitHub, use the `google-labs-code/jules-action` in a workflow with a
`JULES_API_KEY` secret (from your Jules account) and the same prompt. The self-scheduled task above is
simpler and needs no secret.

---
**Notes:** prices are On-Demand list rates, approximate (exclude Free Tier, Savings Plans/RIs,
discounts, taxes). The spike threshold (1%) lives in `pricing_diff.py --threshold`.
