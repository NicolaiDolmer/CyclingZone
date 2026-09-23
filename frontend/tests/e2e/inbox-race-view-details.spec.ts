import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, login, stabilizePage, json, raceResultsRoute, evidenceShotPath, TEST_USER, TEST_TEAM,
} from "./fixtures.js";

// #5417 (spiller 19/9, telefon): "when i click view details it doesnt show the
// race". Efter #5384 samles et afviklet løbs resultat + en karriere-milepæl til
// ÉN indbakkelinje. Linjens "Vis detaljer"-knap navigerede til den generiske
// TYPE_CONFIG-fallback (/resultater), ikke til løbet — den enkelte
// race_result-besked havde altid deep-linket til /races/:raceId (#1952), men
// den regel kom aldrig med over i den samlede linje. Spilleren landede på
// resultat-hubben og måtte selv finde løbet via Race Centre.
//
// Specen går hele vejen som spilleren: indbakke → fold linjen ud → "Vis
// detaljer" → løbssiden med resultatet og spillerens egen rytter synlig.
// Kører i alle tre projekter (desktop + to mobile); mobile-chromium låses til
// 390 px, samme bredde som rapporten.

const RACE_ID = "race-e2e-5417";
const RACE_NAME = "E2E Classic 5417";

const RACE = {
  id: RACE_ID,
  name: RACE_NAME,
  race_type: "single",
  race_class: "Class1",
  stages: 1,
  stages_completed: 1,
  edition_year: 2026,
  status: "completed",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

type RiderFixture = {
  id: string;
  firstname: string;
  lastname: string;
  nationality_code: string;
  team: { id: string; name: string };
};

function rider(id: string, first: string, last: string, team: { id: string; name: string }): RiderFixture {
  return { id, firstname: first, lastname: last, nationality_code: "dk", team };
}

function gcRow(id: string, rank: number, r: RiderFixture, finishTime: string) {
  return {
    id, stage_number: 1, result_type: "gc", rank,
    rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`,
    team_id: r.team.id, team_name: r.team.name,
    finish_time: finishTime, points_earned: 0, prize_money: 0, rider: r,
    in_breakaway: false, breakaway_caught: false,
  };
}

const RIVAL = { id: "team-rival-5417", name: "Hold B" };
const MINE = { id: TEST_TEAM.id, name: TEST_TEAM.name };
const WINNER = rider("rider-5417-a", "Mikkel", "Hansen", RIVAL);
const OWN_RIDER = rider("rider-5417-b", "Ada", "Pedersen", MINE);

const RESULTS = [
  gcRow("g1", 1, WINNER, "+0:00"),
  gcRow("g2", 2, OWN_RIDER, "+0:04"),
];

// Præcis den form backenden skriver: race_result fra
// notificationService.emitRaceResultNotifications (related_id = race.id,
// metadata.raceId + messageParams.race) og milepælen fra careerFirsts.js et par
// sekunder senere, samme løb, samme dag — dét er #5384-bøtten.
const RESULT_AT = "2026-09-19T10:00:00.000Z";
const MILESTONE_AT = "2026-09-19T10:00:05.000Z";

const NOTIFICATION_ROWS = [
  {
    id: "notif-5417-milestone",
    user_id: TEST_USER.id,
    type: "career_milestone",
    title: "Maiden podium",
    message: `${OWN_RIDER.firstname} ${OWN_RIDER.lastname} made the podium for the first time in ${RACE_NAME}.`,
    related_id: RACE_ID,
    is_read: false,
    created_at: MILESTONE_AT,
    metadata: {
      raceId: RACE_ID,
      riderId: OWN_RIDER.id,
      eventType: "maiden_podium",
      messageParams: { rider: `${OWN_RIDER.firstname} ${OWN_RIDER.lastname}`, race: RACE_NAME },
    },
  },
  {
    id: "notif-5417-result",
    user_id: TEST_USER.id,
    type: "race_result",
    title: "Race result is in",
    message: `${RACE_NAME} has been run. View the result.`,
    related_id: RACE_ID,
    is_read: false,
    created_at: RESULT_AT,
    metadata: {
      raceId: RACE_ID,
      titleCode: "notif.raceResult.title",
      titleParams: {},
      messageCode: "notif.raceResult.message",
      messageParams: { race: RACE_NAME },
    },
  },
];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-19T12:00:00Z"));
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/notifications**", (route) => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, NOTIFICATION_ROWS);
  });
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute(RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_passages**", (route) => json(route, []));
});

test("'Vis detaljer' på en samlet løbslinje åbner løbets resultat med eget hold synligt (#5417)", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  if (project === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });

  await login(page);
  await page.goto("/notifications");

  // Én linje for løbet (#5384) — fold den ud og brug knappen i bunden.
  const raceLine = page.getByText(new RegExp(`^${RACE_NAME}: (resultatet er klar|result is in)$`));
  await expect(raceLine).toBeVisible();
  await raceLine.click();
  const viewDetails = page.getByRole("button", { name: /^(Vis detaljer|View details)/ });
  await expect(viewDetails).toBeVisible();
  await viewDetails.click();

  await page.waitForURL((url) => !url.pathname.startsWith("/notifications"));

  if (project === "mobile-chromium" || project === "desktop-chromium") {
    const suffix = project === "mobile-chromium" ? "mobile-390" : "desktop-1280";
    await page.screenshot({
      path: evidenceShotPath(`pr-screens/5417-inbox-race-view-details/view-details-${suffix}.png`),
      fullPage: false,
    });
  }

  // Selve løbet, ikke resultat-hubben.
  await expect(page).toHaveURL(new RegExp(`/races/${RACE_ID}$`));
  await expect(page.getByRole("heading", { name: RACE_NAME })).toBeVisible();

  // Resultatet: "Sådan endte det" med spillerens egen rytter markeret som sin.
  await expect(page.getByRole("heading", { name: /^(Sådan endte det|How it ended)$/ })).toBeVisible();
  const ownRow = page.locator("tr.cz-me", { hasText: `${OWN_RIDER.firstname} ${OWN_RIDER.lastname}` });
  await ownRow.scrollIntoViewIfNeeded();
  await expect(ownRow).toBeVisible();
  await expect(ownRow).toContainText(TEST_TEAM.name);

  if (project === "mobile-chromium") {
    await page.screenshot({
      path: evidenceShotPath("pr-screens/5417-inbox-race-view-details/view-details-result-row-mobile-390.png"),
      fullPage: false,
    });
  }
});
