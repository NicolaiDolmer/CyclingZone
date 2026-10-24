// #6855 — screenshots af Kontrakter-fanen (grupper, afkrydsning, fælles valg,
// "2 (maks)", bundlinje) og opsummeringsvinduet, desktop + mobil. Tjekker
// også at sorteringen overlever et klik ind på en rytter og tilbage.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende preview/dev-server med e2e-netværksmocks.
//
//   node tests/e2e/6855-contracts-tab.shots.mjs [baseURL] [outDir]

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
const SEASON = 1; // seedets aktive sæson

const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];
function rider(id, firstname, lastname, endSeason, salary) {
  return { ...base, id, firstname, lastname, contract_end_season: endSeason, salary, team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name } };
}
// Fiktive preview-ryttere (ingen rigtige navne/tal). newSalary er mock-tal.
const OWN = [
  { r: rider("c-1", "Anna", "Holm", 1, 40000), newSalary: 52000 },
  { r: rider("c-2", "Bo", "Lind", 1, 90000), newSalary: 81000 },
  { r: rider("c-3", "Carl", "Moe", 2, 30000), newSalary: 30000 },
  { r: rider("c-4", "Dan", "Ravn", 2, 55000), newSalary: 61000 },
  { r: rider("c-5", "Eva", "Skov", 3, 25000), newSalary: 27000 },
  { r: rider("c-6", "Finn", "Tang", 4, 70000), newSalary: 70000 },
];
const byId = new Map(OWN.map((o) => [o.r.id, o]));

function quote(items) {
  const maxSeason = SEASON + 3;
  const riders = [];
  const errors = [];
  let before = 0;
  let after = 0;
  for (const it of items) {
    const o = byId.get(it.riderId);
    if (!o) continue;
    const anchor = Math.max(o.r.contract_end_season ?? SEASON, SEASON);
    const room = Math.max(0, maxSeason - anchor);
    if (room === 0) { errors.push({ riderId: it.riderId, errorCode: "contract_extension_cap_reached", errorParams: { maxSeason } }); continue; }
    const granted = Math.min(it.seasons, room);
    before += o.r.salary; after += o.newSalary;
    riders.push({ riderId: it.riderId, requestedSeasons: it.seasons, grantedSeasons: granted, maxSeasons: room, capped: granted < it.seasons, currentSalary: o.r.salary, newSalary: o.newSalary, currentEndSeason: o.r.contract_end_season, newEndSeason: anchor + granted });
  }
  const team = OWN.reduce((n, o) => n + o.r.salary, 0);
  return { currentSeason: SEASON, maxSeason, riders, errors, totals: { selectedSalaryBefore: before, selectedSalaryAfter: after, teamSalaryBefore: team, teamSalaryAfter: team - before + after }, salaryCap: { active: true, withinCap: true, cap: null } };
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 393, height: 852 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let sortSurvived = null;

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, locale: "da-DK" });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/rest/v1/riders**", (route) => {
    const url = route.request().url();
    if (route.request().method() !== "GET") return json(route, {});
    if (url.includes("pending_team_id=eq.")) return json(route, []);
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, OWN.map((o) => o.r));
    return json(route, [...RIDERS, ...OWN.map((o) => o.r)]);
  });
  await page.route("**/api/riders/extend-contracts/quote", (route) => {
    let items = [];
    try { items = JSON.parse(route.request().postData() || "{}").items || []; } catch { /* tom body */ }
    return json(route, quote(items));
  });
  await stabilizePage(page);
  await login(page);
  await page.addInitScript(() => { try { localStorage.setItem("i18nextLng", "da"); } catch { /* ignore */ } });
  await page.goto("/team?tab=contracts");
  await page.getByTestId("contracts-tab").waitFor();

  // Vælg hele "Udløber denne sæson" + Carl, og sæt det fælles valg til 3.
  await page.getByTestId("contracts-group-expiring").locator('input[type="checkbox"]').first().check();
  await page.getByRole("checkbox", { name: /Carl Moe/ }).check();
  await page.getByTestId("contracts-bar").getByRole("button", { name: "3", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `6855-contracts-tab-${vp.name}.png`), fullPage: vp.name === "desktop" });

  await page.getByTestId("contracts-extend").click();
  await page.getByTestId("contracts-summary-table").waitFor();
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(OUT, `6855-contracts-summary-${vp.name}.png`) });
  await page.keyboard.press("Escape");

  if (vp.name === "desktop") {
    // Sortering huskes: sortér efter løn, gå ind på en rytter og tilbage.
    await page.getByTestId("contracts-group-expiring").getByRole("columnheader", { name: /Løn nu/ }).click();
    const before = page.url();
    await page.getByRole("link", { name: "Bo Lind" }).first().click();
    await page.waitForURL(/\/riders\//);
    await page.goBack();
    await page.getByTestId("contracts-tab").waitFor();
    sortSurvived = { before, after: page.url(), same: before === page.url() && /csort=salary/.test(page.url()) };
  }
  await context.close();
}
await browser.close();
console.log(JSON.stringify({ out: OUT, sortSurvived }, null, 2));
