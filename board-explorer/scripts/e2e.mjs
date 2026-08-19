// Browser smoke test for Board Explorer. Drives the real UI and asserts on what a user sees.
//
//   npm run dev                                    # in another terminal
//   node scripts/e2e.mjs                           # defaults to http://localhost:5183
//   node scripts/e2e.mjs https://veda-board-explorer.netlify.app
//   SHOTS=1 node scripts/e2e.mjs                   # also write screenshots to scripts/shots/
//
// Playwright is deliberately NOT a devDependency — this app's package.json stays React-only so
// `npm ci` in CI (and on Netlify) stays fast. Not wired into CI either: it needs a browser
// download and a running server, whereas the CI gate (test_generate.py + test_search.ts +
// typecheck + build) is stdlib and offline. Run this by hand before shipping a UI change.

import { mkdirSync } from "node:fs";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "playwright is not installed (on purpose — it is not a devDependency).\n" +
      "  npm i -D playwright && npx playwright install chromium\n" +
      "or run it without installing:\n" +
      "  npx --yes playwright@latest install chromium && npx --yes playwright@latest ...",
  );
  process.exit(2);
}

const BASE = process.argv[2] || "http://localhost:5183";
const SHOTS = process.env.SHOTS === "1";
if (SHOTS) mkdirSync(new URL("./shots/", import.meta.url), { recursive: true });

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// Prefer Playwright's own Chromium; fall back to an installed Google Chrome so this can be run
// without the ~150 MB browser download (`npx playwright install chromium`).
let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  if (!/Executable doesn't exist/.test(String(e))) throw e;
  console.log("note: bundled Chromium not installed — falling back to system Chrome");
  browser = await chromium.launch({ channel: "chrome" });
}
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const consoleErrors = [];
page.on("console", (m) => {
  // The three-tier loader logs a failed fetch per tier it falls through; that is the fallback
  // working, not a bug. Only unexpected errors count.
  const t = m.text();
  if (m.type() === "error" && !/Failed to load resource/.test(t)) consoleErrors.push(t);
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const shot = (name) => (SHOTS ? page.screenshot({ path: new URL(`./shots/${name}.png`, import.meta.url).pathname }) : null);
const q = () => page.locator(".search input");
const count = async () => parseInt((await page.locator(".count-strip strong").innerText()) || "0", 10);

await page.goto(BASE);
await page.waitForSelector(".count-strip", { timeout: 15000 });

// ---- it loaded something real -------------------------------------------------------
const total = await count();
check("the board loads with items", total > 0, `${total} items`);
check("the header names the board", (await page.locator(".hdr h1").innerText()).includes("Board Explorer"));
const source = await page.locator(".srcbadge").innerText();
check("the data source is reported", /live|snapshot/.test(source), source.trim());
await shot("01-table");

// ---- search narrows ------------------------------------------------------------------
await q().fill("is:open");
await page.waitForTimeout(250);
const open = await count();
check("is:open narrows the board", open > 0 && open < total, `${total} -> ${open}`);

await q().fill("is:open is:closed");
await page.waitForTimeout(250);
check("contradictory qualifiers yield nothing rather than everything", (await count()) === 0);

await q().fill("");
await page.waitForTimeout(250);
check("clearing the query restores every item", (await count()) === total);

// ---- typing and clicking stay in step ------------------------------------------------
await q().fill("is:open");
await page.waitForTimeout(250);
const chips = await page.locator(".chosen-chip").allInnerTexts();
check("a typed qualifier appears as a removable chip", chips.some((c) => c.includes("is:open")), chips.join(" | "));
check("a typed qualifier lights up its quick pill",
      (await page.locator(".pill.on").allInnerTexts()).some((t) => t.trim() === "Open"));
check("a typed qualifier marks its picker as narrowed",
      (await page.locator(".btn.narrowed").count()) > 0);

// Clicking a label chip in a row must write that qualifier into the same query string.
const labelChip = page.locator("tbody .col-labels .chip.clickable").first();
if ((await labelChip.count()) > 0) {
  const labelText = (await labelChip.innerText()).trim();
  await labelChip.click();
  await page.waitForTimeout(250);
  const typed = await q().inputValue();
  check("clicking a label writes it into the query text", typed.includes("label:"), typed);
  check("...and the label name survives quoting", typed.includes(labelText.split(" ")[0]), typed);
  const narrowed = await count();
  check("...and the result set narrows", narrowed <= open, `${open} -> ${narrowed}`);
  // Dismissing the chip must remove exactly that qualifier and leave is:open alone.
  await page.locator(`.chosen-chip:has-text("label:")`).first().click();
  await page.waitForTimeout(250);
  check("dismissing a chip removes only its own qualifier",
        (await q().inputValue()).trim() === "is:open", await q().inputValue());
}

// ---- the URL is the shareable state ---------------------------------------------------
await q().fill('is:open no:assignee');
await page.waitForTimeout(250);
const shared = page.url();
const sharedCount = await count();
check("the query round-trips through the URL", shared.includes("q="), shared);
const fresh = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await fresh.goto(shared);
await fresh.waitForSelector(".count-strip", { timeout: 15000 });
const restored = parseInt(await fresh.locator(".count-strip strong").innerText(), 10);
check("a shared link reopens the same filtered view", restored === sharedCount, `${sharedCount} vs ${restored}`);
await fresh.close();

// ---- the three views ------------------------------------------------------------------
await q().fill("is:open");
await page.waitForTimeout(250);
check("the table renders rows", (await page.locator("tbody tr").count()) > 0);

await page.locator(".viewbar .seg button").nth(1).click();
await page.waitForTimeout(300);
const lanes = await page.locator(".lane").count();
check("the assignee view renders lanes", lanes > 0, `${lanes} lanes`);
check("the assignee view caps a long lane instead of scrolling forever",
      (await page.locator(".lane").first().locator(".lane-items li").count()) <= 13);
await shot("02-assignee");

await page.locator(".viewbar .seg button").nth(2).click();
await page.waitForTimeout(300);
const bars = await page.locator(".tl-bar").count();
check("the timeline renders bars", bars > 0, `${bars} bars`);
check("the timeline draws a month axis", (await page.locator(".tl-tick").count()) > 0);
await shot("03-timeline");

await page.locator(".viewbar .seg button").nth(0).click();
await page.waitForTimeout(300);

// ---- the detail modal ------------------------------------------------------------------
await page.locator("tbody .rowbtn").first().click();
await page.waitForSelector(".modal", { timeout: 5000 });
check("clicking a row opens the detail modal", (await page.locator(".modal").count()) === 1);
check("the modal links out to GitHub", (await page.locator(".modal .open-gh").count()) === 1);
await shot("04-modal");
await page.locator(".modal-x").click();
await page.waitForTimeout(200);
check("the modal closes", (await page.locator(".modal").count()) === 0);

// ---- theme ------------------------------------------------------------------------------
const readTheme = () =>
  page.evaluate(() => {
    const chip = document.querySelector(".col-labels .chip");
    return {
      theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.body).backgroundColor,
      chipBg: chip ? getComputedStyle(chip).backgroundColor : null,
      chipFg: chip ? getComputedStyle(chip).color : null,
    };
  });

const dark = await readTheme();
await page.locator(".hdr-right .iconbtn").click();
await page.waitForTimeout(200);
const light = await readTheme();
check("the theme toggle flips the mode", dark.theme !== light.theme, `${dark.theme} -> ${light.theme}`);
check("chrome adapts to the theme", dark.bg !== light.bg, `${dark.bg} -> ${light.bg}`);
check("a label's HUE is data and must not change with the theme",
      dark.chipBg === light.chipBg, `${dark.chipBg} vs ${light.chipBg}`);
check("...while its text lightness does adapt, so it stays legible",
      dark.chipFg !== light.chipFg, `${dark.chipFg} vs ${light.chipFg}`);
await shot("05-light");
await page.locator(".hdr-right .iconbtn").click();

// ---- avatars actually decoded ------------------------------------------------------------
const avatarOk = await page.evaluate(() => {
  const img = document.querySelector(".avatar img");
  return img ? img.naturalWidth > 0 : "no-avatars";
});
check("assignee avatars decode (not broken images)", avatarOk === true || avatarOk === "no-avatars", String(avatarOk));

check("no unexpected console/page errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
