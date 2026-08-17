// #3810 — screenshots af holdsidens nye transferliste-markør (badge + udbudspris
// for egne ryttere der har en aktiv annonce på transferlisten, samme visuelle
// sprog + link-mønster som den eksisterende egen-auktion-badge, #2183).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende preview/dev-server med e2e-netværksmocks.
// Genbruger samme mock-opsætning som 3497-team-stars.shots.mjs.
//
//   node tests/e2e/3810-transfer-listed-badge.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, TEST_TEAM, RIDERS, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// To egne ryttere: én listet på transferlisten (badge synlig), én ikke (baseline,
// viser at markøren kun rammer den listede rytteren).
const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];
const listed = { ...base, id: "rider-shot-listed", firstname: "Til Salg", lastname: "Rytter", team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name } };
const notListed = { ...base, id: "rider-shot-not-listed", firstname: "Ikke Listet", lastname: "Rytter", team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name } };

const TRANSFER_LISTING = { id: "listing-shot-1", rider_id: listed.id, asking_price: 42000, status: "open" };

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
  await page.route("**/rest/v1/riders**", (route) => {
    const url = route.request().url();
    if (route.request().method() !== "GET") return json(route, {});
    if (url.includes("pending_team_id=eq.")) return json(route, []);
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, [listed, notListed]);
    return json(route, [...RIDERS, listed, notListed]);
  });
  // #3810: TeamPage's loadOwnTransferListings — direkte klient-forespørgsel mod
  // transfer_listings (public read, ingen ny endpoint). Kun den ene rytter har
  // en aktiv annonce.
  await page.route("**/rest/v1/transfer_listings**", (route) => json(route, [TRANSFER_LISTING]));
  await page.route("**/api/scouting/estimates**", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    let ids = [];
    try { ids = JSON.parse(route.request().postData() || "{}").riderIds || []; } catch { /* tom body */ }
    const shotIds = new Set([listed.id, notListed.id]);
    if (!ids.some((id) => shotIds.has(id))) return route.fallback();
    const estimates = {};
    for (const id of ids) {
      if (id === listed.id || id === notListed.id) estimates[id] = { lo: 4.5, hi: 4.5, exact: true, level: 3 };
    }
    return json(route, { teamId: TEST_TEAM.id, maxLevel: 3, estimates });
  });
  await stabilizePage(page);
  await login(page);
  await page.goto("/team");
  await page.getByRole("heading", { name: TEST_TEAM.name }).waitFor();
  await page.getByText(/Til Salg Rytter/).first().waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `3810-team-transfer-badge-${vp.name}.png`), fullPage: false });
  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
