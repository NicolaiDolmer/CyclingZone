import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, evidenceShotPath } from "./fixtures.js";
import { SEED_TRAINING, RIDERS, TEST_TEAM } from "../../src/preview/seedData.js";

// #6111: from the first race-day tick (just after midnight) until the evening
// settlement, today's date is "pending". The season receipt treated ANY pending
// date as an unknown season, so the rider's Training tab and the Development
// tab's "This season" showed "—" for every rider most of the day, even though
// the gains of the stored race days were already in the abilities.
const own = RIDERS.filter(rider => rider.team_id === TEST_TEAM.id);
const ada = own.find(rider => rider.id === "rider-1")!;
const SEASON = "season-e2e";

type Day = { date: string; gameDay: number; settled: boolean; gain: boolean };
function trainingRun({ date, gameDay, settled, gain }: Day) {
  return {
    id: `${date}-${gameDay}`, tick_date: date, season_id: SEASON, squad: "senior", game_day: gameDay,
    executed_by: "cron", bonus_applied: false, created_at: `${date}T0${gameDay}:00:00Z`,
    report: { condition_per_date: true, condition_settled: settled, date_game_days: [0, 1, 2, 3, 4],
      riders: own.map(rider => ({
        rider_id: rider.id, name: `${rider.firstname} ${rider.lastname}`, game_day: gameDay,
        focus: "sprint", intensity: "normal", race_day: false, status: "normal", settlement_status: "complete",
        gains: gain ? { sprint: 1 } : {},
        gains_detail: gain ? { sprint: { from: 54, to: 55 } } : {},
        progress_before: { sprint: 0.5 }, progress_after: { sprint: gain ? 0.1 : 0.6 },
        condition_before_date: { form: 52, fatigue: 11 }, form: 52, fatigue: 11, fatigue_delta: 0, injured: false,
      })),
    },
  };
}

// 4/5 is settled (one whole point); 6/5 has race days 1-4 stored, one more point,
// and waits for its evening settlement. Expected season total: +2.
const settledDay = [0, 1, 2, 3, 4].map(gameDay => trainingRun({ date: "2026-05-04", gameDay, settled: gameDay === 4, gain: gameDay === 1 }));
const todayRuns = [0, 1, 2, 3].map(gameDay => trainingRun({ date: "2026-05-06", gameDay, settled: false, gain: gameDay === 3 }));

async function setup(page: import("@playwright/test").Page) {
  await page.clock.install({ time: new Date("2026-05-06T10:00:00Z") });
  await installNetworkMocks(page);
  await page.route("**/api/training/me**", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, {
      ...SEED_TRAINING, plans: { [ada.id]: { focus: "sprint", intensity: "normal" } },
      todayRun: todayRuns.at(-1), todayRuns, dailyReceiptEnabled: true,
    });
  });
  await page.route("**/rest/v1/training_day_runs**", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, [...todayRuns, ...settledDay]);
  });
  await stabilizePage(page);
  await login(page);
}

const phase = process.env.CZ_6111_PHASE ?? "after";
for (const width of [1440, 390]) {
  test(`#6111 ${width}px: the Development tab's season receipt counts today's stored race days`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "viewport set explicitly");
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await setup(page);
    await page.goto("/training?tab=development");
    const row = page.getByTestId("training-season-overview-row").filter({ hasText: "Ada Pedersen" });
    await expect(row).toBeVisible();
    await page.screenshot({ path: evidenceShotPath(`pr-screens/6111/${phase}-development-${width}.png`), fullPage: false });
    await expect(row.getByText("+2", { exact: true }).first()).toBeVisible();
    const sizes = await page.locator("main").evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    expect(sizes.content).toBeLessThanOrEqual(sizes.width + 1);
  });

  test(`#6111 ${width}px: the rider's Training tab shows the season's gains before the evening settlement`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "viewport set explicitly");
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await setup(page);
    await page.goto(`/riders/${ada.id}?tab=training`);
    const receipt = page.locator("div.bg-cz-card").filter({ has: page.getByRole("heading", { name: "Denne sæson" }) });
    await expect(receipt).toBeVisible();
    await receipt.scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidenceShotPath(`pr-screens/6111/${phase}-rider-training-${width}.png`), fullPage: false });
    await expect(receipt.getByText("+2", { exact: true })).toBeVisible();
    // The note no longer says the season is still being fetched.
    await expect(receipt).not.toContainText("Sæsonens tal vises, når den aktive sæson er hentet.");
  });
}
