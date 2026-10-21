#!/usr/bin/env node
// End-to-end check of the Algorithm Catalog against a RUNNING site — dev server, deploy preview,
// or production. Drives real Chromium via Playwright and asserts on what a user actually sees.
//
//   npm run dev                                    # in another terminal
//   node scripts/e2e.mjs                           # defaults to http://localhost:5173
//   node scripts/e2e.mjs https://veda-algorithm-catalog.netlify.app
//   SHOTS=1 node scripts/e2e.mjs                   # also write screenshots to scripts/shots/
//
// Playwright is deliberately NOT a devDependency — this app's package.json stays at React +
// ReactDOM only so `npm ci` in CI (and Netlify) stays fast. Install it on demand:
//
//   npx -y playwright@latest install chromium && npx -y playwright@latest ...
//   # or, once: npm i -g playwright && npx playwright install chromium
//
// Exit 0 = all checks passed, 1 = at least one failed. Not wired into CI: it needs a browser
// download and a running server, whereas the CI gate (validate_data.py + rules_parity_test.py +
// typecheck + build) is stdlib/offline. Run this by hand before shipping a UI change.

import { mkdirSync } from "node:fs";

// Resolved at run time, not imported statically, so a missing Playwright prints instructions
// instead of an ERR_MODULE_NOT_FOUND stack trace. It is not a devDependency on purpose (see above).
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright is not installed (deliberately — it is not a devDependency of this app).\n\n" +
      "Install it once, globally, then re-run:\n" +
      "  npm i -g playwright && npx playwright install chromium\n\n" +
      "Or run this script from a directory that has playwright installed:\n" +
      "  npm i playwright && npx playwright install chromium\n" +
      "  node <path-to>/algorithm-catalog/scripts/e2e.mjs [baseUrl]",
  );
  process.exit(2);
}

const BASE = (process.argv[2] || "http://localhost:5173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS ? new URL("./shots/", import.meta.url).pathname : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const shot = async (page, name) =>
  SHOTS && page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });

console.log(`Algorithm Catalog e2e — ${BASE}\n`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

// A React crash surfaces here first, so collect and assert on it at the end.
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: "networkidle" });
await shot(page, "01-landing");

// --- 1. Shell: three tabs, in the order the app is meant to be used --------------------------
const tabs = (await page.locator('[role="tab"], .hub-tabs button, nav button').allInnerTexts())
  .map((t) => t.trim().replace(/\s+/g, " "))
  .filter(Boolean);
check("three major tabs render", tabs.length >= 3, tabs.slice(0, 3).join(" | "));
check(
  "tab order = Submit, Events, Algorithms",
  /submit/i.test(tabs[0] || "") && /event/i.test(tabs[1] || "") && /algorithm/i.test(tabs[2] || ""),
);

// --- 2. Algorithms tab ------------------------------------------------------------------------
await page.locator("button", { hasText: /algorithm/i }).first().click();
await page.waitForTimeout(400);
await shot(page, "02-algorithms");

const cards = await page.locator(".acard").count();
check("algorithm cards render", cards >= 8, `${cards} cards`);

// naturalWidth > 0 is the only honest proof an <img> actually decoded — a 200 on the URL does
// not mean the browser rendered it.
const thumbs = (
  await page.locator("img").evaluateAll((els) =>
    els.map((e) => ({ src: e.getAttribute("src") || "", w: e.naturalWidth })),
  )
).filter((i) => i.src.includes("/thumbs/"));
check(
  "thumbnails actually load (naturalWidth > 0)",
  thumbs.length > 0 && thumbs.every((t) => t.w > 0),
  `${thumbs.filter((t) => t.w > 0).length}/${thumbs.length} loaded`,
);

const search = page.locator('.search input, input[type="search"]').first();
check("Algorithms tab has a search bar", (await search.count()) > 0);
if (await search.count()) {
  await search.fill("umbra");
  await page.waitForTimeout(350);
  const after = await page.locator(".acard").count();
  check("search narrows the catalog", after > 0 && after < cards, `${cards} -> ${after}`);
  await shot(page, "03-search");
  await search.fill("");
  await page.waitForTimeout(300);
}

// --- 3. Events tab ------------------------------------------------------------------------------
await page.locator("button", { hasText: /event/i }).first().click();
await page.waitForTimeout(400);
await shot(page, "04-events");
const body = await page.locator("body").innerText();
check(
  "all 3 seed events listed",
  /California Wildfires/i.test(body) && /Venezuela Earthquake/i.test(body) && /Sinlaku/i.test(body),
);
check(
  "Events tab has a search bar",
  (await page.locator('.search input, input[type="search"]').count()) > 0,
);

