// #4943 — bevis-screenshots for sticky progress-linje-fixet (bg-cz-bg -> bg-cz-body
// + hairline). Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger
// kun *.spec.js) — samme mønster som 4943-survey.shots.mjs.
//
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 4643 --strictPort &
//   node tests/e2e/4943-sticky-progress.shots.mjs http://127.0.0.1:4643 <ud-mappe>

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { installSurveyRoutes } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/surveyMock.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:4643";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));
const SLUG = "2026-09-features";

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function capture(theme) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await context.addInitScript((t) => {
    try { window.localStorage.setItem("cz-theme", t); } catch { /* ignore */ }
  }, theme);
  const page = await context.newPage();
  await installNetworkMocks(page);
  await installSurveyRoutes(page, {});
  await stabilizePage(page);
  await login(page);
  await page.goto(`/survey/${SLUG}`);
  await page.getByRole("progressbar").waitFor();

  // Scroll midt i skemaet, så progress-linjen er klæbende OVER et rigtigt
  // tekstfelt (fritekst-spørgsmål "works_worst_detail", #30 i seedet) — det
  // var netop et tekstfelt der skinnede igennem i bug-screenshottet.
  await page.locator("#survey-works_worst_detail").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);

  await page.screenshot({ path: resolve(OUT, `sticky-progress-${theme}-375.png`) });
  await context.close();
}

await capture("light");
await capture("dark");

await browser.close();
console.log(`[4943] Sticky-progress screenshots skrevet til ${OUT}`);
