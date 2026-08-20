// Kvalitetssession 2 (18/8, #2849 T2-kontrakt) — screenshots af auktions- og
// transferfladens designkontrakt-fixes: gold-rationering i rækker/kort,
// radius-kanon (rounded-cz/rounded-cz-pill), count-linje under listen.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende preview/dev-server med e2e-netværksmocks.
//
//   node tests/e2e/quality-auctions-contract.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, RIVAL_TEAM, RIDERS, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Default /api/transfers-mock returnerer tom liste — markeds-tabellen (og dermed
// radius-/count-linje-fixet på den) er kun synlig med et par listede ryttere.
const MARKET_LISTINGS = RIDERS.slice(1, 3).map((r, i) => ({
  id: `listing-shot-${i}`,
  rider: { ...r, team_id: RIVAL_TEAM.id, team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name } },
  seller: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name },
  asking_price: 380000 + i * 120000,
  status: "open",
  created_at: "2026-08-10T00:00:00.000Z",
}));

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
    locale: "da-DK",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/api/transfers", (route) => (
    route.request().method() === "GET" ? json(route, MARKET_LISTINGS) : route.fallback()
  ));
  await stabilizePage(page);
  await login(page);

  await page.goto("/auctions");
  await page.getByTestId("auctions-ticker").waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `quality-auctions-${vp.name}.png`), fullPage: false });

  await page.goto("/transfers?tab=market");
  await page.getByRole("table").first().waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `quality-transfers-${vp.name}.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
