// #6912 (designbord S7, variant A): "Breakaway odds" kom fra en fast tabel i
// frontend, ikke fra motoren, og viste fx "Low" paa en bjergetape hvor udbruddet
// tog de otte foerste pladser. Labelen er fjernet fra jaeger-boksen i udtagelsen
// (HunterExplainer) og fra jaeger-kortet i rolle-menuen paa Planlaegning
// (RoleCard). Jaeger-boksen siger i stedet aerligt, at jaegeren proever at komme
// med i morgenudbruddet, og at feltet afgoer paa dagen om det holder.
//
// Etapen er den fra fundet 25/10: high_mountain + long_climb (tabellen sagde "Low").
// Screenshots (mobil 375px) tages FOER assertions, saa samme spec giver foer- og
// efter-billeder: SHOT_PHASE=before|after (default after), gemt under
// test-results/evidence/6912/ (ikke committet).
import { expect, test } from "./e2e-base.js";
import { corsHeaders, evidenceShotPath, installNetworkMocks, json, login, stabilizePage } from "./fixtures.js";

const PHASE = process.env.SHOT_PHASE === "before" ? "before" : "after";
const RACE_ID = "00000000-0000-4000-8000-000000006912";
const PROFILE = { profile_type: "high_mountain", finale_type: "long_climb" };

const RACE = {
  id: RACE_ID,
  name: "E2E Mountain Stage",
  race_type: "single",
  race_class: "ProSeries",
  stages: 1,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

const RIDERS = Array.from({ length: 8 }, (_, i) => ({
  id: `sel-r${i}`,
  name: `Rider ${i + 1}`,
  primaryType: "climber",
  secondaryType: null,
  suitability: 72 - i * 3,
  aggression: 48 - i * 4,
  tactics: 40 + i,
  form: 55,
  fatigue: 10,
  injured: false,
}));
const SELECTED = RIDERS.slice(0, 6).map((r) => r.id);
const SELECTION = { rider_ids: SELECTED, captain_id: null, hunter_id: null };

const STAGE_PROFILE = {
  race_id: RACE_ID,
  stage_number: 1,
  ...PROFILE,
  demand_vector: { climbing: 0.5, endurance: 0.2, tempo: 0.1, recovery: 0.1, randomness: 0.1 },
  distance_km: 182,
  elevation_gain_m: 4200,
  climbs: [],
  sprints: [],
  sectors: [],
  weather: null,
};

const DISTRIBUTION = {
  enabled: true,
  race_v3_enabled: false,
  season: { id: "s1", number: 1 },
  currentDay: 14,
  focusDay: 14,
  timeline: {
    totalDays: 60, currentDay: 14,
    days: Array.from({ length: 60 }, (_, i) => ({ day: i + 1, dateText: null, terrain: "mountain", hasMyRace: i === 13 })),
  },
  columns: [
    {
      id: RACE_ID, name: "E2E Mountain Stage", race_class: "ProSeries", race_type: "single",
      stages: 1, status: "scheduled",
      window: { start: Date.parse("2026-11-02T11:00:00Z"), end: Date.parse("2026-11-02T11:00:00Z") },
      bindingWindow: { start: 14, end: 14 },
      game_day: 14,
      primaryProfileType: PROFILE.profile_type,
      primaryFinaleType: PROFILE.finale_type,
      size: { min: 6, max: 8 }, withdrawn: false, counts: { selected: SELECTED.length, target: 8 },
      riders: RIDERS,
      selection: SELECTION,
    },
  ],
  bindingMap: {},
};

function mockApi(page, pattern, body) {
  return page.route(pattern, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, body);
  });
}

async function setup(page) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, [STAGE_PROFILE]));
  await mockApi(page, `**/api/races/${RACE_ID}/selection`, {
    enabled: true,
    race: RACE,
    size: { min: 6, max: 8 },
    selection: SELECTION,
    riders: RIDERS,
    availableCount: RIDERS.length,
  });
  await mockApi(page, "**/api/races/distribution", DISTRIBUTION);
  await login(page);
}

test.use({ viewport: { width: 375, height: 812 } });

test("jaeger-boksen i udtagelsen viser ingen fast udbrudschance, kun den aerlige linje (#6912)", async ({ page }) => {
  await setup(page);
  await page.goto(`/races/${RACE_ID}?tab=team`);
  await expect(page.getByTestId("race-selection-panel")).toBeVisible();

  const hunterBox = page.locator("section").filter({ has: page.getByRole("heading", { name: "Vælg din udbrudsjæger" }) }).last();
  await hunterBox.scrollIntoViewIfNeeded();
  await hunterBox.screenshot({ path: evidenceShotPath(`docs/screenshots/6912/hunter-box-375-${PHASE}.png`) });

  await expect(hunterBox.getByText("Jægeren prøver at komme med i morgenudbruddet.", { exact: false })).toBeVisible();
  await expect(hunterBox.getByText("Udbruds-chance", { exact: false })).toHaveCount(0);
});

test("jaeger-kortet i rolle-menuen paa Planlaegning har ingen udbrudschance-chip (#6912)", async ({ page }) => {
  await setup(page);
  await page.goto("/planning");
  const board = page.getByTestId("race-hub-board");
  await expect(board).toBeVisible();

  await board.getByTestId("race-rider-name").first().click();
  const hunterCard = board.getByRole("button", { name: /Udbrudsjæger/ });
  await expect(hunterCard).toBeVisible();
  const menu = board.locator("div.absolute").filter({ has: page.getByRole("button", { name: /Udbrudsjæger/ }) });
  // Midt i skaermen, saa den faste bundmenu ikke daekker jaeger-kortet.
  await menu.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await menu.screenshot({ path: evidenceShotPath(`docs/screenshots/6912/role-menu-375-${PHASE}.png`) });

  await expect(hunterCard.getByText("Udbruds-chance", { exact: false })).toHaveCount(0);
});
