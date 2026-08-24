# Leave overrides

One **JSON file per person** in this directory layers on top of what the generator reads from
the xlsx. It lets you **add someone who isn't on the spreadsheet**, or **adjust/add leave** for
someone who is — without touching the workbook. The "Add leave" button in the dashboard just
opens a prefilled GitHub PR that creates a file here.

**These PRs merge themselves.** `.github/workflows/leave-override-automerge.yml` validates the file
and merges it with no human approval, so the dates are on the dashboard about two minutes later. It
only does that when the PR touches **nothing but** `leave/overrides/<slug>.json` files (≤ 5 of them),
they all pass [`../scripts/validate_overrides.py`](../scripts/validate_overrides.py), and the author
is a collaborator or org member. Anything else gets a comment explaining why and waits for a review.

Validate a file before you push it:

```bash
python leave/scripts/validate_overrides.py leave/overrides/jane-doe.json
```

- Filename: `<slug>.json` where `<slug>` is the lowercase, dash-separated name (e.g.
  `jane-doe.json`). One file per person avoids merge conflicts.
- The generator merges these **after** the xlsx: for any date an override touches, the override
  **wins** over the xlsx value for that person.
- A new person's `team` counts toward that team's size in the coverage/risk math. Typing a team
  that isn't on the spreadsheet **creates a new team** (a new group in the dashboard).
- **Multiple people in one file / one PR:** a file may hold a single person (object), or several
  (a top-level array, or `{"people": [ … ]}`). The dashboard's "Add leave" modal uses this to
  put everyone you add in one sitting into a single PR (e.g. `jane-doe-plus-2.json`).

## Schema

```json
{
  "person": "Jane Doe",
  "slug": "jane-doe",
  "team": "DevSeed",
  "role": "",
  "pi": "26.4",
  "entries": [
    { "start": "2026-08-03", "end": "2026-08-07", "status": "planned_time_off", "note": "vacation" },
    { "date": "2026-08-14", "status": "limited", "note": "half day" }
  ]
}
```

- `entries[].status` ∈ `unavailable`, `limited`, `holiday`, `planned_time_off`, `work_travel`,
  `wfh`, `other`, or `available`.
- A `start`/`end` range is expanded per day (weekends skipped unless the file sets
  `"include_weekends": true`); a single `date` marks one day.
- `"status": "available"` is a **tombstone** — it clears any xlsx leave on that date for the
  person (use it to correct the spreadsheet without editing it).
