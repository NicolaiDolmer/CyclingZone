// #8386 · Billeder af taktik på telefonen (udgave B) ved 390, lys og mørk, til ejeren før merge.
//
// Kører mod en kørende dev-server med VITE_PREVIEW_MOCK=1 (appens egen preview-mock leverer
// auth og data), løbssiden v6 (?racePageV6=on) og etapeplanen (?stagePlan=1), etape 4.
//   node tests/e2e/8386-tactics-phone.shots.mjs phone http://localhost:5188 <outdir>
// Computerens panel ved 1440 (til før/efter-sammenligningen: skal være uændret):
//   node tests/e2e/8386-tactics-phone.shots.mjs desk http://localhost:5188 <outdir> <navn>
// To billeder pixel for pixel (antal forskellige pixels; 0 = ens):
//   node tests/e2e/8386-tactics-phone.shots.mjs diff <a.png> <b.png>
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const [mode = "phone", target = "http://localhost:5188", outArg = ".", nameArg = "desk"] = process.argv.slice(2);
const RACE = process.env.SHOT_RACE || "race-live-1";
const LANG = process.env.SHOT_LANG || "en";

async function open(browser, { width, height, mobile, theme }) {
  const ctx = await browser.newContext({
    baseURL: target, viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile,
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  const page = await ctx.newPage();
  await page.addInitScript(({ lang, theme }) => {
    window.localStorage.setItem("cz_lang", lang);
    window.localStorage.setItem("cz-theme", theme);
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false, email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
  }, { lang: LANG, theme });
  await page.goto("/login");
  // Preview-mocken logger selv ind; ellers mockens egen testbruger (samme som 8297-skuddene).
  const email = page.getByPlaceholder(LANG === "da" ? "din@email.dk" : "you@email.com");
  if (await email.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
    await email.fill("manager@cyclingzone.test");
    await page.getByPlaceholder("••••••••").fill("preview-mock");
    await page.getByRole("button", { name: LANG === "da" ? /^Log ind$/ : /^Log in$/ }).click();
    await page.waitForURL(/\/(dashboard|races|$)/, { timeout: 30000 });
  }
  await page.goto(`/races/${RACE}?tab=tactics&racePageV6=on&stagePlan=1`);
  await page.locator('[data-race-page-version="v6"]').waitFor({ timeout: 30000 });
  await page.getByTestId("race-tactics-tab").first().waitFor({ timeout: 30000 });
  await page.locator('[data-race-strip] [data-stage="4"]').first().click();
  await page.waitForTimeout(1200);
  await page.waitForLoadState("networkidle").catch(() => {});
  return { ctx, page };
}

const toPanel = async (page) => {
  await page.evaluate(() => {
    const el = document.querySelector("[data-tactics-panel]");
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60);
  });
  await page.waitForTimeout(300);
};

if (mode === "diff") {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const a = readFileSync(resolve(target)).toString("base64");
  const b = readFileSync(resolve(outArg)).toString("base64");
  const result = await page.evaluate(async ({ a, b }) => {
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${src}`; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    if (x.width !== y.width || x.height !== y.height) return { size: [x.width, x.height, y.width, y.height], diff: -1 };
    const px = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const da = px(x); const db = px(y);
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) diff += 1;
    return { size: [x.width, x.height], diff };
  }, { a, b });
  console.log(`[8386] diff ${JSON.stringify(result)}`);
  await browser.close();
} else if (mode === "desk") {
  const OUT = resolve(outArg);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const { ctx, page } = await open(browser, { width: 1440, height: 1000, mobile: false, theme: "light" });
  await page.addStyleTag({ content: "[data-race-page] .sticky{position:static !important}" });
  await page.waitForTimeout(300);
  await page.locator("[data-tactics-panel]").first().screenshot({ path: resolve(OUT, `${nameArg}.png`) });
  console.log(`[8386] desk ${nameArg} ok`);
  await ctx.close();
  await browser.close();
} else {
  const OUT = resolve(outArg);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const theme of ["light", "dark"]) {
    const shot = (page, name) => page.screenshot({ path: resolve(OUT, `${name}-390-${theme === "dark" ? "moerk" : "lys"}.png`) });
    const fresh = async () => open(browser, { width: 390, height: 844, mobile: true, theme });

    // 1. Listen uden tryk: første skærm fra panelets top, og hele panelet.
    let { ctx, page } = await fresh();
    await toPanel(page);
    await shot(page, "1-liste");
    // Hele panelet som ét billede: de klæbende bjælker står på deres plads (ellers dækker fanerne listen).
    const unstick = await page.addStyleTag({ content: "[data-race-page] .sticky{position:static !important}" });
    await page.locator("[data-tactics-panel]").first().screenshot({ path: resolve(OUT, `1-liste-hele-390-${theme === "dark" ? "moerk" : "lys"}.png`) });
    await unstick.evaluate((el) => el.remove());

    // 2. All orders.
    await page.getByRole("button", { name: /^(All orders|Alle ordrer)$/ }).first().click();
    await page.waitForTimeout(400);
    await page.locator("[data-tactics-phone]").first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 140));
    await page.waitForTimeout(300);
    await shot(page, "2-all-orders");

    // 3. Sorteringsmenuen.
    await page.getByTestId("tactics-phone-sort").first().click();
    await page.waitForTimeout(300);
    await shot(page, "3-sortering");
    await page.keyboard.press("Escape");
    await ctx.close();

    // 4. Arket for én rytter (den tredje i listen).
    ({ ctx, page } = await fresh());
    await page.locator("[data-tactics-phone-rider] button[aria-haspopup=dialog]").nth(2).click();
    await page.getByTestId("tactics-phone-rider-sheet").waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    await shot(page, "4-ark");
    await ctx.close();

    // 5. Bjælken for ugemt etape: et valg på etape 4, så etape 5 i striben.
    ({ ctx, page } = await fresh());
    await page.locator("[data-tactics-phone-rider]").nth(1).getByRole("button", { name: /^(Hard|Hård)$/ }).click();
    await page.waitForTimeout(300);
    await page.locator('[data-race-strip] [data-stage="5"]').first().click();
    await page.waitForTimeout(1000);
    await toPanel(page);
    await page.evaluate(() => window.scrollBy(0, -200));
    await page.waitForTimeout(300);
    await shot(page, "5-ugemt-etape");
    await ctx.close();
    console.log(`[8386] phone ${theme} ok`);
  }
  await browser.close();
}
