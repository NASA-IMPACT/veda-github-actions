// CSV export of exactly what is on screen — same rows, same columns, same order.
// Hand-rolled rather than pulling in a CSV dependency: this app's package.json stays React-only.

import type { BoardItem, FieldDef } from "./types";
// Explicit `.ts` extension (tsconfig sets allowImportingTsExtensions) because this is the only
// RUNTIME import that scripts/test_search.ts pulls in — every other cross-module import in
// search/filter/csv is `import type`, which erases. Node's ESM resolver needs the extension;
// Vite is happy either way. Without it, `node scripts/test_search.ts` cannot load this module.
import { fieldText } from "./filter.ts";

function cell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  // Quote when the value could otherwise break the row, and double any embedded quote.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function itemsToCsv(items: BoardItem[], fields: FieldDef[]): string {
  const head = [
    "kind", "number", "title", "state", "draft", "repo", "url",
    "assignees", "labels", "author", "milestone", "issue_type",
    "created", "updated", "closed", "comments", "sub_completed", "sub_total",
    ...fields.map((f) => f.name),
  ];
  const rows = items.map((i) => [
    i.kind,
    i.number ?? "",
    i.title,
    i.state,
    i.draft ? "yes" : "",
    i.repo,
    i.url,
    i.assignees.join(" "),
    i.labels.join(" "),
    i.author ?? "",
    i.milestone ?? "",
    i.issue_type ?? "",
    i.created ?? "",
    i.updated ?? "",
    i.closed ?? "",
    i.comments,
    i.sub?.completed ?? "",
    i.sub?.total ?? "",
    ...fields.map((f) => fieldText(i.fields[f.name])),
  ]);
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

export function downloadCsv(filename: string, csv: string): void {
  // A BOM so Excel opens UTF-8 titles correctly instead of mojibake.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
