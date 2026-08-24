// #3187: løbskortene på Planlægnings-hubbens Holdudtagelse/browse-fane (den gamle
// URL /races?tab=calendar redirecter hertil, se legacy-route-testen i
// race-distribution.spec.js) havde en død header — kun titel-teksten var et RIGTIGT
// link (RaceLink), mens "Løbsdag N" + etape/klasse-linjen lå i en ikke-interaktiv
// <div> ved siden af. Clarity (27/7–3/8): 129 dødeklik på 6 minutter på præcis dén
// tekst-kombination ("Tour AdriatiqueLøbsdag …"). Samme mønster fandtes i
// StartListColumn (browse-varianten for andre divisioner).
//
// Denne test klikker specifikt på det FØR var dødt (raceDayLabel / type-klasse-
// linjen) — ikke titlen, som allerede virkede — og forventer navigation. Mønster
// lånt fra transfers-deadclick.spec.js (#1421).
import { expect, test } from "@playwright/test";
import { corsHeaders, installNetworkMocks, json, login, stabilizePage } from "./fixtures.js";

const DISTRIBUTION = {
  enabled: true,
  race_v3_enabled: false,
  season: { id: "s1", number: 1 },
  currentDay: 14,
  focusDay: 14,
  timeline: {
    totalDays: 60, currentDay: 14,
    days: Array.from({ length: 60 }, (_, i) => ({ day: i + 1, dateText: null, terrain: "flat", hasMyRace: i === 13 })),
  },
  columns: [
    {
      id: "race-adriatique", name: "Tour Adriatique", race_class: "ProSeries", race_type: "single",
      // #4187: window er raceTimeWindow(ms) i API'en - loebskortet viser datoen, ikke loebsdagen.
      stages: 1, status: "scheduled",
      window: { start: Date.parse("2026-09-02T11:00:00Z"), end: Date.parse("2026-09-02T11:00:00Z") },
      bindingWindow: { start: 14, end: 14 },
      game_day: 14,
      size: { min: 6, max: 6 }, withdrawn: false, counts: { selected: 0, target: 6 },
      riders: [], selection: null,
    },
  ],
  bindingMap: {},
};

const BROWSE = {
  enabled: true,
  season: { id: "s1", number: 1 },
  pools: [{ id: 1, tier: 1, pool_index: 0, label: "Pool A" }],
  pool: { id: 1, tier: 1, pool_index: 0, label: "Pool A" },
  ownPoolId: 1,
  currentDay: 14, focusDay: 14, horizonDays: 7,
  timeline: {
    totalDays: 60, currentDay: 14,
    days: Array.from({ length: 60 }, (_, i) => ({ day: i + 1, dateText: null, terrain: "flat", hasMyRace: false })),
  },
  columns: [
    {
      id: "race-hainan", name: "Tour de l'Île de Hainan", race_class: "ProSeries", race_type: "single",
      stages: 1, stages_completed: 0, status: "scheduled",
      window: { start: Date.parse("2026-09-02T11:00:00Z"), end: Date.parse("2026-09-02T11:00:00Z") },
      primaryProfileType: "flat", visible: true, daysUntilStart: 2, opensInDays: 0, teamCount: 0,
      teams: [],
    },
  ],
};

async function mockDistribution(page, dist = DISTRIBUTION) {
  await page.route("**/api/races/distribution", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, dist);
  });
}

async function mockBrowse(page, payload = BROWSE) {
  await page.route("**/api/races/distribution/browse**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, payload);
  });
}

test("RaceColumn: klik på 'Løbsdag N' (ikke kun titlen) navigerer til løbet (#3187)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockDistribution(page);

  await login(page);
  await page.goto("/planning");
  const board = page.getByTestId("race-hub-board");
  await expect(board).toBeVisible();
  await expect(board.getByText("Tour Adriatique")).toBeVisible();

  // Headeren er ÉT link — data-testid overlever oversættelse/copy-ændringer.
  const header = board.getByTestId("race-column-open");
  await expect(header).toHaveAttribute("href", "/races/race-adriatique");

  // Klikket der før var dødt: dato-mærkatet (ikke titlen). #4187 erstattede
  // "Løbsdag 14" med løbets dato — samme placering, samme hit-target.
  await board.getByText("2. sep.").click();
  await expect(page).toHaveURL(/\/races\/race-adriatique$/);
});

test("StartListColumn (browse): klik på type/klasse-linjen navigerer til løbet (#3187)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockDistribution(page);
  await mockBrowse(page);

  await login(page);
  await page.goto("/planning");
  await expect(page.getByTestId("race-hub-board")).toBeVisible();

  await page.getByRole("tab", { name: "Andre divisioner" }).click();
  const browse = page.getByTestId("race-hub-browse");
  await expect(browse).toBeVisible();
  await expect(browse.getByText("Tour de l'Île de Hainan")).toBeVisible();

  const header = browse.getByTestId("race-column-open");
  await expect(header).toHaveAttribute("href", "/races/race-hainan");

  // Klikket der før var dødt: type/klasse/holdtal-linjen (ikke titlen).
  await browse.getByText("Enkeltdagsløb · ProSeries · 0 hold").click();
  await expect(page).toHaveURL(/\/races\/race-hainan$/);
});
