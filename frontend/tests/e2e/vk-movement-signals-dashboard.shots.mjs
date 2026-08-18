// vk-movement-signals — screenshots af dashboardets "My division
// standings"-modul med de nye bevægelses-signaler (divisionsplacering + "+86"
// holdpoint siden sidste løbsdag). Ad-hoc capture-script (ikke en del af
// CI-suiten; testMatch fanger kun *.spec.js). Kører mod en kørende preview-
// server med e2e-netværksmocks.
//
//   node tests/e2e/vk-movement-signals-dashboard.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, TEST_TEAM } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:4649";
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
  // "My division standings" ligger i hoved-grid'en — scroll den i view før capture.
  // stabilizePage låser sproget til DA, så titlen rendres som "... · Stilling".
  const standingsHeading = page.getByText(/Stilling$|Standings$/).first();
  await standingsHeading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300); // font/paint settle
  await page.screenshot({ path: resolve(OUT, `vk-movement-signals-dashboard-standings-${vp.name}.png`), fullPage: true });
  await context.close();
}

await browser.close();
console.log(`[vk-movement-signals] Dashboard-screenshots skrevet til ${OUT} (team ${TEST_TEAM.id})`);
