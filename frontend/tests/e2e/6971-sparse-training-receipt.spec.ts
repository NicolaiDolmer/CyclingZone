import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, evidenceShotPath } from "./fixtures.js";
import { SEED_TRAINING } from "../../src/preview/seedData.js";
import { trainingReceiptMock } from "../../src/preview/trainingReceiptMock.ts";

for (const mode of ["complete", "pending"] as const) {
  test(`#6971 ${mode}: first-time ability progress has documented percentages`, async ({ page }, testInfo) => {
    await page.clock.install({ time: new Date("2026-09-30T10:00:00Z") });
    await installNetworkMocks(page);
    const seed = trainingReceiptMock(SEED_TRAINING, mode)!;
    const todayRuns = seed.todayRuns.map(run => ({
      ...run, report: { ...run.report, riders: run.report.riders.map(rider => ({
        ...rider,
        progress_before: run.game_day === 0 ? {} : { sprint: 0.2 },
        progress_after: { sprint: 0.2 },
        gains: run.game_day === 0 ? { sprint: 1 } : {},
        gains_detail: run.game_day === 0 ? { sprint: { from: 54, to: 55 } } : {},
      })) },
    }));
    const data = { ...seed, todayRuns, todayRun: todayRuns.at(-1) };
    await page.route("**/api/training/me", route => json(route, data));
    await stabilizePage(page);
    await login(page);
    await page.goto("/training?tab=report");
    const receipt = page.locator('[data-testid="daily-training-receipt"][data-date="2026-09-29"]');
    await receipt.getByRole("button", { name: /Ada Pedersen/ }).click();
    const details = receipt.getByTestId("daily-receipt-rider-details");
    await expect(details).toContainText("120%");
    await expect(details.getByLabel("54 til 55")).toBeVisible();
    const sizes = await page.locator("main").evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    expect(sizes.content).toBeLessThanOrEqual(sizes.width + 1);
    await page.screenshot({ path: evidenceShotPath(`pr-screens/6971/${testInfo.project.name}-${mode}.png`), fullPage: false });
  });
}
