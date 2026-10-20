#!/usr/bin/env node
// Turn catalog requests that carry an event page into a PR on the Disasters Portal
// (Disasters-Learning-Portal/disasters-portal). Run by .github/workflows/algorithm-catalog-portal-pr.yml
// on every request PR here; runnable by hand with --dry-run against any portal checkout.
//
//   node algorithm-catalog/scripts/portal_pr.mjs --portal <checkout> --branch <name> \
//        [--title <pr title>] [--source-pr <url>] [--dry-run] <request.json>...
//
// For each request with a `page`, in the portal checkout:
//   1. write app/site-config/event/event__<id>.ts       (src/portal.ts — the same code the app previews)
//   2. register it in app/site-config/event/index.ts    (import + EVENTS entry, newest startDate first)
//   3. run the portal's OWN gates — `biome check --write` on the touched files, then the full
//      `pnpm lint:ci` and `pnpm typecheck` its PR checks run. Any failure stops here: no PR.
//   4. commit to <branch>, push, and open the PR (or update it, if this branch already has one).
//
// A page file that exists WITHOUT the generator's marker line is hand-written and is never
// overwritten — that request is skipped with a message instead.
//
// Plain Node (>= 22.18, which strips TypeScript types natively) + git + pnpm + gh. No npm deps.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PORTAL_BRANCH, PORTAL_MARKER, PORTAL_REPO, portalEventFile } from "../src/portal.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "data");
const INDEX = "app/site-config/event/index.ts";

function parseArgs(argv) {
  const opts = { files: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--portal") opts.portal = resolve(argv[++i]);
    else if (a === "--branch") opts.branch = argv[++i];
    else if (a === "--title") opts.title = argv[++i];
    else if (a === "--source-pr") opts.sourcePr = argv[++i];
    else opts.files.push(resolve(a));
  }
  if (!opts.portal || !opts.branch) {
    console.error("usage: portal_pr.mjs --portal <checkout> --branch <name> [--dry-run] <request.json>...");
    process.exit(2);
  }
  return opts;
}

const run = (cwd, cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: opts.quiet ? "pipe" : ["ignore", "pipe", "inherit"] });

/** Every request in the files (a file holds one request or an array of them), that carries a page. */
function pageRequests(files) {
  const out = [];
  for (const f of files) {
    const v = JSON.parse(readFileSync(f, "utf8"));
    for (const r of Array.isArray(v) ? v : [v]) if (r?.kind === "algorithm-request" && r.page) out.push(r);
  }
  return out;
}

/**
 * Register the page in index.ts: an import (Biome re-sorts imports afterwards) and an EVENTS entry
 * placed before the first event that started earlier — the array is kept newest first.
 */
