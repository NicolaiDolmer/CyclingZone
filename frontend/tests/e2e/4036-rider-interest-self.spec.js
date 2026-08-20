import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, TEST_USER, evidenceShotPath } from "./fixtures.js";

// #4036 (spiller-rapport 20/8): Interesse-fanen på en RIVAL-rytter må aldrig
// forveksle vieweren selv med en rival. Før denne rettelse blev al scout-/
// watchlist-aktivitet vist anonymt ("A rival scouted him" / generisk
// managerantal) — også når det var VIEWERENS EGET hold, hvilket spilleren
// rapporterede som misinformation (Discord 20/8, screenshot vedlagt issuet).
//
// rider-2 (fixture) ejes af RIVAL_TEAM, så viewer=team-e2e ser den som
// "scouting" (ikke egen rytter) — den relevante visning for #4036.
const RIDER_ID = "rider-2";

const INTEREST_PAYLOAD = {
  scouted_by_count: 2,
  scouts: null, // ikke ejer → who-scouts-panelet er skjult uanset
  viewer_scouted: true,
  feed: [
    {
      type: "scout",
      date: "2026-08-19T10:00:00.000Z",
      team_name: "E2E Racing", // egen team-navn — ikke en lækage (#4036)
      season: 3,
      self: true,
    },
    {
      type: "scout",
      date: "2026-08-18T10:00:00.000Z",
      team_name: null, // rivalens navn forbliver skjult (scouting-fog, #2798)
      season: 3,
      self: false,
    },
    {
      type: "watch",
      date: "2026-08-17T09:00:00.000Z",
      self: true,
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("interest tab labels the viewer's own scout/watch actions as 'you', not a rival (#4036)", async ({ page }, testInfo) => {
  await page.route("**/api/riders/*/interest", route => json(route, INTEREST_PAYLOAD));
  await page.route("**/api/riders/*/watchlist-count", route => json(route, { count: 2 }));
  // Vieweren er selv på ønskelisten for denne rytter → viewerWatching=true i UI'et.
  await page.route("**/rest/v1/rider_watchlist**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, [{ id: "wl-self", user_id: TEST_USER.id, rider_id: RIDER_ID, created_at: "2026-08-17T09:00:00.000Z" }]);
  });

  await login(page);
  await page.goto(`/riders/${RIDER_ID}?tab=interest`);

  // Feed: egne handlinger er tydeligt "dig", ikke en anonym rival.
  await expect(page.getByText(/^(You scouted him|Du scoutede ham)$/)).toBeVisible();
  await expect(page.getByText(/^(You added him to your watchlist|Du føjede ham til din liste)$/)).toBeVisible();
  // Rivalens event forbliver anonymt (scouting-fog, #2798) — ingen navn lækket.
  await expect(page.getByText(/^(A rival scouted him|En rival scoutede ham)$/)).toBeVisible();
  // Feed-linjen for vieverens eget event bruger "Du scoutede ham" — IKKE en
  // sætning der navngiver holdet ({team} scouted him ville se ud som en 3.
  // part fortalte om vieveren, ikke vieveren selv der ser sin egen handling).
  await expect(page.getByText(/^(E2E Racing scouted him|E2E Racing scoutede ham)$/)).toHaveCount(0);

  // Stat-kortene: "Scoutet af"-tallet inkluderer vieweren selv, så teksten må
  // IKKE kalde alle "rival teams" (ville være løgn om vieverens eget hold).
  await expect(page.getByText(/incl\. you|inkl\. dig/)).toHaveCount(2); // followers + scoutedBy
  await expect(page.getByText(/^\d+ rival team(s)?$/)).toHaveCount(0);

  await page.screenshot({
    path: evidenceShotPath(`pr-screens/4036-rider-interest-self-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("interest tab does NOT mislabel the viewer as self when a different team scouted (#4036 regression guard)", async ({ page }) => {
  await page.route("**/api/riders/*/interest", route => json(route, {
    scouted_by_count: 1,
    scouts: null,
    viewer_scouted: false,
    feed: [
      { type: "scout", date: "2026-08-18T10:00:00.000Z", team_name: null, season: 3, self: false },
    ],
  }));
  await page.route("**/api/riders/*/watchlist-count", route => json(route, { count: 0 }));
  await page.route("**/rest/v1/rider_watchlist**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, []); // vieweren følger IKKE selv rytteren
  });

  await login(page);
  await page.goto(`/riders/${RIDER_ID}?tab=interest`);

  await expect(page.getByText(/^(A rival scouted him|En rival scoutede ham)$/)).toBeVisible();
  await expect(page.getByText(/^(You scouted him|Du scoutede ham)$/)).toHaveCount(0);
  await expect(page.getByText(/incl\. you|inkl\. dig/)).toHaveCount(0);
});
