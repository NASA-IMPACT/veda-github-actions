#!/usr/bin/env node
// Interactive scaffold for a new catalog entry.
//   npm run new-entry
// Writes src/content/catalog/<slug>.mdx with valid frontmatter. Requires at least one
// limitation up front, mirroring the schema's `limitations.min(1)` rule so contributors
// can't skip it locally either.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep in sync with ENTRY_TYPES in src/content.config.ts
const ENTRY_TYPES = ["Web app", "Reference", "GitHub Action", "Generator"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rl = createInterface({ input: stdin, output: stdout });

const slugify = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function ask(q, { required = true } = {}) {
  while (true) {
    const a = (await rl.question(q)).trim();
    if (a || !required) return a;
    stdout.write("  ↳ required.\n");
  }
}

try {
  const title = await ask("Title: ");

  stdout.write(`Types: ${ENTRY_TYPES.map((t, i) => `${i + 1}=${t}`).join("  ")}\n`);
  let type;
  while (!type) {
    const raw = await ask("Type (number or exact name): ");
    type = /^\d+$/.test(raw) ? ENTRY_TYPES[Number(raw) - 1] : ENTRY_TYPES.find((t) => t === raw);
    if (!type) stdout.write("  ↳ pick a valid type.\n");
  }

  const description = await ask("Description (one line, <=280 chars): ");
  const repo = await ask("Source URL (https://github.com/…): ");
  const homepage = await ask("Live URL (optional, blank to skip): ", { required: false });
  const tagsRaw = await ask("Tags (comma-separated): ", { required: false });
  const author = (await ask("Author (blank = NASA VEDA): ", { required: false })) || "NASA VEDA";

  const devText = await ask("Developer's suggestion (optional, blank to skip): ", {
    required: false,
  });
  const devAlias = devText
    ? await ask("  alias snippet (optional, e.g. alias foo='…'): ", { required: false })
    : "";

  // Require at least one limitation.
  const limitations = [];
  stdout.write("Limitations / risks — at least one is required. Blank line to finish.\n");
  while (true) {
    const l = (await rl.question(`  limitation #${limitations.length + 1}: `)).trim();
    if (!l) {
      if (limitations.length >= 1) break;
      stdout.write("  ↳ you must acknowledge at least one limitation or risk.\n");
      continue;
    }
    limitations.push(l);
  }

  const slug = slugify(title);
  const tags = tagsRaw
    ? tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const today = new Date().toISOString().slice(0, 10);
  const yaml = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

  const fm = [
    "---",
    `title: ${yaml(title)}`,
    `description: ${yaml(description)}`,
    `type: ${yaml(type)}`,
    `tags: [${tags.map(yaml).join(", ")}]`,
    "limitations:",
    ...limitations.map((l) => `  - ${yaml(l)}`),
    `repo: ${yaml(repo)}`,
    ...(homepage ? [`homepage: ${yaml(homepage)}`] : []),
    ...(devText
      ? [
          "devSuggestion:",
          `  text: ${yaml(devText)}`,
          ...(devAlias ? [`  alias: ${yaml(devAlias)}`] : []),
        ]
      : []),
    `author: ${yaml(author)}`,
    `dateAdded: ${today}`,
    "featured: false",
    "---",
    "",
    "## What it does",
    "",
    "Describe the app here.",
    "",
    "## Where the data comes from",
    "",
    "Runtime fetch from a branch, bundled at build, or hand-curated?",
    "",
    "## Run it locally",
    "",
    "```bash",
    "# steps",
    "```",
    "",
  ].join("\n");

  const dest = resolve(root, "src/content/catalog", `${slug}.mdx`);
  try {
    await access(dest);
    stdout.write(`\n✗ ${slug}.mdx already exists — aborting.\n`);
    process.exitCode = 1;
  } catch {
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, fm, "utf8");
    stdout.write(`\n✓ Created src/content/catalog/${slug}.mdx\n`);
    stdout.write("  Edit the body, then run `npm run build` to validate.\n");
  }
} finally {
  rl.close();
}