export function registerInIndex(portal, constName, id, startDate) {
  const path = join(portal, INDEX);
  let src = readFileSync(path, "utf8");
  if (new RegExp(`\\b${constName}\\b`).test(src)) return false;

  const imports = [...src.matchAll(/^import \{ (EVENT__\w+) \} from "\.\/(event__[\w-]+)";$/gm)];
  const fileOf = new Map(imports.map((m) => [m[1], m[2]]));
  const lastImport = imports.at(-1);
  const at = lastImport.index + lastImport[0].length;
  src = `${src.slice(0, at)}\nimport { ${constName} } from "./event__${id}";${src.slice(at)}`;

  const start = src.indexOf("export const EVENTS");
  const open = src.indexOf("= [", start) + "= [".length; // not the `[` of `EventContent[]`
  const close = src.indexOf("];", open);
  const entries = src
    .slice(open, close)
    .split("\n")
    .map((l) => l.trim().replace(/,$/, ""))
    .filter(Boolean);
  const startOf = (c) => {
    const file = fileOf.get(c);
    const p = file && [".ts", ".tsx"].map((x) => join(portal, "app/site-config/event", file + x)).find(existsSync);
    return (p && /startDate: "(\d{4}-\d{2}-\d{2})"/.exec(readFileSync(p, "utf8"))?.[1]) || "";
  };
  const pos = entries.findIndex((c) => startOf(c) < startDate);
  entries.splice(pos === -1 ? entries.length : pos, 0, constName);
  src = `${src.slice(0, open)}\n${entries.map((c) => `  ${c},`).join("\n")}\n${src.slice(close)}`;
  writeFileSync(path, src);
  return true;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const algorithms = JSON.parse(readFileSync(join(DATA, "algorithms.json"), "utf8"));
  const hazards = JSON.parse(readFileSync(join(DATA, "hazards.json"), "utf8"));
  const today = new Date().toISOString().slice(0, 10);

  const requests = pageRequests(opts.files);
  if (requests.length === 0) {
    console.log("No request carries an event page — nothing to send to the Disasters Portal.");
    return;
  }

  const written = [];
  const skipped = [];
  for (const r of requests) {
    const f = portalEventFile(
      { ...r.event, layers: r.products.map(({ algorithm, product }) => ({ algorithm, product })), page: r.page },
      algorithms,
      hazards,
      today,
    );
    const target = join(opts.portal, f.path);
    // Hand-written pages are often .tsx (they embed JSX), so check BOTH extensions — and treat a
    // page already registered in index.ts under this constant as existing too.
    const existing = [target, target.replace(/\.ts$/, ".tsx")].find(existsSync);
    const registered = new RegExp(`\\b${f.constName}\\b`).test(readFileSync(join(opts.portal, INDEX), "utf8"));
    if ((existing && !readFileSync(existing, "utf8").startsWith(PORTAL_MARKER)) || (registered && !existing)) {
      skipped.push(
        `${f.id} already exists on the portal and was written by hand — not overwritten. Edit it there directly.`,
      );
      continue;
    }
    writeFileSync(target, f.source);
    registerInIndex(opts.portal, f.constName, f.id, r.event.start);
    written.push({ ...f, name: r.event.name, stacName: r.event.stacName });
    console.log(`wrote ${f.path} (${f.constName})${f.unmapped.length ? ` — no portal card for: ${f.unmapped.join(", ")}` : ""}`);
  }
  for (const s of skipped) console.log(`skipped: ${s}`);
  if (written.length === 0) return;

  // The portal's own gates, exactly as its pr-checks.yml runs them. Formatting first so a cosmetic
  // difference can never be what fails the PR; then the real checks over the WHOLE repo.
  const touched = [...written.map((w) => w.path), INDEX];
  run(opts.portal, "pnpm", ["exec", "biome", "check", "--write", ...touched]);
  run(opts.portal, "pnpm", ["lint:ci"]);
  run(opts.portal, "pnpm", ["typecheck"]);
  console.log("portal lint:ci + typecheck passed");

  const title = opts.title ?? `Event page: ${written.map((w) => w.name).join(", ")}`;
  const body = [
    "Event page(s) generated by the VEDA Algorithm Catalog from an activation request.",
    "",
    ...written.map((w) => `- **${w.name}** (\`${w.stacName}\`) → \`${w.path}\`${w.unmapped.length ? ` — no data-gallery card yet for: ${w.unmapped.join(", ")}` : ""}`),
    "",
    "The hero and thumbnail use the portal's placeholder image (`/img/event/template-hero.webp`) — swap in the real one before merging.",
    ...(opts.sourcePr ? ["", `Source request: ${opts.sourcePr}`] : []),
    "",
    "Lint (`pnpm lint:ci`) and typecheck (`pnpm typecheck`) were run against this branch before the PR was opened.",
  ].join("\n");

  if (opts.dryRun) {
    console.log(`\n[dry run] would push ${opts.branch} and open a PR on ${PORTAL_REPO} (base ${PORTAL_BRANCH}):\n`);
    console.log(`  title: ${title}\n`);
    console.log(body.replace(/^/gm, "  "));
    console.log(run(opts.portal, "git", ["status", "--short"]));
    return;
  }

  run(opts.portal, "git", ["checkout", "-B", opts.branch]);
  run(opts.portal, "git", ["add", ...touched]);
  run(opts.portal, "git", ["commit", "-m", title]);
  // The branch belongs to this automation alone, so a regenerated page simply replaces it.
  run(opts.portal, "git", ["push", "--force", "origin", `HEAD:refs/heads/${opts.branch}`]);
  const existing = run(opts.portal, "gh", ["pr", "list", "--repo", PORTAL_REPO, "--head", opts.branch, "--json", "url", "--jq", ".[0].url"], { quiet: true }).trim();
  const url =
    existing ||
    run(opts.portal, "gh", ["pr", "create", "--repo", PORTAL_REPO, "--base", PORTAL_BRANCH, "--head", opts.branch, "--title", title, "--body", body], { quiet: true }).trim();
  console.log(`${existing ? "updated" : "opened"} ${url}`);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `url=${url}\n`, { flag: "a" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
