// Skaermbilleder af Taktik-fanens etapeplan foer og efter troejejagten (#7855), saa ejeren
// kan se den spiller-vendte aendring foer et "koer". Kontakten er slukket i prod; preview-
// mocken viser den med `?stagePlan=1&jerseyHunt=1` (StagePlanPreviewMock.ts).
//
//   foer:  ?stagePlan=1             (som i dag: opgaverne findes ikke)
//   efter: ?stagePlan=1&jerseyHunt=1 (etape 3: en hjaelper henter point frem til stigningen)
//
// Brug:
//   npm run dev:preview --prefix frontend
//   node tests/e2e/7855-jersey-hunt.shots.ts http://localhost:5173 <outdir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = resolve(process.argv[3] || ".");
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: "desktop-en", width: 1440, height: 1000, lang: "en" },
  { name: "desktop-da", width: 1440, height: 1000, lang: "da" },
  { name: "mobile-en", width: 393, height: 852, lang: "en" },
];
const STATES = [
  { name: "foer", query: "?tab=tactics&stagePlan=1" },
  { name: "efter", query: "?tab=tactics&stagePlan=1&jerseyHunt=1" },
];

const browser = await chromium.launch();
for (const vp of SHOTS) {
  for (const state of STATES) {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.addInitScript((LANG) => {
      window.localStorage.setItem("cz_lang", LANG);
      window.localStorage.setItem("cz_consent_v1", JSON.stringify({
        version: 1, necessary: true, analytics: false, marketing: false,
        email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
      }));
    }, vp.lang);
    await page.goto("/login");
    await page.getByPlaceholder(vp.lang === "da" ? "din@email.dk" : "you@email.com").fill("manager@cyclingzone.test");
    await page.getByPlaceholder("••••••••").fill("preview-mock");
    await page.getByRole("button", { name: vp.lang === "da" ? /^Log ind$/ : /^Log in$/ }).click();
    await page.waitForURL(/\/(dashboard|races|$)/, { timeout: 20000 });
    await page.goto(`/races/race-live-1${state.query}`);
    await page.waitForTimeout(2500);
    // Aabn hjaelperens editor (rider-96), saa vaelgeren og noten kan ses.
    const row = page.locator("[data-rider-id='rider-96'], tr:has-text('rider-96')").first();
    const opener = page.getByRole("button", { name: vp.lang === "da" ? /^(Ændr|Sæt plan)$/ : /^(Change|Set plan)$/ });
    if (await row.count()) {
      const own = row.getByRole("button", { name: vp.lang === "da" ? /^(Ændr|Sæt plan)$/ : /^(Change|Set plan)$/ });
      if (await own.count()) await own.first().click();
    } else if (await opener.count()) {
      await opener.nth(Math.min(3, (await opener.count()) - 1)).click();
    }
    await page.waitForTimeout(800);
    const editor = page.getByText(vp.lang === "da" ? /Pointjagt:/ : /Going for points:/).first();
    if (await editor.count()) await editor.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(OUT, `7855-${state.name}-${vp.name}.png`), fullPage: vp.width < 600 });
    await ctx.close();
    console.log(`[7855] ${state.name} ${vp.name} ok`);
  }
}
await browser.close();
console.log(`[7855] Skrevet til ${OUT}`);
