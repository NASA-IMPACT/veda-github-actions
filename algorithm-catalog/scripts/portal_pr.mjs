#!/usr/bin/env node
// Turn catalog requests that carry an event page into a PR on the Disasters Portal
// (Disasters-Learning-Portal/disasters-portal). Run by .github/workflows/algorithm-catalog-portal-pr.yml
// on every request PR here; runnable by hand with --dry-run against any portal checkout.
//
//   node algorithm-catalog/scripts/portal_pr.mjs --portal <checkout> --branch <name> \
//        [--title <pr title>] [--source-pr <url>] [--dry-run] <request.json>...
//
// For each request with a `page`, in the portal checkout:
//   0. download its Google Drive images into public/img/event/ (hero + overview), sniffing the bytes
//      — a file that isn't shared "Anyone with the link" comes back as an HTML page, not an image
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PORTAL_BRANCH, PORTAL_MARKER, PORTAL_REPO, portalEventFile } from "../src/portal.ts";
import { driveFileId } from "../src/rules.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "data");
const INDEX = "app/site-config/event/index.ts";
const IMG_DIR = "public/img/event";
// Overridable so the download path can be tested against a local server.
const DRIVE_DOWNLOAD = process.env.DRIVE_DOWNLOAD_URL ?? "https://drive.usercontent.google.com/download?export=download&id=";
/** The portal's own event images are a few hundred KB; anything this big needs compressing first. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Format + pixel size from the file's own bytes (the portal's `image` block needs width/height).
 * Returns null for anything that is not a PNG, JPEG, WebP or GIF — e.g. Drive's HTML sign-in page.
 */
export function sniffImage(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { ext: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString("latin1", 0, 3) === "GIF") return { ext: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8 ") return { ext: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { ext: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { ext: "webp", width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length && b[o] === 0xff) {
      const marker = b[o + 1];
      // SOF0-3, 5-7, 9-11, 13-15 carry the frame size; everything else is skipped by its length.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { ext: "jpg", width: b.readUInt16BE(o + 7), height: b.readUInt16BE(o + 5) };
      }
      o += 2 + b.readUInt16BE(o + 2);
    }
  }
  return null;
}

/** Download one page image into the portal checkout. Returns the resolved image or a reason. */
async function downloadImage(portal, id, img, n) {
  const fileId = driveFileId(img.url);
  if (!fileId) return { error: "not a Google Drive file link" };
  let bytes;
  try {
    const res = await fetch(DRIVE_DOWNLOAD + encodeURIComponent(fileId), { redirect: "follow" });
    if (!res.ok) return { error: `Drive answered HTTP ${res.status} — is it shared “Anyone with the link”?` };
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { error: `download failed (${e.message})` };
  }
  const kind = sniffImage(bytes);
  if (!kind) return { error: "Drive returned a page, not an image — set its sharing to “Anyone with the link”" };
  if (bytes.length > MAX_IMAGE_BYTES) return { error: `${(bytes.length / 1048576).toFixed(1)} MB — compress it under 8 MB` };
  const name = img.placement === "hero" ? `${id}__hero.${kind.ext}` : `${id}__overview-${n}.${kind.ext}`;
  mkdirSync(join(portal, IMG_DIR), { recursive: true });
  writeFileSync(join(portal, IMG_DIR, name), bytes);
  return { image: { ...img, src: `/img/event/${name}`, width: kind.width, height: kind.height }, path: `${IMG_DIR}/${name}` };
}

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

async function main() {
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
  const imageFiles = [];
  const imageFailures = [];
  for (const r of requests) {
    const input = { ...r.event, layers: r.products.map(({ algorithm, product }) => ({ algorithm, product })), page: r.page };
    const f0 = portalEventFile(input, algorithms, hazards, today);
    const target = join(opts.portal, f0.path);
    // Hand-written pages are often .tsx (they embed JSX), so check BOTH extensions — and treat a
    // page already registered in index.ts under this constant as existing too.
    const existing = [target, target.replace(/\.ts$/, ".tsx")].find(existsSync);
    const registered = new RegExp(`\\b${f0.constName}\\b`).test(readFileSync(join(opts.portal, INDEX), "utf8"));
    if ((existing && !readFileSync(existing, "utf8").startsWith(PORTAL_MARKER)) || (registered && !existing)) {
      skipped.push(
        `${f0.id} already exists on the portal and was written by hand — not overwritten. Edit it there directly.`,
      );
      continue;
    }
    // Images first: the page file's blocks need each one's real path and pixel size.
    const resolved = [];
    let n = 0;
    for (const img of r.page.images ?? []) {
      const got = await downloadImage(opts.portal, f0.id, img, img.placement === "overview" ? ++n : 0);
      if (got.image) {
        resolved.push(got.image);
        imageFiles.push(got.path);
        console.log(`image ${got.path} (${got.image.width}×${got.image.height})`);
      } else {
        imageFailures.push(`${r.event.name} — ${img.placement} image ${img.url}: ${got.error}`);
        console.log(`image FAILED ${img.url}: ${got.error}`);
      }
    }
    const f = portalEventFile(input, algorithms, hazards, today, resolved);
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
  touched.push(...imageFiles); // committed, but not Biome's business
  run(opts.portal, "pnpm", ["lint:ci"]);
  run(opts.portal, "pnpm", ["typecheck"]);
  console.log("portal lint:ci + typecheck passed");

  const title = opts.title ?? `Event page: ${written.map((w) => w.name).join(", ")}`;
  const body = [
    "Event page(s) generated by the VEDA Algorithm Catalog from an activation request.",
    "",
    ...written.map((w) => `- **${w.name}** (\`${w.stacName}\`) → \`${w.path}\`${w.unmapped.length ? ` — no data-gallery card yet for: ${w.unmapped.join(", ")}` : ""}`),
    "",
    ...(imageFiles.length ? [`Images downloaded from Google Drive: ${imageFiles.map((p) => `\`${p}\``).join(", ")}.`] : []),
    ...(imageFailures.length
      ? ["", "⚠ **Could not download these images** — they are listed in the page file as a comment; add them by hand:", ...imageFailures.map((m) => `- ${m}`)]
      : []),
    ...(written.some((w) => w.source.includes("template-hero.webp"))
      ? ["", "Pages without a hero image use the portal's placeholder (`/img/event/template-hero.webp`) — swap in the real one before merging."]
      : []),
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

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
