// #3941 — screenshots af Race Control driftsbanneret + Hjælp-sidens "Kendte
// problemer"-liste. Ad-hoc capture-script (ikke en del af CI-suiten;
// testMatch fanger kun *.spec.js) — samme mønster som
// 3811-patchnotes-unread-dot.shots.mjs. Data kommer fra
// frontend/src/preview/seedData.js (SEED_OPS_NOTICES) via installNetworkMocks
// → mockHandlers.js's "ops_notices"-case, saa scriptet virker mod en almindelig
// dev/preview-server uden en rigtig Supabase-forbindelse.
//
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 4636 --strictPort &
//   node tests/e2e/3941-race-control-banner.shots.mjs http://127.0.0.1:4636

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, TEST_TEAM } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { SEED_OPS_NOTICES } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/seedData.js")).href
);

// mockHandlers' "ops_notices"-case er BEVIDST tom (en aktiv notice ville vise
// banneret i alle siders snapshots). Dette script overlejrer derfor sit eget
// route-svar; routes registreret EFTER installNetworkMocks vinder i Playwright.
async function overlayOpsNotices(page) {
  await page.route(/\/rest\/v1\/ops_notices/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SEED_OPS_NOTICES),
    })
  );
}

const BASE = process.argv[2] || "http://127.0.0.1:4636";
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
  await overlayOpsNotices(page);
  await stabilizePage(page);
  await login(page);

  // Driftsbanneret er ikke-kritisk UI og fejler stille ved en hente-fejl — vent
  // eksplicit på regionen i stedet for et fast timeout, saa scriptet ikke
  // kapper et langsomt preview-server-first-paint.
  await page.getByRole("region", { name: "Driftsstatus" }).waitFor();
  await page.waitForTimeout(150); // paint settle (StatusBadge/ikon-fonte)
  await page.screenshot({ path: resolve(OUT, `3941-banner-${vp.name}.png`) });

  await context.close();
}

// "Kendte problemer" — kun desktop (samme deep-link som banneret linker til).
{
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await overlayOpsNotices(page);
  await stabilizePage(page);
  await login(page);

  await page.goto("/help?section=knownIssues");
  await page.getByRole("heading", { name: "Kendte problemer" }).first().waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, "3941-known-issues-desktop.png") });

  await context.close();
}

await browser.close();
console.log(`[3941] Screenshots skrevet til ${OUT} (team ${TEST_TEAM.id})`);