// --- 4. Submit tab: THE STANDARD is enforced live -----------------------------------------------
await page.locator("button", { hasText: /submit/i }).first().click();
await page.waitForTimeout(400);
await shot(page, "05-submit");

const stacInput = page.locator('input[id*="stac" i], input[name*="stac" i]').first();

async function typeStac(v) {
  await stacInput.fill(v);
  await stacInput.blur().catch(() => {});
  await page.waitForTimeout(300);
}

// Each of these MUST surface an error. The two 3-underscore cases are the whole reason this app's
// rule is stricter than upstream's — 202501_Tropical_Cyclone_CA passes upstream while silently
// parsing as hazard "Tropical", and 202501_Flood_CA_extra is an explicit upstream PASS case.
for (const [value, why] of [
  ["202513_Fire_CA", "month 13"],
  ["202501_Tropical_Cyclone_CA", "3 underscores — upstream accepts, we must not"],
  ["202501_Flood_CA_extra", "3 underscores — explicit upstream pass case"],
  ["202501_Fire", "1 underscore"],
  ["YYYYMM_Hazard_Location", "the placeholder"],
]) {
  await typeStac(value);
  const txt = await page.locator("body").innerText();
  check(
    `rejects ${value} (${why})`,
    /underscore|month|placeholder|YYYYMM_Hazard_Location|must be/i.test(txt),
  );
}
await shot(page, "06-submit-invalid");

const prBtn = page
  .locator("button, a")
  .filter({ hasText: /open pr|submit pr|add to request/i })
  .first();
if (await prBtn.count()) {
  check(
    "submit blocked while the name is invalid",
    await prBtn.evaluate(
      (el) =>
        el.hasAttribute("disabled") ||
        el.getAttribute("aria-disabled") === "true" ||
        getComputedStyle(el).pointerEvents === "none" ||
        parseFloat(getComputedStyle(el).opacity) < 0.6,
    ),
  );
}

await typeStac("202501_Fire_CA");
check(
  "accepts 202501_Fire_CA",
  !/exactly 2 underscores|is not 01-12|placeholder/i.test(await page.locator("body").innerText()),
);
await shot(page, "07-submit-valid");

// --- 5. Locations at any level of interest: Alabama → Montgomery, Alabama → back ----------------
await page.goto(BASE, { waitUntil: "networkidle" });
const placeSearch = page.locator('input[aria-label="Search places"]');
const bbox = page.locator("#req-bbox");
const pickPlace = async (label) => {
  await page.locator(".req-picker-row", { hasText: new RegExp(`^＋${label}`) }).first().click();
  await page.waitForTimeout(200);
};
await placeSearch.fill("Los Angeles");
await page.waitForTimeout(800); // first search pulls in the lazy city chunk
const laRows = await page.locator(".req-picker-row").allInnerTexts();
check(
  "“Los Angeles” lists the county and the city separately",
  laRows.some((t) => /Los Angeles County, California\s*county/i.test(t)) &&
    laRows.some((t) => /Los Angeles, California\s*city/i.test(t)),
  laRows.slice(0, 3).join(" | ").replace(/\s+/g, " "),
);
await placeSearch.fill("Alabama");
await page.waitForTimeout(300);
await pickPlace("Alabama");
const alBox = await bbox.inputValue();
check("picking Alabama fills its bbox", alBox === "-88.474,30.223,-84.889,35.009", alBox);
await page.locator(".place-chip", { hasText: "Alabama" }).locator("button", { hasText: "Narrow" }).click();
await page.locator('input[aria-label="Filter places inside"]').fill("Montgomery");
await page.waitForTimeout(300);
await pickPlace("Montgomery, Alabama");
const chips = await page.locator(".place-chip").allInnerTexts();
const mgBox = await bbox.inputValue();
check("Narrow replaces Alabama with Montgomery, Alabama", chips.length === 1 && /Montgomery, Alabama/.test(chips[0]), chips.join(" | "));
check("…and the bbox shrinks to the city", mgBox === "-86.443,32.22,-86.069,32.438" || mgBox.startsWith("-86.443,"), mgBox);
await shot(page, "08-places-narrow");
await page.locator(".place-chip").locator("button", { hasText: /Broaden to Alabama/ }).click();
await page.waitForTimeout(200);
check("Broaden goes back up to the state", (await bbox.inputValue()) === alBox);
await bbox.fill("-87,32,-86,33");
await placeSearch.fill("Georgia");
await page.waitForTimeout(300);
await pickPlace("Georgia");
check("a hand-typed bbox is never overwritten", (await bbox.inputValue()) === "-87,32,-86,33");

