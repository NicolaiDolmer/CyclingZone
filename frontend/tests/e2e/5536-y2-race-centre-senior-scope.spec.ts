// #5648 (Y2, delissue af #5536) — beviser at Race Centre ikke viser et
// ungdomsløb blandt "Dine løb i dag", selvom dagens race_stage_schedule-slot
// peger på det (risiko fra spec-ungdomslob-2026-09-24.md Y2: "ellers dukker
// ungdomsløb op i Race Centre").
//
// Samme filter-bevidste mock-mønster som race-centre.spec.js's
// filterRaceResults og 5536-y2-standings-senior-scope.spec.ts: races-mocken
// fjerner KUN ungdomsløbet når requesten faktisk sender PostgREST-filteret
// (or=(squad.is.null,squad.eq.senior)) — glemmer siden filteret, lækker
// ungdomsløbet ind, og testen fejler synligt.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, TEST_TEAM, evidenceShotPath } from "./fixtures.js";
import type { Page, Route } from "@playwright/test";

// 2026-08-17T14:30Z = 16:30 København (CEST) — samme frosne tidspunkt som
// race-centre.spec.js, så begge dagens-slots ligger i samme døgn-vindue.
const FROZEN_NOW = new Date("2026-08-17T14:30:00Z");

const DIVISIONS = [{ id: TEST_TEAM.league_division_id, tier: 2, pool_index: 0, label: "Division 2 · Pool A" }];

const RACES = [
  { id: "race-senior", name: "Ronde van Zone", stages: 1, stages_completed: 0, status: "scheduled", race_type: "single", league_division_id: TEST_TEAM.league_division_id, squad: "senior" },
  // Ungdomsløb i SAMME pulje som holdet — netop den situation risikoen advarer om.
  { id: "race-youth", name: "U23 Nations Cup", stages: 1, stages_completed: 0, status: "scheduled", race_type: "single", league_division_id: TEST_TEAM.league_division_id, squad: "u23" },
];

const SCHEDULE = [
  { race_id: "race-senior", stage_number: 1, scheduled_at: "2026-08-17T17:00:00Z" },
  { race_id: "race-youth", stage_number: 1, scheduled_at: "2026-08-17T18:00:00Z" },
];

/** Efterligner PostgREST's server-side filtrering — KUN når requesten selv
 *  sender or=(squad.is.null,squad.eq.senior) fjernes ungdomsløbet. */
function filterBySeniorSquadParam<T extends { squad: string }>(dataset: T[], requestUrl: string): T[] {
  const search = decodeURIComponent(new URL(requestUrl).search);
  if (!search.includes("squad.is.null") || !search.includes("squad.eq.senior")) return dataset;
  return dataset.filter((row) => row.squad === "senior");
}

async function installRaceCentreSeniorScopeMocks(page: Page) {
  await page.route("**/rest/v1/race_stage_schedule**", (route: Route) => json(route, SCHEDULE));
  await page.route("**/rest/v1/races**", (route: Route) =>
    json(route, filterBySeniorSquadParam(RACES, route.request().url())));
  await page.route("**/rest/v1/league_divisions**", (route: Route) => json(route, DIVISIONS));
  await page.route("**/rest/v1/race_entries**", (route: Route) => json(route, [{ race_id: "race-senior" }]));
}

test("race centre: ungdomsløb via dagens race_stage_schedule vises IKKE (desktop 1440)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stabilizePage(page);
  await page.clock.setFixedTime(FROZEN_NOW);
  await installNetworkMocks(page);
  await installRaceCentreSeniorScopeMocks(page);
  await login(page);

  await page.goto("/race-centre");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Dine løb i dag" })).toBeVisible();

  await expect(main.getByText("Ronde van Zone")).toBeVisible();
  await expect(main.getByText("U23 Nations Cup")).toHaveCount(0);

  await page.screenshot({
    path: evidenceShotPath("pr-screens/5536-y2-race-centre-senior-scope-1440x900.png"),
    fullPage: true,
  });
});

test("race centre: ungdomsløb via dagens race_stage_schedule vises IKKE (mobil 390)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stabilizePage(page);
  await page.clock.setFixedTime(FROZEN_NOW);
  await installNetworkMocks(page);
  await installRaceCentreSeniorScopeMocks(page);
  await login(page);

  await page.goto("/race-centre");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Dine løb i dag" })).toBeVisible();

  await expect(main.getByText("Ronde van Zone")).toBeVisible();
  await expect(main.getByText("U23 Nations Cup")).toHaveCount(0);

  await page.screenshot({
    path: evidenceShotPath("pr-screens/5536-y2-race-centre-senior-scope-390x844.png"),
    fullPage: true,
  });
});
