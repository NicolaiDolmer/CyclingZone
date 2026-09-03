// #4628: skaermbilleder + chrome-foer-data-maaling af loebssiden (/races/:raceId).
// Koerer mod en koerende dev-server med VITE_PREVIEW_MOCK=1, saa appens egen
// preview-mock leverer baade auth og data. Brug:
//   node tests/e2e/4628-race-page-kit.shots.mjs <base> <outdir> <suffix>
// suffix = "before" | "after" (bruges i filnavnet, saa foer/efter kan sammenlignes).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] || "http://localhost:5304";
const OUT = resolve(process.argv[3] || ".");
const SUFFIX = process.argv[4] || "after";
mkdirSync(OUT, { recursive: true });

// EN (primaersproget), lys tilstand. Desktop 1280 + mobil 375 per #4628-briefen.
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

// race-up-1 = kommende etapeloeb (4 etaper), race-done-2 = koert etapeloeb (2 etaper).
const RACES = [
  { slug: "race-up-1", name: "upcoming" },
  { slug: "race-done-2", name: "completed" },
];

const browser = await chromium.launch();
const measurements = [];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
  });
  await page.goto("/login");
  await page.getByPlaceholder("you@email.com").fill("manager@cyclingzone.test");
  await page.getByPlaceholder("••••••••").fill("preview-mock");
  await page.getByRole("button", { name: /^Log in$/ }).click();
  await page.waitForURL(/\/(dashboard|races|$)/, { timeout: 20000 });

  for (const race of RACES) {
    await page.goto(`/races/${race.slug}`);
    await page.waitForTimeout(1400);
    // Maal: hvor mange px chrome staar der foer holdudtagelsen (kommende loeb)
    // hhv. foer foerste resultatraekke (koert loeb).
    const m = await page.evaluate(() => {
      const top = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return Math.round(el.getBoundingClientRect().top + window.scrollY);
      };
      return {
        selection: top("#race-selection-anchor"),
        firstResultRow: top("table tbody tr"),
        docHeight: Math.round(document.documentElement.scrollHeight),
        profileGraphs: document.querySelectorAll("svg[viewBox]").length,
      };
    });
    measurements.push({ viewport: vp.name, race: race.name, ...m });

    await page.screenshot({
      path: resolve(OUT, `4628-${race.name}-${vp.name}-${SUFFIX}.png`),
      fullPage: false,
    });
    console.log(`[4628] ${race.name}/${vp.name} ok`);
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(measurements, null, 2));
console.log(`[4628] Skrevet til ${OUT}`);
