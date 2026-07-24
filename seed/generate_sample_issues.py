#!/usr/bin/env python3
"""Deterministically generate N varied "Objective" issues for the FTE POC.

PI and the objective window (Start/End) live on the PROJECT BOARD, not in the
issue body. So each generated record has:
  - body: Context + LOE/FTE table only (no PI / no timeline text)
  - project: {pi, pi_start, pi_end, start, end}  -> used to set project fields
             and to drive offline report testing

Writes seed/sample_issues.json (schema: number,title,url,state,body,labels,
project). Seeded for reproducibility so reports diff cleanly across runs.

Variety: 2 real PIs (26.4 current, 27.2 next), 1-5 people/ticket, mixed roles &
FTE, ~30% partial-window objectives, a few empty FTE tables, a few edge rows
(invalid role / non-numeric FTE).
"""
import argparse
import datetime
import json
import os
import random

# Real Program Increments from the Disasters Learning Portal board.
PIS = [
    ("PI 26.4", datetime.date(2026, 7, 12), datetime.date(2026, 10, 17)),
    ("PI 27.1", datetime.date(2026, 10, 18), datetime.date(2027, 1, 16)),
    ("PI 27.2", datetime.date(2027, 1, 17), datetime.date(2027, 4, 17)),
]

# --- Trend / alert shaping (deterministic) -----------------------------------
# The Trends tab needs a clear worsening story across the 3 PIs. We deterministically
# give each person a raw FTE per PI: a growing set is pushed over 1.0 (over-allocated),
# everyone else rises modestly, and objective counts rise — so demand + over-allocation
# climb 26.4 -> 27.1 -> 27.2, team utilization crosses 100% in 27.2, and Backend demand
# (only 2 people) exceeds its supply in 27.2 (an emerging bottleneck).
PI_OBJ_COUNTS = [12, 16, 20]                        # objectives per PI (rising)
OVER_BY_PI = [
    {"Sofia Rossi"},                                                                 # 26.4: 1 over
    {"Sofia Rossi", "Alice Nguyen", "Bob Martinez"},                                 # 27.1: 3 over
    {"Sofia Rossi", "Alice Nguyen", "Bob Martinez", "Nadia Hassan", "Yuki Tanaka"},  # 27.2: 5 over
]
OVER_FTE = [1.15, 1.30, 1.45]                       # raw FTE for an over-allocated person (worsening)
HEALTHY_FTE = [0.45, 0.68, 0.85]                    # baseline FTE for everyone else (rising)

ROSTER = [
    ("Alice Nguyen", "PM"), ("Sofia Rossi", "PM"),
    ("Bob Martinez", "Backend"), ("Nadia Hassan", "Backend"),
    ("Carla Diaz", "Geospatial"), ("Owen Clark", "Geospatial"),
    ("Devon Lee", "Frontend"), ("Rae Thompson", "Frontend"),
    ("Priya Patel", "Data Curator"), ("Liam Walsh", "Data Curator"),
    ("Sam Okoro", "ML"), ("Yuki Tanaka", "ML"),
    ("Jordan Kim", "Designer"), ("Elena Petrova", "Designer"),
    ("Taylor Brooks", "Comms"),
    ("Morgan Reyes", "Jupyterhub"),
]

TEAM_TAGS = ["PM", "Frontend", "Backend", "Geospatial", "Data Curator", "Comms", "ML", "Designer", "Jupyterhub"]

# A few people wear a second hat — exercises the per-person-per-role split in the matrix
# (their allocations land under two roles, so they get two role-rows with a combined total).
SECOND_ROLE = {
    "Alice Nguyen": "Backend",
    "Devon Lee": "Designer",
    "Priya Patel": "PM",
    "Sam Okoro": "Data Curator",
}

# Board grouping fields (per-objective). Values mirror the real IMPACT board so the matrix
# view demos with several Initiative groups. Assigned by index (see generate) — NOT via rng —
# so the existing random stream (FTEs, windows, roster) and the reconciliation baseline are
# unchanged; these columns are purely additive.
INITIATIVES = ["Disasters", "AIR4US", "Water Insights", "Plugins", "CMS", "EIE",
               "TiTiler-CMR", "Science Support", "Cloud-Optimized R+D"]
PROJECTS = ["Disasters", "HLS", "MAAP", "CSDA", "AQ Portal"]
TEAMS = ["Front-end", "Back-end", "Geospatial", "Data Services", "Plugins", "ODD", "EIE"]

TOPICS = [
    "COG pipeline hardening", "S3 ingestion API v2", "Disaster dashboard redesign",
    "Flood extent model", "CSDA catalog automation", "Stakeholder reporting portal",
    "Notebook environment upgrade", "Reprojection service scaling", "Auth & access control",
    "Data QA automation", "Tile server migration", "Metadata schema v3",
    "Alerting pipeline", "Cloud cost monitoring", "Wildfire severity model",
    "Public API documentation", "Onboarding revamp", "STAC catalog buildout",
    "Imagery mosaicking", "Latency profiling", "Nodata standardization",
    "Hurricane track ingestion", "Access log analytics", "Model retraining harness",
    "Colormap library", "Region-of-interest tooling", "Backfill orchestration",
    "Vector tile support", "Search relevance tuning", "Incident runbook automation",
]

