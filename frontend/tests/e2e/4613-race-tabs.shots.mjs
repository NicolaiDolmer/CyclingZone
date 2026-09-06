// Skaermbilleder af loebssidens faner (#4613, variant A godkendt 6/9) til
// ejer-review. Afloeser 4632-intention.shots.mjs, 4093-tactics-card.shots.mjs og
// 4246-order-chain.shots.mjs: de tre flader de skoed er nu EEN fane-side, saa de
// tre scripts pegede paa testid'er der ikke findes mere.
//
// Koerer mod en koerende dev-server med VITE_PREVIEW_MOCK=1, saa appens egen
// preview-mock leverer baade auth og data. Brug:
//   node tests/e2e/4613-race-tabs.shots.mjs http://localhost:5188 <outdir>
//
// Fem tilstande — praecis dem ejeren skal doemme variant A paa:
//   a) FOER start, Hold-fanen        (race-up-1)            udtagelse + rolle + fit/form
//   b) UNDER loebet, Overblik        (race-live-1)          stilling, seneste, dagens etape
//   c) UNDER loebet, Taktik udfoldet (race-live-1)          een etape-vaelger, een guldknap
//   d) EFTER loebet, Hold-fanen      (race-done-2)          read-only rolle + placering
//   e) ENDAGSLOEB, Taktik            (race-oneday-preview)  ingen etape-vaelger
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] || "http://localhost:5188";
const OUT = resolve(process.argv[3] || ".");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "1280", width: 1280, height: 1100 },
  { name: "390", width: 390, height: 900 },
];

const LANG = process.env.SHOT_LANG || "en";

async function loginPreview(page, lang) {
  await page.addInitScript((LANG_) => {
    window.localStorage.setItem("cz_lang", LANG_);
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
  }, lang);
  await page.goto("/login");
  await page.getByPlaceholder(lang === "da" ? "din@email.dk" : "you@email.com").fill("manager@cyclingzone.test");
  await page.getByPlaceholder("••••••••").fill("preview-mock");
  await page.getByRole("button", { name: lang === "da" ? /^Log ind$/ : /^Log in$/ }).click();
  await page.waitForURL(/\/(dashboard|races|$)/, { timeout: 30000 });
}

// Hele siden, ikke et enkelt kort: fanerne ER aendringen, og en panel-crop ville
// klippe netop den stribe ejeren skal doemme.
async function shot(page, url, name, vp) {
  await page.goto(url);
  await page.getByRole("tablist").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(OUT, `impl-${name}-${vp.name}.png`), fullPage: true });
  console.log(`[4613] ${name} ${vp.name} ok`);
}

const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await loginPreview(page, LANG);

  await shot(page, "/races/race-up-1?tab=team", "before-team", vp);
  await shot(page, "/races/race-live-1?tab=overview", "during-overview", vp);

  // (c) Taktik UDFOLDET: en rytters vaelger aabnet, saa de fem trin er synlige.
  await page.goto("/races/race-live-1?tab=tactics");
  const panel = page.getByTestId("race-tactics-tab");
  await panel.waitFor({ timeout: 30000 });
  const setBtn = panel
    .getByRole("button", { name: LANG === "da" ? /^(Sæt intention|Skift)$/ : /^(Set intention|Change)$/ })
    .filter({ visible: true })
    .first();
  if (await setBtn.count()) await setBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUT, `impl-during-tactics-${vp.name}.png`), fullPage: true });
  console.log(`[4613] during-tactics ${vp.name} ok`);

  await shot(page, "/races/race-done-2?tab=team", "after-team", vp);
  await shot(page, "/races/race-oneday-preview?tab=tactics", "oneday-tactics", vp);

  await ctx.close();
}

await browser.close();
console.log(`[4613] Skrevet til ${OUT}`);
