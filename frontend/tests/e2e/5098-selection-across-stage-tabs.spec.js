// #5098 — holdudtagelsen maa ikke forsvinde naar manageren kigger paa en anden
// etape undervejs.
//
// Spillerrapporten (spoergeskema 8/9) lyder "valget annulleres naar man skifter
// mellem etaper i et etapeloeb". Paa loebssiden (faner, #4613) bor de to ting i
// HVER SIN fane: holdudtagelsen i Hold-fanen, etape-striben i Etaper-fanen. Man
// kan derfor ikke skifte etape uden foerst at forlade udtagelsen — og fanerne
// renderes betinget, saa RaceSelectionPanel afmonteres paa vejen.
//
// Testen koerer praecis den rute en manager tager naar han vil se hvem der
// passer til etape 2: vaelg ryttere -> Etaper -> etape 2 -> tilbage til Hold.
// Udkastet (ugemt) skal staa uroert, og den maa ikke vaere blevet gemt bag
// ryggen paa ham (ingen PUT).
//
// Moenster: race-selection.spec.js (stabilizePage -> installNetworkMocks ->
// spec-overrides, LIFO).
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  json,
  corsHeaders,
} from "./fixtures.js";

const RACE_ID = "00000000-0000-4000-8000-000000005098";

// Etapeloeb der endnu ikke er startet: status 'scheduled' + stages_completed 0
// => racePhase "before" => fanerne Overblik / Hold / Taktik / Etaper.
const STAGE_RACE = {
  id: RACE_ID,
  name: "E2E Tour",
  race_type: "stage_race",
  race_class: "ProSeries",
  stages: 3,
  stages_completed: 0,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

const STAGE_PROFILES = [
  { race_id: RACE_ID, stage_number: 1, profile_type: "flat", finale_type: "flat_sprint", demand_vector: null, distance_km: 180, elevation_gain_m: 900, climbs: null, sprints: null, sectors: null },
  { race_id: RACE_ID, stage_number: 2, profile_type: "mountain", finale_type: "summit_finish", demand_vector: null, distance_km: 165, elevation_gain_m: 3800, climbs: null, sprints: null, sectors: null },
  { race_id: RACE_ID, stage_number: 3, profile_type: "hilly", finale_type: "flat_sprint", demand_vector: null, distance_km: 190, elevation_gain_m: 1800, climbs: null, sprints: null, sectors: null },
];

// 9 ryttere — rider-8 er skadet (samme form som race-selection.spec.js).
const SELECTION_RIDERS = Array.from({ length: 9 }, (_, i) => ({
  id: `sel-r${i}`,
  name: `Rider ${i}`,
  suitability: 70 - i,
  form: 55,
  fatigue: 10,
  injured: i === 8,
}));

/**
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ puts: () => number }>} taeller for PUT /selection
 */
async function installRaceMocks(page) {
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? STAGE_RACE : [STAGE_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, STAGE_PROFILES));

  let puts = 0;
  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() === "PUT") {
      puts += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders(request),
        body: JSON.stringify({ ok: true }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        race: STAGE_RACE,
        size: { min: 6, max: 8 },
        selection: null,
        riders: SELECTION_RIDERS,
        availableCount: 8,
        bound_riders: [],
      }),
    });
  });

  return { puts: () => puts };
}

test("#5098 ugemt udtagelse overlever en tur forbi etape-fanen", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const selection = await installRaceMocks(page);

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  // Hold-fanen: udtag tre ryttere og saet en kaptajn (ugemt udkast).
  await page.getByRole("tab", { name: "Hold" }).click();
  const panel = page.getByTestId("race-selection-panel");
  await expect(panel).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await panel.getByRole("checkbox", { name: new RegExp(`Rider ${i}$`) }).check();
  }
  await panel.getByRole("combobox").first().selectOption({ index: 1 });
  await expect(panel.getByText(/3\/8/)).toBeVisible();

  // Etaper-fanen: kig paa etape 2 (bjergetapen) — praecis det manageren gaar
  // derhen for at gøre midt i en udtagelse.
  await page.getByRole("tab", { name: "Etaper" }).click();
  await page.getByRole("button", { name: "Etape 2" }).click();
  await expect(page).toHaveURL(/stage=2/);

  // Tilbage til Hold: udkastet skal staa uroert.
  await page.getByRole("tab", { name: "Hold" }).click();
  await expect(panel).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await expect(panel.getByRole("checkbox", { name: new RegExp(`Rider ${i}$`) })).toBeChecked();
  }
  await expect(panel.getByText(/3\/8/)).toBeVisible();
  // Kaptajnen er stadig sat.
  await expect(panel.getByRole("combobox").first()).not.toHaveValue("");
  // Og intet er gemt bag ryggen paa manageren.
  expect(selection.puts(), "et fane-skift maa aldrig gemme af sig selv").toBe(0);
});
