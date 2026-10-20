// #6936 — Finance-prognosen med economy_no_upkeep_v1 off (før) og on (efter).
// Rå skærmbilleder af prognose-kortet på 1440 og 375 px, samlet til ét
// før/efter-billede (pr-screens/6936-no-upkeep-before-after.png).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Starter SELV en statisk server over frontend/dist og lukker den
// igen. Kræver et e2e-build (VITE_E2E=1 m.fl., se playwright-smoke.yml). Alle
// data er fiktive. Prognose og sæsonskifte-kvittering bygges med de RIGTIGE
// backend-funktioner (computeMultiSeasonForecast/buildSeasonSwitchPreview), så
// billedet viser præcis hvad backend sender med flaget off og on.
//
//   node tests/e2e/6936-no-upkeep.shots.ts <outDir>   (Node 24: native TS-stripping)

import { chromium } from "@playwright/test";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sirv from "sirv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, json, corsHeaders, TEST_TEAM } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const backendLib = resolve(__dirname, "..", "..", "..", "backend", "lib");
const { computeMultiSeasonForecast } = await import(pathToFileURL(join(backendLib, "financeForecast.js")).href);
const { buildSeasonSwitchPreview } = await import(pathToFileURL(join(backendLib, "seasonSwitchPreview.js")).href);

const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens/6936/raw"));
const DIST = join(__dirname, "..", "..", "dist");
const FIXED_NOW = new Date("2026-10-20T12:00:00Z");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
] as const;

// Fiktivt D2-hold midt i sæson 4: to faciliteter, én chef, tre akademipladser.
const args = {
  team: { ...TEST_TEAM, division: 2, balance: 420_000 },
  currentSeasonNumber: 4,
  riders: [
    { id: "r1", firstname: "A", lastname: "Rider", salary: 60_000, prize_earnings_bonus: 90_000, current_production_value: 600_000 },
    { id: "r2", firstname: "B", lastname: "Rider", salary: 40_000, prize_earnings_bonus: 40_000, current_production_value: 400_000 },
  ],
  debtCeiling: 900_000,
  seasonsAhead: 1,
  facilityTracks: [{ track: "training", tier: 2 }, { track: "scouting", tier: 1 }],
  activeStaffSalaries: [{ salary: 20_000 }],
  academyRiderCount: 2,
  facilitiesEnabled: true,
  upkeepPerRaceDay: true,
};
// Indeværende sæsons (S4) realiserede poster — historik, vises uændret.
const s4Transactions = [
  { reason_code: "season_start_sponsor", amount: 300_000 },
  { reason_code: "race_prize_payout", amount: 85_000 },
  { reason_code: "race_day_travel_staff", amount: -38_000 },
  { reason_code: "season_start_facility_upkeep", amount: -5_000 },
  { reason_code: "season_start_staff_salary", amount: -20_000 },
];

function payloads(noUpkeep: boolean) {
  const multi = computeMultiSeasonForecast({ ...args, noUpkeep });
  const forecast = { ...multi.forecasts[0], ...multi };
  const preview = buildSeasonSwitchPreview({
    transactions: s4Transactions, riders: args.riders, startingBalance: args.team.balance, s3: multi.forecasts[0],
  });
  return { forecast, seasonSwitch: { season: { current_number: 4, next_number: 5 }, ...preview } };
}

const serve = sirv(DIST, { single: "app.html", etag: true, dev: true });
const server = http.createServer(serve);
server.keepAliveTimeout = 0;
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CZ_CHROMIUM ? { executablePath: process.env.CZ_CHROMIUM } : {});

async function shoot(vp: (typeof VIEWPORTS)[number], noUpkeep: boolean) {
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, colorScheme: "light",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  const data = payloads(noUpkeep);
  await page.route("**/api/me/finance-forecast*", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, data.forecast);
  });
  await page.route("**/api/finance/season-switch-preview*", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, data.seasonSwitch);
  });
  await stabilizePage(page);
  await page.clock.setFixedTime(FIXED_NOW);
  await login(page);
  await page.addInitScript(() => { window.localStorage.setItem("cz_lang", "en"); });
  await page.goto("/finance");
  const heading = page.getByRole("heading", { name: "Next season · forecast", exact: true });
  await heading.waitFor();
  await page.waitForTimeout(500);
  const card = heading.locator("xpath=../../..");
  await card.scrollIntoViewIfNeeded();
  const path = join(OUT, `${noUpkeep ? "after" : "before"}-${vp.name}.png`);
  await card.screenshot({ path });
  console.log(path);
  await context.close();
}

try {
  for (const vp of VIEWPORTS) {
    for (const noUpkeep of [false, true]) await shoot(vp, noUpkeep);
  }
} finally {
  await browser.close();
  server.close();
}
