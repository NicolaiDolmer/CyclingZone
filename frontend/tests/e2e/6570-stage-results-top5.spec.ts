// #6570: etapeside 2.0, "Din dag"-kortet efter en koert etape viser top 5 paa
// desktop (>= md) og stadig top 3 paa mobil. Antallet er EN konstant
// (DAY_TOP_COUNT i stagePageV2Model.ts); resten skjules med CSS, ikke med et
// viewport-gaet i JS, saa der ikke kan opstaa flimmer ved resize.
//
// Netvaerket er mocket.
//
// Foer/efter-billederne tages med CZ_WRITE_COMMITTED_SHOTS=1 (ellers lander de i
// frontend/test-results/evidence): desktop 1440 og mobil 390.
import type { Locator, Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, raceResultsRoute, evidenceShotPath, TEST_TEAM } from "./fixtures.js";

const RACE = {
  id: "race-e2e-6570",
  name: "E2E Tour 6570",
  race_type: "stage_race",
  race_class: "TourFrance",
  stages: 3,
  stages_completed: 2,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

const NAMES = [
  ["Ada", "Pedersen"], ["Mikkel", "Hansen"], ["Jonas", "Berg"], ["Pavel", "Novak"],
  ["Simon", "Kranjc"], ["Luca", "Marchetti"], ["Carl", "Rojas"], ["Ana", "Ibarra"],
];

function rider(i: number) {
  const [firstname, lastname] = NAMES[i];
  return { id: `rider-${i + 1}`, firstname, lastname, nationality_code: "dk", team: { id: i === 7 ? TEST_TEAM.id : "team-x", name: "Team X" } };
}

function row(id: string, stage: number, type: string, rank: number, r: ReturnType<typeof rider>, finish_time: string) {
  return {
    id, stage_number: stage, result_type: type, rank,
    rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`,
    team_id: r.team.id, team_name: r.team.name,
    finish_time, points_earned: 0, prize_money: 0, rider: r,
    in_breakaway: false, breakaway_caught: false,
  };
}

// Etape 2: otte i maal, mit hold (nr. 8) er nr. 8.
const RESULTS = [
  ...NAMES.map((_, i) => row(`s2-${i}`, 2, "stage", i + 1, rider(i), i === 0 ? "+0:00" : `+0:${String(i * 7).padStart(2, "0")}`)),
  ...NAMES.map((_, i) => row(`g2-${i}`, 2, "gc", i + 1, rider(i), i === 0 ? "+0:00" : `+0:${String(i * 9).padStart(2, "0")}`)),
];

const STAGE_PROFILES = [
  { stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint" },
  { stage_number: 2, profile_type: "hilly", finale_type: null },
  { stage_number: 3, profile_type: "mountain", finale_type: "long_climb" },
];

async function mockPage(page: Page) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/races**", (route: Route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute(RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", (route: Route) => json(route, STAGE_PROFILES));
  await page.route("**/rest/v1/race_stage_passages**", (route: Route) => json(route, []));
}

async function openDay(page: Page) {
  await mockPage(page);
  await login(page);
  await page.goto("/races/race-e2e-6570?stage=2");
  const card = page.locator("[aria-label^=\"Din dag\"], [aria-label^=\"Your day\"]").first();
  await expect(card).toBeVisible();
  return card;
}

test("Din dag shows the top 5 on desktop and the top 3 on mobile (#6570)", async ({ page }, testInfo) => {
  const card = await openDay(page);
  const isMobile = (page.viewportSize()?.width ?? 1280) < 768;
  // Foer-billedet tages med DAY_TOP_COUNT midlertidigt sat til 3 (CZ_SHOT_PREFIX=before).
  const prefix = process.env.CZ_SHOT_PREFIX || "after";

  if (prefix === "after") await assertRows(card, isMobile);

  const shot = isMobile ? "390" : "1440";
  if (testInfo.project.name !== "mobile-webkit") {
    if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidenceShotPath(`pr-screens/6570-${prefix}-${shot}.png`), fullPage: false });
  }
});

async function assertRows(card: Locator, isMobile: boolean) {
  // Rytter 1-3 er synlige overalt; 4-5 kun fra md; nr. 6-7 aldrig (nr. 8 er
  // mit hold og staar i "Dine ryttere").
  for (const name of ["Ada Pedersen", "Mikkel Hansen", "Jonas Berg"]) {
    await expect(card.getByRole("link", { name }).first()).toBeVisible();
  }
  for (const name of ["Pavel Novak", "Simon Kranjc"]) {
    const link = card.getByRole("link", { name }).first();
    if (isMobile) await expect(link).toBeHidden();
    else await expect(link).toBeVisible();
  }
  for (const name of ["Luca Marchetti", "Carl Rojas"]) {
    await expect(card.getByRole("link", { name })).toHaveCount(0);
  }
  await expect(card.getByText(isMobile ? "Top 3" : "Top 5", { exact: true }).first()).toBeVisible();
}
