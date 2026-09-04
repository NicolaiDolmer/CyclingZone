// #4748/#4487: skaermbilleder af sprint/rolling-ikon-adskillelsen + mobil-synlig
// etapetype-label. Koerer mod en koerende dev-server med VITE_PREVIEW_MOCK=1.
// Brug:
//   node tests/e2e/4748-4487-terrain-glyphs.shots.mjs <base> <outdir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] || "http://localhost:5313";
const OUT = resolve(process.argv[3] || ".");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

const browser = await chromium.launch();
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

  // race-up-1: kommende GT-etapeloeb — StageStripe viser Flat/Mountain/High
  // mountain/Time trial i traek, hvert med sit eget ikon.
  await page.goto("/races/race-up-1");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(OUT, `stage-strip-mountain-hm-tt-${vp.name}.png`) });
  console.log(`[4748] race-up-1/${vp.name} ok`);

  // race-live-1: LIVE etapeloeb med stage 3 = rolling — udtagelsens
  // StageDetailPanel viser "Rolling" med RollingIcon, adskilt fra Flat/sprint.
  await page.goto("/races/race-live-1#selection");
  await page.waitForTimeout(1200);
  // "Team selection" collapsible aabnes af #selection-hashet (defaultOpen);
  // scroll ned til etapeprofilen med Rolling-labelen.
  const rollingLocator = page.getByText("Rolling", { exact: true }).first();
  await rollingLocator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `stage-detail-rolling-${vp.name}.png`) });
  console.log(`[4748] race-live-1/${vp.name} ok`);

  await ctx.close();
}
await browser.close();
console.log(`[4748] Skrevet til ${OUT}`);
