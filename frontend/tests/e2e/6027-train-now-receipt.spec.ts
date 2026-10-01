import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, evidenceShotPath } from "./fixtures.js";
import { SEED_TRAINING, RIDERS, TEST_TEAM } from "../../src/preview/seedData.js";

// #6027: Train now settles race days 1-4 of the date; the final race day (and the
// one fatigue/form write) waits for the evening settlement. Before that, the
// report must show what was already trained, not an empty "Awaiting settlement".
const date = "2026-09-29";
const own = RIDERS.filter(rider => rider.team_id === TEST_TEAM.id);
const waitingRider = { ...own[0], id: "e2e-6027-waiting-rider", firstname: "Bo", lastname: "Lund" };

function trainedNowMock() {
  const days = [0, 1, 2, 3];
  const todayRuns = days.map(day => ({
    id: `train-now-${day}`, tick_date: date, season_id: "receipt-season", squad: "senior", game_day: day,
    executed_by: "manager", bonus_applied: false, created_at: `2026-09-29T15:0${day}:00Z`,
    report: { condition_per_date: true, condition_settled: false, date_game_days: [0, 1, 2, 3, 4],
      riders: own.map(rider => ({
        rider_id: rider.id, name: `${rider.firstname} ${rider.lastname}`,
        game_day: day, focus: "sprint", intensity: day === 2 ? "hard" : "normal",
        race_day: false, status: "normal", settlement_status: "complete",
        gains: day === 3 ? { sprint: 1 } : {},
        gains_detail: day === 3 ? { sprint: { from: 54, to: 55 } } : {},
        progress_before: { sprint: [0.5, 0.65, 0.8, 0.95][day] },
        progress_after: { sprint: [0.65, 0.8, 0.95, 0.1][day] },
        condition_before_date: { form: 52, fatigue: 11 }, form: 52, fatigue: 11, fatigue_delta: 0, injured: false,
      })),
    },
  }));
  const trainingScore = Object.fromEntries(own.map(rider => [rider.id, {
    sessions: days.map(day => ({ date, seasonId: "receipt-season", gameDay: day, score: [52, 54, 61, 57][day], raceDay: false })),
  }]));
  return { ...SEED_TRAINING, todayRun: todayRuns.at(-1), todayRuns, trainingScore, dailyReceiptEnabled: true };
}

async function openReport(page: import("@playwright/test").Page) {
  await page.clock.install({ time: new Date("2026-09-29T17:00:00Z") });
  await installNetworkMocks(page);
  await page.route("**/api/training/me", route => json(route, trainedNowMock()));
  await page.route("**/rest/v1/riders?**", route => {
    const url = route.request().url();
    if (!url.includes("contract_end_season")) return route.fallback();
    return json(route, [...own, waitingRider]);
  });
  await stabilizePage(page);
  await login(page);
  await page.goto("/training?tab=report");
  const receipt = page.locator(`[data-testid="daily-training-receipt"][data-date="${date}"]`);
  await expect(receipt).toBeVisible();
  return receipt;
}

const phase = process.env.CZ_6027_PHASE ?? "after";
for (const width of [1440, 390]) {
  test(`#6027 ${width}px: an unsettled date shows race days 1-4 trained now`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "viewport set explicitly");
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const receipt = await openReport(page);
    await page.screenshot({ path: evidenceShotPath(`pr-screens/6027/${phase}-${width}.png`), fullPage: false });

    await expect(receipt).toHaveAttribute("data-status", "pending");
    await expect(receipt.getByTestId("daily-receipt-status")).toHaveText(/1-4/);
    await expect(receipt.getByTestId("daily-receipt-trained-now-note")).toBeVisible();
    await expect(receipt.getByTestId("daily-receipt-trained-now-count")).toContainText(String(own.length));
    const waiting = receipt.getByTestId("daily-receipt-waiting");
    await expect(waiting).toHaveCount(1);
    await expect(waiting).toContainText("Bo Lund");

    await receipt.getByRole("button", { name: /Ada Pedersen/ }).click();
    const details = receipt.getByTestId("daily-receipt-rider-details");
    await expect(details.locator("ol li")).toHaveCount(4);
    await expect(details.getByTestId("daily-receipt-pass-score")).toHaveText(["Score: 52", "Score: 54", "Score: 61", "Score: 57"]);
    await expect(details.getByLabel("54 til 55")).toBeVisible();
    await expect(details).toContainText("+60%");
    // Fatigue and form stay with the evening settlement.
    await expect(details.getByLabel(/11 til/)).toHaveCount(0);

    const sizes = await page.locator("main").evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    expect(sizes.content).toBeLessThanOrEqual(sizes.width + 1);
    await page.screenshot({ path: evidenceShotPath(`pr-screens/6027/${phase}-${width}-open.png`), fullPage: false });
  });
}