// --- 6. Event page: preview in Events, edit in Submit, and the PR carries the page --------------
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator("button", { hasText: /event/i }).first().click();
await page.waitForTimeout(300);
check("imported events are listed (8)", (await page.locator(".ecard").count()) === 8);
check(
  "an event with no end date reads as ongoing",
  /9 Oct 2026 – ongoing/.test(await page.locator(".ecard", { hasText: "Hurricane Isaias" }).innerText()),
);
await page.locator('input[type="date"]').first().fill("2026-10-15");
await page.waitForTimeout(300);
check(
  "an ongoing event still matches a later date filter",
  (await page.locator(".ecard", { hasText: "Hurricane Isaias" }).count()) === 1,
);
await page.locator("button", { hasText: "Reset" }).click();
await page.locator(".ecard", { hasText: "Hurricane Isaias October 2026" }).click();
await page.locator('[role="tab"]', { hasText: "Page preview" }).click();
const preview = await page.locator(".overlay .pp").innerText();
check(
  "Page preview follows the portal's section order",
  /Hurricane Isaias October 2026[\s\S]*PUBLISHED:[\s\S]*Type[\s\S]*Region[\s\S]*Start Date[\s\S]*Overview/i.test(preview),
);
await shot(page, "09-page-preview");
await page.locator("button", { hasText: "Edit page" }).click();
await page.waitForTimeout(400);
check("Edit page opens Submit prefilled", (await page.locator("#req-name").inputValue()) === "Hurricane Isaias October 2026");
check("…with the event's places as chips", (await page.locator(".place-chip").count()) === 2);
check("…and the end date blank (optional — ongoing)", (await page.locator("#req-end").inputValue()) === "");
await page.locator("#req-subtitle").fill('As Hurricane Isaias made landfall, NASA "activated" to support FEMA.');
await page.locator("button.req-haz", { hasText: /^Respond$/ }).click();
await page.locator("#req-intro").fill("Hurricane Isaias brought storm surge to Florida and Alabama.\n\nNASA is sharing maps.");
await page.locator("#req-govlink").fill("https://www.fema.gov/disaster/hurricane-isaias");
await page.locator("button", { hasText: "Add products" }).click();
await page.locator(".req-picker-row", { hasText: "True color" }).first().click();
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const review = await page.locator(".req-form").innerText();
const live = page.locator(".req-live .pp");
check("the live portal preview is docked beside the form", (await live.count()) === 1);
check(
  "…and updates as you type (sub-title, Need, intro)",
  // curly, exactly as the generated portal file will carry it — not the straight quotes typed
  (await live.locator(".pp-hero p").innerText()).includes("NASA “activated” to support FEMA") &&
    (await live.locator(".pp-meta").innerText()).includes("RESPOND") &&
    (await live.locator(".pp-main").innerText()).includes("Hurricane Isaias brought storm surge"),
);
check(
  "…and shows the REAL portal gallery card for the product",
  (await live.locator(".pp-card h3").allInnerTexts()).includes("Landsat True Color Imagery") &&
    (await live.locator(".pp-card img").first().evaluate((i) => i.complete && i.naturalWidth > 0)),
);
check("Review shows the portal file path", /app\/site-config\/event\/event__hurricane-isaias-oct-2026\.ts/.test(review));
const portalSrc = await page.locator(".req-whatruns pre.urlbox").last().textContent();
check("portal file uses curly quotes (Biome-safe)", portalSrc.includes("NASA “activated”") && !portalSrc.includes('\\"'));
await shot(page, "10-edit-page");
await page.evaluate(() => {
  window.__opened = [];
  window.open = (u) => (window.__opened.push(u), null);
});
await page.locator("button", { hasText: "Open PR" }).click();
const opened = await page.evaluate(() => window.__opened[0] || "");
const doc = opened ? JSON.parse(new URL(opened).searchParams.get("value"))[0] : {};
check(
  "Open PR carries the page + places in the request file",
  doc.page?.intro?.startsWith("Hurricane Isaias") &&
    doc.page?.needs?.[0] === "respond" &&
    doc.event?.places?.length === 2 &&
    !("end" in (doc.event ?? {})),
  opened ? new URL(opened).searchParams.get("filename") : "no window.open",
);

check("no console/page errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" ¶ "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
