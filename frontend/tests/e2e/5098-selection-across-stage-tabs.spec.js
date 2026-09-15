// #5098 — holdudtagelsen maa ikke forsvinde naar manageren kigger paa en anden
// etape undervejs.
//
// Spillerrapporten (spoergeskema 8/9) lyder "valget annulleres naar man skifter
// mellem etaper i et etapeloeb". Paa loebssiden (faner, #4613) bor de to ting i
// HVER SIN fane: holdudtagelsen i Hold-fanen, etape-striben i Etaper-fanen. Man
// kan derfor ikke skifte etape uden foerst at forlade udtagelsen — og fanerne
// renderes betinget, saa RaceSelectionPanel afmonteres paa vejen og tog sin
// state med sig. DET er rapporten, reproduceret nedenfor.
//
// Testen koerer praecis den rute en manager tager naar han vil se hvem der
// passer til etape 2: vaelg ryttere -> Etaper -> etape 2 -> tilbage til Hold.
// Begge tilstande daekkes: et UGEMT udkast (test 1) og en GEMT udtagelse
// (test 2).
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
 * Mocker loebet + et STATEFULDT /selection-endpoint: et PUT lander i `stored`,
 * og efterfoelgende GET'er svarer med den gemte udtagelse — ellers kunne test 2
 * ikke skelne "panelet huskede serverens udtagelse" fra "panelet huskede ikke
 * noget som helst".
 *
 * @param {import("@playwright/test").Page} page
 */
async function installRaceMocks(page) {
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? STAGE_RACE : [STAGE_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, STAGE_PROFILES));

  const state = { puts: 0, stored: null };
  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() === "PUT") {
      state.puts += 1;
      try {
        const body = JSON.parse(request.postData() || "{}");
        state.stored = {
          rider_ids: body.rider_ids ?? [],
          captain_id: body.captain_id ?? null,
          sprint_captain_id: body.sprint_captain_id ?? null,
          hunter_id: body.hunter_id ?? null,
          free_role_ids: body.free_role_ids ?? [],
          is_auto_filled: false,
        };
      } catch { /* tom body — state.stored forbliver som den var */ }
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
        selection: state.stored,
        riders: SELECTION_RIDERS,
        availableCount: 8,
        bound_riders: [],
      }),
    });
  });

  return state;
}

/**
 * Hold-fanen -> Etaper-fanen -> etape 2 -> tilbage til Hold-fanen.
 * @param {import("@playwright/test").Page} page
 */
async function detourViaStage2(page) {
  await page.getByRole("tab", { name: "Etaper" }).click();
  await page.getByRole("button", { name: "Etape 2" }).click();
  await expect(page).toHaveURL(/stage=2/);
  await page.getByRole("tab", { name: "Hold" }).click();
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

  // Etape 2 (bjergetapen) — praecis det manageren gaar derhen for at se midt i
  // en udtagelse — og tilbage igen.
  await detourViaStage2(page);

  await expect(panel).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await expect(panel.getByRole("checkbox", { name: new RegExp(`Rider ${i}$`) })).toBeChecked();
  }
  await expect(panel.getByText(/3\/8/)).toBeVisible();
  // Kaptajnen staar stadig paa den rytter manageren valgte.
  await expect(panel.getByRole("combobox").first()).toHaveValue("sel-r0");
  // Fladen siger at det er et UGEMT udkast — manageren maa ikke tro det staar gemt.
  await expect(panel.getByTestId("selection-draft-restored")).toBeVisible();
  // Og intet er gemt bag ryggen paa ham.
  expect(selection.puts, "et fane-skift maa aldrig gemme af sig selv").toBe(0);

  // Gem virker stadig, og udkast-linjen forsvinder i samme sekund.
  await panel.getByRole("button", { name: /gem udtagelse/i }).click();
  await expect(panel.getByText(/udtagelsen er gemt/i)).toBeVisible();
  await expect(panel.getByTestId("selection-draft-restored")).toHaveCount(0);
  expect(selection.stored.rider_ids).toEqual(["sel-r0", "sel-r1", "sel-r2"]);
});

test("#5098 gemt udtagelse staar uroert efter en tur forbi etape-fanen", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const selection = await installRaceMocks(page);

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  await page.getByRole("tab", { name: "Hold" }).click();
  const panel = page.getByTestId("race-selection-panel");
  await expect(panel).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await panel.getByRole("checkbox", { name: new RegExp(`Rider ${i}$`) }).check();
  }
  await panel.getByRole("combobox").first().selectOption({ index: 1 });
  await panel.getByRole("button", { name: /gem udtagelse/i }).click();
  await expect(panel.getByText(/udtagelsen er gemt/i)).toBeVisible();
  expect(selection.puts).toBe(1);

  await detourViaStage2(page);

  // Truppen kommer nu fra serveren, ikke fra et udkast — derfor ingen
  // udkast-linje, og ingen ekstra PUT undervejs.
  await expect(panel).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await expect(panel.getByRole("checkbox", { name: new RegExp(`Rider ${i}$`) })).toBeChecked();
  }
  await expect(panel.getByRole("combobox").first()).toHaveValue("sel-r0");
  await expect(panel.getByTestId("selection-draft-restored")).toHaveCount(0);
  expect(selection.puts).toBe(1);
});
