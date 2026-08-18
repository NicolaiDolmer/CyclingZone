// #2849 — screenshots af dashboardet efter kvalitetssession 2-fixes
// (EmptyState/Button/ikoner/meta-canon/ProgressMeter-konvergens). Ad-hoc
// capture-script (ikke en del af CI-suiten; testMatch fanger kun *.spec.js).
// Kører mod en kørende preview/dev-server med e2e-netværksmocks.
//
//   node tests/e2e/2849-quality-dashboard-contract.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, TEST_TEAM } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 393, height: 852 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizePage(page);
  await login(page);
  await page.waitForTimeout(300); // font/paint settle
  await page.screenshot({ path: resolve(OUT, `quality-dashboard-${vp.name}.png`), fullPage: true });
  await context.close();
}

await browser.close();
console.log(`[2849] Screenshots skrevet til ${OUT} (team ${TEST_TEAM.id})`);
