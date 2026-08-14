#!/usr/bin/env node
// Folds every data/requests/*.json submission into the canonical data/requests.json array and
// deletes the folded files (keeps .gitkeep).
//
// Same idea as dse-hub/scripts/compact.mjs, with one difference: the Algorithm Catalog has no
// canonical array to patch — a request is a TERMINAL record, not a change doc. So the canonical
// file here IS the accumulated list of requests, created on first run if it does not exist.
// Each submission lands as its own uniquely-named file (conflict-free, token-free PRs); this
// script is what stops data/requests/ from growing without bound.
//
// Usage: node algorithm-catalog/scripts/compact.mjs   (run from anywhere)
import { readdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, ".."); // algorithm-catalog/

const canonicalPath = resolve(root, "data/requests.json");
const requestsDir = resolve(root, "data/requests");

async function readJson(p) {
  const raw = await readFile(p, "utf8");
  return JSON.parse(raw);
}

// ---- load the canonical array (may not exist yet — first compaction creates it) ----
let canonical = [];
try {
  const existing = await readJson(canonicalPath);
  if (Array.isArray(existing)) canonical = existing;
  else console.warn("data/requests.json is not an array — starting from an empty list.");
} catch {
  // Missing file is the normal first-run case.
}

// ---- load every pending submission ----
let requestFiles;
try {
  requestFiles = (await readdir(requestsDir)).filter((f) => f.endsWith(".json")).sort();
} catch {
  requestFiles = [];
}

const incoming = [];
for (const f of requestFiles) {
  const doc = await readJson(resolve(requestsDir, f));
  // A submission file holds one request; tolerate an array so several can be batched in one PR.
  const docs = Array.isArray(doc) ? doc : [doc];
  for (const d of docs) {
    if (d && typeof d === "object" && d.id) incoming.push(d);
    else console.warn(`Skipping a record in data/requests/${f}: no "id".`);
  }
}

if (incoming.length === 0) {
  console.log("No pending requests found in data/requests/. Nothing to compact.");
  process.exit(0);
}

// ---- upsert by id, newest ts wins ----
// Oldest→newest first so that within this batch the last write is the newest; then guard against
// a stale submission clobbering a newer entry already in the canonical file.
incoming.sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));

const byId = new Map(canonical.filter((r) => r && r.id).map((r) => [r.id, r]));
let added = 0;
let updated = 0;
let skipped = 0;
for (const r of incoming) {
  const prev = byId.get(r.id);
  if (!prev) {
    byId.set(r.id, r);
    added++;
  } else if (String(r.ts ?? "") >= String(prev.ts ?? "")) {
    byId.set(r.id, r);
    updated++;
  } else {
    skipped++; // canonical entry is newer — keep it
  }
}

// Chronological order keeps the committed diff readable (new requests append at the end).
const merged = [...byId.values()].sort(
  (a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")) || String(a.id).localeCompare(String(b.id)),
);

await writeFile(canonicalPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
console.log(`Wrote data/requests.json (${merged.length} request(s): ${added} added, ${updated} updated, ${skipped} stale ignored)`);

// ---- delete the folded submission files (keep .gitkeep) ----
let deleted = 0;
for (const f of requestFiles) {
  await unlink(resolve(requestsDir, f));
  deleted++;
}
console.log(`Deleted ${deleted} submission file(s) from data/requests/`);

// Recreate .gitkeep in case it was among the deleted files (it shouldn't be, but safety).
try {
  await stat(resolve(requestsDir, ".gitkeep"));
} catch {
  await writeFile(resolve(requestsDir, ".gitkeep"), "", "utf8");
}

console.log(`\nCompacted ${incoming.length} submission(s) into data/requests.json.`);
