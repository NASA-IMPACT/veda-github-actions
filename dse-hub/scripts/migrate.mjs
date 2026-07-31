#!/usr/bin/env node
// Migrates one-file-per-meeting/pi to canonical array files.
// Usage: node dse-hub/scripts/migrate.mjs  (run from repo root or from dse-hub/)
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, ".."); // dse-hub/

async function readJsonDir(dirPath) {
  let entries;
  try {
    entries = await readdir(dirPath);
  } catch {
    return [];
  }
  const jsons = entries.filter((f) => f.endsWith(".json"));
  const items = [];
  for (const f of jsons) {
    const raw = await readFile(resolve(dirPath, f), "utf8");
    items.push(JSON.parse(raw));
  }
  return items;
}

// ---- meetings ----
const meetingsDir = resolve(root, "data/meetings");
const meetings = await readJsonDir(meetingsDir);
console.log(`Read ${meetings.length} meetings from data/meetings/`);
await writeFile(resolve(root, "data/meetings.json"), JSON.stringify(meetings, null, 2) + "\n", "utf8");
console.log(`Wrote data/meetings.json (${meetings.length} entries)`);

// ---- pis ----
const pisDir = resolve(root, "data/pis");
const pis = await readJsonDir(pisDir);
console.log(`Read ${pis.length} PI(s) from data/pis/`);
await writeFile(resolve(root, "data/pis.json"), JSON.stringify(pis, null, 2) + "\n", "utf8");
console.log(`Wrote data/pis.json (${pis.length} entries)`);

// ---- delete old dirs ----
await rm(meetingsDir, { recursive: true, force: true });
console.log("Deleted data/meetings/");
await rm(pisDir, { recursive: true, force: true });
console.log("Deleted data/pis/");

// ---- create changes dir with .gitkeep ----
const changesDir = resolve(root, "data/changes");
await mkdir(changesDir, { recursive: true });
await writeFile(resolve(changesDir, ".gitkeep"), "", "utf8");
console.log("Created data/changes/.gitkeep");

console.log(`\nDone. ${meetings.length} meetings, ${pis.length} PI(s).`);