FTES = [0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.8, 1.0]
BAD_ROWS = [("Chris DevOps", "DevOps", "0.3"), ("Pat Analyst", "Analyst", "0.2"),
            ("Jamie Ops", "Backend", "TBD")]


def body_for(topic, rows):
    parts = [
        "## Context", "",
        "### Motivation",
        f"Deliver **{topic}** to support the Disasters program during this PI.", "",
        "### Description",
        f"Scope, milestones, and dependencies for {topic.lower()}.", "",
        "### Examples & Concept Diagrams (If applicable)", "",
        "## Success Criteria",
        "- [ ] Design reviewed and approved",
        "- [ ] Implementation merged and deployed", "",
        "## Risks",
        "- Dependency slippage; mitigate with early integration checkpoints.", "",
        "## LOE/FTE",
        "<!-- PI and Start/End dates live on the project board, not here. -->",
        "| Person | Role | FTE | Notes |",
        "| ------ | ---- | --- | ----- |",
    ]
    return "\n".join(parts + rows)


def target_fte(person, pi_idx):
    """Deterministic raw FTE for a person in a PI, shaped for the trend/alert story."""
    if person in OVER_BY_PI[pi_idx]:
        return OVER_FTE[pi_idx]
    return round(HEALTHY_FTE[pi_idx], 2)


def partial_window(rng, pi_start, pi_end):
    total = (pi_end - pi_start).days
    offset = rng.randint(0, max(1, total // 2))
    length = rng.randint(max(7, total // 4), max(8, total * 3 // 4))
    start = pi_start + datetime.timedelta(days=offset)
    end = min(pi_end, start + datetime.timedelta(days=length))
    return start, end


def generate(count, seed):
    """`count` is ignored — PI_OBJ_COUNTS drives the total. Deterministic given seed."""
    rng = random.Random(seed)
    issues = []
    obj_num = 0
    for pi_idx, (pi_title, pi_start, pi_end) in enumerate(PIS):
        # 1. Each person's target raw FTE for this PI, split into 1-2 allocation "chunks".
        chunks = []  # (person, role, fte)
        for person, role in ROSTER:
            total = target_fte(person, pi_idx)
            n = 2 if total > 0.7 else 1
            per = round(total / n, 2)
            for k in range(n):
                # multi-role people put their 2nd chunk under their alternate role (feeds the matrix)
                use_role = SECOND_ROLE[person] if (k == 1 and person in SECOND_ROLE) else role
                chunks.append((person, use_role, per))
        rng.shuffle(chunks)

        # 2. Pack chunks round-robin into this PI's objectives (rising count per PI).
        n_obj = PI_OBJ_COUNTS[pi_idx]
        buckets = [[] for _ in range(n_obj)]
        for j, ch in enumerate(chunks):
            buckets[j % n_obj].append(ch)

        # 3. Emit one issue per objective.
        for bucket in buckets:
            obj_num += 1
            topic = TOPICS[(obj_num - 1) % len(TOPICS)]
            team_tag = TEAM_TAGS[(obj_num - 1) % len(TEAM_TAGS)]
            title = f"[{team_tag}]-[Objective {obj_num}]: {topic}"
            initiative = INITIATIVES[(obj_num - 1) % len(INITIATIVES)]
            project = PROJECTS[(obj_num - 1) % len(PROJECTS)]
            board_team = TEAMS[(obj_num - 1) % len(TEAMS)]
            rows = [f"| {p} | {r} | {f} | — |" for (p, r, f) in bucket] or ["|  |  |  |  |"]
            body = body_for(topic, rows)
            if rng.random() < 0.25:
                obj_start, obj_end = partial_window(rng, pi_start, pi_end)
            else:
                obj_start, obj_end = pi_start, pi_end
            issues.append({
                "number": obj_num, "title": title,
                "url": f"https://github.com/NASA-IMPACT/veda-github-actions/issues/{obj_num}",
                "state": "open", "body": body, "labels": ["Objective", "poc-loe"],
                "project": {
                    "pi": pi_title,
                    "pi_start": pi_start.isoformat(), "pi_end": pi_end.isoformat(),
                    "start": obj_start.isoformat(), "end": obj_end.isoformat(),
                    "initiative": initiative, "project": project, "team": board_team,
                },
            })
    return issues


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--count", type=int, default=50)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "sample_issues.json"))
    args = ap.parse_args()
    issues = generate(args.count, args.seed)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(issues, fh, indent=2, ensure_ascii=False)
    print(f"Wrote {len(issues)} sample issues -> {os.path.relpath(args.out)}")


if __name__ == "__main__":
    main()
