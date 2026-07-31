#!/usr/bin/env node
// Applies all data/changes/*.json change docs into the canonical data/meetings.json and
// data/pis.json arrays, rewrites them, and deletes the folded change files (keeps .gitkeep).
// Usage: node dse-hub/scripts/compact.mjs  (run from repo root or from dse-hub/)
import { readdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, ".."); // dse-hub/

async function readJson(p) {
  const raw = await readFile(p, "utf8");
  return JSON.parse(raw);
}

// ---- load canonicals ----
const meetings = await readJson(resolve(root, "data/meetings.json"));
const pis = await readJson(resolve(root, "data/pis.json"));

// ---- load all change docs ----
const changesDir = resolve(root, "data/changes");
let changeFiles;
try {
  changeFiles = (await readdir(changesDir)).filter((f) => f.endsWith(".json"));
} catch {
  changeFiles = [];
}

let totalChangeDocs = 0;
const allDocs = [];
for (const f of changeFiles) {
  const docs = await readJson(resolve(changesDir, f));
  if (Array.isArray(docs)) {
    allDocs.push(...docs);
    totalChangeDocs += docs.length;
  }
}

// Sort oldest→newest so newest wins.
allDocs.sort((a, b) => a.ts.localeCompare(b.ts));

if (allDocs.length === 0) {
  console.log("No change docs found. Nothing to compact.");
  process.exit(0);
}

// ---- apply upserts ----
const meetingMap = new Map(meetings.map((m) => [m.id, m]));
const piMap = new Map(pis.map((p) => [p.id, p]));

for (const doc of allDocs) {
  if (doc.op !== "upsert") continue;
  if (doc.kind === "meeting" && doc.data?.id) meetingMap.set(doc.data.id, doc.data);
  if (doc.kind === "pi" && doc.data?.id) piMap.set(doc.data.id, doc.data);
}

// ---- sort ----
function firstStart(p) {
  return p.sprints.reduce((m, s) => (s.start < m ? s.start : m), p.sprints[0]?.start ?? "9999-99-99");
}
const newMeetings = [...meetingMap.values()].sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
const newPis = [...piMap.values()].sort((a, b) => firstStart(a).localeCompare(firstStart(b)));

// ---- write canonicals ----
await writeFile(resolve(root, "data/meetings.json"), JSON.stringify(newMeetings, null, 2) + "\n", "utf8");
await writeFile(resolve(root, "data/pis.json"), JSON.stringify(newPis, null, 2) + "\n", "utf8");
console.log(`Wrote data/meetings.json (${newMeetings.length} entries)`);
console.log(`Wrote data/pis.json (${newPis.length} entries)`);

// ---- delete folded change files (keep .gitkeep) ----
let deleted = 0;
for (const f of changeFiles) {
  await unlink(resolve(changesDir, f));
  deleted++;
}
console.log(`Deleted ${deleted} change file(s) from data/changes/`);

// Recreate .gitkeep in case it was among the json files (it shouldn't be, but safety).
try { await stat(resolve(changesDir, ".gitkeep")); } catch {
  await writeFile(resolve(changesDir, ".gitkeep"), "", "utf8");
}

console.log(`\nCompacted ${totalChangeDocs} change doc(s) into canonical files.`);
