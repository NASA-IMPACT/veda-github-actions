# Milestone sync

`milestones/sync_milestones.py` turns a milestone table (the **FY27 Milestones** Slack canvas:
Project / Task / Owner / Deadline) into GitHub milestones on one repo. Stdlib Python + `gh`.
It starts with the Disasters rows synced into `NASA-IMPACT/veda-architecture`.

## Run it
- **Actions tab → "Milestone sync" → Run workflow.** Defaults:
  `milestones/fixtures/fy27_milestones.csv` (a hand transcript of the canvas, until the Slack secret
  below exists), `NASA-IMPACT/veda-architecture`, project `Disasters`, **dry run**. Read the plan in
  the job summary, then run again with **apply** ticked.
- Locally, offline source:
  `GH_TOKEN=<PAT> python3 milestones/sync_milestones.py --source milestones/fixtures/fy27_milestones.csv --repo NASA-IMPACT/veda-architecture --project Disasters`
  (add `--apply` to write).
- From another repo: `uses: NASA-IMPACT/veda-github-actions/milestones@v1` (inputs in `milestones/action.yml`).
- Parser test, offline: `python3 milestones/test_sync.py`.

## Secrets
| Secret | Why |
|---|---|
| `PROJECT_TOKEN_FOR_BOARD_READS` | Writes milestones on another repo. `GITHUB_TOKEN` only reaches this one. A classic PAT's `repo` scope covers it. |
| `SLACK_CANVAS_TOKEN` | **Not yet created.** A Slack token with `files:read` that can see the canvas. A bot token only sees canvases shared into a channel the bot is in. Only needed when the source is a canvas URL. |

The canvas is read via `files.info` → `url_private_download` (HTML), and the first `<table>`
whose header names Task and Deadline is used. Merged Project cells (`rowspan`) and blank Project
cells both inherit the project above. **The HTML parser has only been tested against a hand-built
fixture (`milestones/fixtures/canvas_table.html`), not a real canvas download.** If the first canvas
run fails to find the table, save the download and add it as a fixture.

## Row → milestone
| Field | From |
|---|---|
| title | First line of Task. **This is the identity**: a milestone with exactly this title is updated, not duplicated. Renaming a task in the canvas creates a new milestone and leaves the old one. |
| due_on | Deadline: `October 1, 2026` → that day. `Dec 2026` / `Q1 FY27 - December 2026` / `~Dec / Jan 2027` → last day of the (first) month named. `…through FY27` → 2027-09-30, the end of the federal FY. Anything else (`TBD`, `Late 2027`, `Iteratively through FY`) → no due date, flagged ⚠ in the plan. |
| description | Project, Owner, the deadline as written, the rest of the Task text, and the canvas URL. |

It never deletes or closes a milestone, and never clears a due date. If a deadline changes to `TBD`,
the old date stays until someone edits it by hand.
