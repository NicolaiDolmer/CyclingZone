import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders } from "./fixtures.js";

// Race Hub S4 — kommende-løb-detalje (#1834/#1747): etape-stribe + valgt-etape-panel
// (silhuet + finale-markør + terrain-DNA) + race-DNA-gestalt + opstilling med per-etape
// rute-match. Mocker et scheduleret 2-etapers stage race (flad → høj bjerg) med
// demand_vector + schedule + /selection-ryttere med stageSuitability.

const RACE_ID = "race-e2e-up";

const UPCOMING_RACE = {
  id: RACE_ID,
  name: "E2E Vuelta",
  race_type: "stage_race",
  race_class: "OtherWorldTourA",
  stages: 2,
  stages_completed: 0,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

const UP_PROFILES = [
  { stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
    demand_vector: { sprint: 0.6, acceleration: 0.15, positioning: 0.08, endurance: 0.05, randomness: 0.12 } },
  { stage_number: 2, profile_type: "high_mountain", finale_type: "long_climb",
    demand_vector: { climbing: 0.52, endurance: 0.18, tempo: 0.08, recovery: 0.06, randomness: 0.16 } },
];

const UP_SCHEDULE = [
  { stage_number: 1, scheduled_at: "2099-07-01T13:00:00Z" },
  { stage_number: 2, scheduled_at: "2099-07-02T13:00:00Z" },
];

// Sprinter er stærk på etape 1 (flad), klatrer på etape 2 (bjerg) — rute-match skifter med etapen.
const UP_RIDERS = [
  { id: "u1", name: "Sven Sprint", primaryType: "sprinter", secondaryType: null, suitability: 55, stageSuitability: [88, 22], form: 60, fatigue: 10, injured: false },
  { id: "u2", name: "Karl Klatrer", primaryType: "climber", secondaryType: null, suitability: 58, stageSuitability: [26, 86], form: 62, fatigue: 8, injured: false },
  { id: "u3", name: "Anders Alround", primaryType: "all_rounder", secondaryType: null, suitability: 60, stageSuitability: [58, 61], form: 64, fatigue: 14, injured: false },
  { id: "u4", name: "Dan Domestik", primaryType: "domestique", secondaryType: null, suitability: 50, stageSuitability: [49, 52], form: 55, fatigue: 30, injured: false },
  { id: "u5", name: "Per Puncher", primaryType: "puncheur", secondaryType: null, suitability: 57, stageSuitability: [44, 70], form: 58, fatigue: 12, injured: false },
  { id: "u6", name: "Tom Tempo", primaryType: "time_trialist", secondaryType: null, suitability: 53, stageSuitability: [51, 48], form: 59, fatigue: 9, injured: false },
];

test("upcoming race detail: stage stripe + terrain DNA + per-stage route match", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? UPCOMING_RACE : [UPCOMING_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, UP_PROFILES));
  await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, UP_SCHEDULE));

  await page.route(`**/api/races/${RACE_ID}/selection`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({
      status: 200, contentType: "application/json", headers: corsHeaders(request),
      body: JSON.stringify({ enabled: true, race: UPCOMING_RACE, size: { min: 7, max: 7 }, selection: null, riders: UP_RIDERS, availableCount: 6 }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  // Header.
  await expect(page.getByRole("heading", { name: "E2E Vuelta" })).toBeVisible();

  // Race-DNA-gestalt + etape-stribe (2 etaper).
  await expect(page.getByText("Dette løb:")).toBeVisible();
  await expect(page.getByRole("button", { name: "Etape 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Etape 2" })).toBeVisible();

  // Valgt-etape-panel (default etape 1 = flad): terrain-DNA-bar + massespurt-finale.
  await expect(page.getByText(/Terræn-DNA/)).toBeVisible();
  await expect(page.getByText("Massespurt")).toBeVisible();

  // Opstilling med per-etape rute-match (kolonne-header skifter til "Rute-match").
  const panel = page.getByTestId("race-selection-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Rute-match")).toBeVisible();

  // Skift til etape 2 (høj bjerg) → profil + finale + rute-match opdateres.
  await page.getByRole("button", { name: "Etape 2" }).click();
  await expect(page.getByText("Bjergfinale")).toBeVisible();
});
