// #3373 — dashboardets "Seneste resultater" havde løbsnavne som ren tekst: kun
// vinderens navn til højre var et link, så et klik på selve LØBET gjorde intet.
// Spillerrapport i Discord #dansk-snak 4/8 (@smukkethomsen): "Løbene under
// seneste resultater under dashboard linker ikke".
//
// Testen klikker det der FØR var dødt — vinder-undertekst-linjen og løbsnavnet —
// og forventer navigation til løbssiden. Samme mønster som
// racehub-deadclick.spec.js (#3187) og transfers-deadclick.spec.js (#1421).
//
// Dækker begge løbstyper modulet kan vise, fordi de linker forskelligt:
//   endagsløb / samlet vinder → /races/:id
//   etapevinder på etapeløb   → /races/:id?stage=N (etape-fanen, jf. #2526)
import { expect, test } from "@playwright/test";
import { corsHeaders, installNetworkMocks, json, login, stabilizePage } from "./fixtures.js";

// Formen er backend-kontrakten fra GET /api/dashboard/recent-results
// (backend/routes/api.js): winner = gc-rækken, ELLER seneste etapevinder når
// et afsluttet etapeløb mangler sin gc-række (findes i prod, verificeret 5/8).
const RECENT_RESULTS = {
  races: [
    {
      race_id: "race-stage-gap", name: "Tour de la Provence Verte",
      race_type: "stage_race", stages: 4, last_import: "2026-07-30T16:08:20.765Z",
      winner: {
        rider_id: "rider-stage-winner", firstname: "Lennard", lastname: "Fischer",
        nationality_code: "de", team_name: "Alpine Racing", is_ai: true,
        result_type: "stage", stage_number: 4,
      },
    },
    {
      race_id: "race-one-day", name: "Gran Premio de Castilla",
      race_type: "single", stages: 1, last_import: "2026-07-29T16:00:00.000Z",
      winner: {
        rider_id: "rider-one-day-winner", firstname: "Owen", lastname: "Mitchell",
        nationality_code: "gb", team_name: "E2E Racing", is_ai: false,
        result_type: "gc", stage_number: null,
      },
    },
  ],
};

async function mockRecentResults(page) {
  await page.route("**/api/dashboard/recent-results", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    }
    return json(route, RECENT_RESULTS);
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  // Efter installNetworkMocks: Playwright matcher routes i omvendt registrerings-
  // rækkefølge, så denne vinder over den generiske **/api/**-mock.
  await mockRecentResults(page);
});

test("etapeløb: klik på vinder-linjen (ikke navnet) åbner den rigtige etape (#3373)", async ({ page }) => {
  await login(page);

  const rows = page.getByTestId("recent-result-open");
  await expect(rows.first()).toHaveAttribute("href", "/races/race-stage-gap?stage=4");

  // Klikket der før var dødt: undertekst-linjen, ikke løbsnavnet.
  await page.getByText("Vinder af etape 4").click();
  await expect(page).toHaveURL(/\/races\/race-stage-gap\?stage=4$/);
});

test("endagsløb: klik på løbsnavnet åbner løbssiden uden etape-parameter (#3373)", async ({ page }) => {
  await login(page);

  const rows = page.getByTestId("recent-result-open");
  await expect(rows.nth(1)).toHaveAttribute("href", "/races/race-one-day");

  await page.getByText("Gran Premio de Castilla").click();
  await expect(page).toHaveURL(/\/races\/race-one-day$/);
});
