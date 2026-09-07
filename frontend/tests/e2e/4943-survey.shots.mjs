// #4943 — screenshots af det in-app spørgeskema. Ad-hoc capture-script (ikke en
// del af CI-suiten; testMatch fanger kun *.spec.js) — samme mønster som
// 3941-race-control-banner.shots.mjs.
//
// Data kommer fra src/preview/surveyMock.js, som BEVIDST ikke serveres af
// mockHandlers som default (et åbent skema ville vise dashboard-kortet i alle
// siders visuelle snapshots). Scriptet overlejrer selv sine routes; routes
// registreret EFTER installNetworkMocks vinder i Playwright.
//
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 4643 --strictPort &
//   node tests/e2e/4943-survey.shots.mjs http://127.0.0.1:4643 <ud-mappe>

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

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "375", width: 375, height: 812 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function openPage(vp, surveyOptions) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await installSurveyRoutes(page, surveyOptions);
  await stabilizePage(page);
  await login(page);
  return { context, page };
}

for (const vp of VIEWPORTS) {
  // 1. Intro + progress-linjen + de første spørgsmål.
  {
    const { context, page } = await openPage(vp, {});
    await page.goto(`/survey/${SLUG}`);
    await page.getByRole("progressbar").waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(OUT, `4943-intro-${vp.name}.png`) });

    // 2. To-akse-sektionen, med et par rækker udfyldt så begge akser ses i brug.
    const idea = page.getByRole("radiogroup", { name: /^Idé: / }).first();
    await idea.getByRole("radio").nth(4).click();
    const importance = page.getByRole("radiogroup", { name: /^Vigtigt: / }).first();
    await importance.getByRole("radio").nth(3).click();
    await page.getByRole("checkbox", { name: /^Ingen mening om / }).nth(1).check();
    await page.getByRole("heading", { name: "Idéerne" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(OUT, `4943-two-axes-${vp.name}.png`) });
    await context.close();
  }

  // 3. Tak-siden.
  {
    const { context, page } = await openPage(vp, { completed: true });
    await page.goto(`/survey/${SLUG}`);
    await page.getByRole("heading", { name: "Tak" }).waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(OUT, `4943-thanks-${vp.name}.png`) });
    await context.close();
  }

  // 4. Dashboard-kortet.
  {
    const { context, page } = await openPage(vp, {});
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Svar nu" }).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(OUT, `4943-dashboard-card-${vp.name}.png`) });
    await context.close();
  }
}

await browser.close();
console.log(`[4943] Screenshots skrevet til ${OUT}`);
