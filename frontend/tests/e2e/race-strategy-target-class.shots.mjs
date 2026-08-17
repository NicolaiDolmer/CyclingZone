// #3807 — screenshots af løbsklassen i Holdstrategi-fladens mål-løb-vælger
// (TargetRacePicker.jsx). Klassen viste tidligere kun terræn-bucket; spilleren
// måtte slå løbsklassen op et andet sted for at vurdere om løbet var værd at
// peake til.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun *.spec.js).
// Kører mod en kørende preview/dev-server med e2e-netværksmocks. Genbruger
// samme STRATEGY-mock som race-strategy.spec.js.
//
//   node tests/e2e/race-strategy-target-class.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:4565";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const ROSTER = Array.from({ length: 8 }, (_, i) => ({
  id: `r${i}`,
  name: `Rider ${i}`,
  primaryType: null,
  secondaryType: null,
  overall: 70 - i * 2,
  suitabilities: { flat: 80 - i * 3, hilly: 60 - i * 2, mountain: 40 + i * 4, cobbles: 50, itt: 55 },
}));

const STRATEGY = {
  enabled: true,
  roster: ROSTER,
  a_chain: ["r0", "r1"],
  captain_priorities: { mountain: ["r2"] },
  role_rules: { r3: "always_captain" },
  target_race_ids: ["race-a"],
  upcoming: [
    { id: "race-a", name: "Hamburger Klassiker", race_class: "ProSeries", status: "scheduled", stages: 1, stages_completed: 0, bucket: "flat", is_target: true },
    { id: "race-b", name: "La Corsa dei Due Mari", race_class: "OtherWorldTourA", status: "scheduled", stages: 7, stages_completed: 0, bucket: "mountain", is_target: false },
    { id: "race-c", name: "Amstel Gold Race", race_class: "Monuments", status: "scheduled", stages: 1, stages_completed: 0, bucket: "hilly", is_target: false },
  ],
};

async function mockStrategy(page) {
  await page.route("**/api/races/strategy", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({
      status: 200, contentType: "application/json", headers: corsHeaders(request),
      body: JSON.stringify(STRATEGY),
    });
  });
}

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
  await mockStrategy(page);

  await login(page);
  await page.goto("/planning?tab=strategy");

  const root = page.getByTestId("strategy-page");
  await root.waitFor();
  const targetsHeading = page.getByText("Mål-løb", { exact: true });
  await targetsHeading.waitFor();
  await targetsHeading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200); // font/paint settle

  await page.screenshot({ path: resolve(OUT, `3807-target-race-class-${vp.name}.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots -> ${OUT}`);
