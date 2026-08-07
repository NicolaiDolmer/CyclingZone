// #3520 — screenshots af holdudtagelsens nye rytterprofil-popup (navneklik åbner
// profil i stedet for at vælge rytteren; checkboxen er eneste vælger).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun *.spec.js).
// Kører mod en kørende preview/dev-server med e2e-netværksmocks. Genbruger samme
// mock-opsætning som race-selection.spec.js (scheduled løb + 9 ryttere, rider-8 skadet).
//
//   node tests/e2e/race-selection-rider-popup.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const RACE_ID = "00000000-0000-4000-8000-000000001307";

const SCHEDULED_RACE = {
  id: RACE_ID,
  name: "E2E Classic",
  race_type: "single",
  race_class: "ProSeries",
  stages: 1,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

const SELECTION_RIDERS = Array.from({ length: 9 }, (_, i) => ({
  id: `sel-r${i}`,
  name: `Rider ${i}`,
  primaryType: "climber",
  secondaryType: null,
  suitability: 70 - i,
  aggression: 42 + i,
  tactics: 38 + i,
  form: 55,
  fatigue: 10,
  injured: i === 8,
}));

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
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

  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? SCHEDULED_RACE : [SCHEDULED_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));
  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        race: SCHEDULED_RACE,
        size: { min: 6, max: 8 },
        selection: null,
        riders: SELECTION_RIDERS,
        availableCount: 8,
      }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  const panel = page.getByTestId("race-selection-panel");
  await panel.waitFor();

  // ── 1) Udtagelsen uden popup (baseline — checkboxen er den synlige vælger). ─────
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(OUT, `3520-selection-${vp.name}-baseline.png`), fullPage: false });

  // ── 2) Klik på et rytternavn — profil-popup åbner. ──────────────────────────────
  await panel.getByRole("button", { name: /Rider 1/ }).click();
  const modal = page.getByTestId("rider-mini-profile-modal");
  await modal.waitFor();
  await page.waitForTimeout(200); // font/paint settle
  await page.screenshot({ path: resolve(OUT, `3520-selection-${vp.name}-popup-open.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots -> ${OUT}`);
