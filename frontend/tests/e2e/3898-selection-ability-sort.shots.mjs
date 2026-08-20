// #3898 — screenshots af attribut-sortering i holdudtagelsens evne-visning
// (spillerønske: sortér på evner i race-selection, samme mønster som Rider
// Database/rosteret). Bygger på #3809's evne-toggle-script (samme mock-
// opsætning + rytterdata) og tilføjer selve sorterings-klikket: kolonne-
// header på desktop, sort-pille på mobil.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende preview/dev-server med e2e-netværksmocks.
//
//   node tests/e2e/3898-selection-ability-sort.shots.mjs [baseURL] [outDir]

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

const RACE_ID = "00000000-0000-4000-8000-000000003898";

const SCHEDULED_RACE = {
  id: RACE_ID,
  name: "E2E Mountain Stage",
  race_type: "single",
  race_class: "ProSeries",
  stages: 1,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

// Samme evne-nøgler + spredning som #3809's script, så farve-gradienten
// (statStyle) er synlig og rækkefølgen faktisk ændrer sig ved klimb-sortering.
const ABILITY_KEYS = [
  "climbing", "time_trial", "sprint", "punch", "endurance",
  "cobblestone", "acceleration", "recovery", "tactics", "positioning",
  "flat", "tempo", "durability", "aggression", "descending",
];
function abilitiesFor(i) {
  const out = {};
  ABILITY_KEYS.forEach((key, k) => { out[key] = (i * 7 + k * 5) % 99 + 1; });
  return out;
}

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
  injured: false,
  abilities: abilitiesFor(i),
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
        availableCount: 9,
      }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  const panel = page.getByTestId("race-selection-panel");
  await panel.waitFor();

  // Skift til evne-visningen først (samme klik som #3809-scriptet).
  await page.waitForTimeout(150);
  await panel.getByRole("button", { name: "Evner" }).click();
  await page.waitForTimeout(150);

  if (vp.name === "desktop") {
    // 1) uden sortering — udgangspunktet.
    await page.screenshot({ path: resolve(OUT, `3898-selection-${vp.name}-unsorted.png`), fullPage: false });

    // 2) klik CLM-kolonneheaderen — første klik = desc-først (bedst øverst).
    await panel.locator("thead th", { hasText: "CLM" }).click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(OUT, `3898-selection-${vp.name}-sorted-desc.png`), fullPage: false });

    // 3) klik samme header igen — vender til asc.
    await panel.locator("thead th", { hasText: "CLM" }).click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(OUT, `3898-selection-${vp.name}-sorted-asc.png`), fullPage: false });
  } else {
    // Mobil: sort-kontrollen er en pille-række over kortene, ikke headers.
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(OUT, `3898-selection-${vp.name}-unsorted.png`), fullPage: false });

    await panel.getByRole("button", { name: "CLM" }).click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(OUT, `3898-selection-${vp.name}-sorted-desc.png`), fullPage: false });
  }

  await context.close();
}

await browser.close();
console.log(`Screenshots -> ${OUT}`);
