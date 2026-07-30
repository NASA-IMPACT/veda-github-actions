# Leave overrides

One **JSON file per person** in this directory layers on top of what the generator reads from
the xlsx. It lets you **add someone who isn't on the spreadsheet**, or **adjust/add leave** for
someone who is — without touching the workbook. The "Add person" button in the dashboard just
opens a prefilled GitHub PR that creates a file here.

- Filename: `<slug>.json` where `<slug>` is the lowercase, dash-separated name (e.g.
  `jane-doe.json`). One file per person avoids merge conflicts.
- The generator merges these **after** the xlsx: for any date an override touches, the override
  **wins** over the xlsx value for that person.
- A new person's `team` counts toward that team's size in the coverage/risk math. Typing a team
  that isn't on the spreadsheet **creates a new team** (a new group in the dashboard).
- **Multiple people in one file / one PR:** a file may hold a single person (object), or several
  (a top-level array, or `{"people": [ … ]}`). The dashboard's "Add person" modal uses this to
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
