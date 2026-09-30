import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, evidenceShotPath } from "./fixtures.js";
import { SEED_TRAINING } from "../../src/preview/seedData.js";
import { trainingReceiptMock } from "../../src/preview/trainingReceiptMock.ts";

test("#5915 score flag off: receipt keeps its layout without score fields",async({page})=>{
  await page.clock.install({time:new Date("2026-09-30T10:00:00Z")});
  await installNetworkMocks(page);
  const data=trainingReceiptMock(SEED_TRAINING,"complete")!;
  delete (data as Record<string,unknown>).trainingScore;
  await page.route("**/api/training/me",route=>json(route,data));
  await stabilizePage(page);
  await login(page);
  await page.goto("/training?tab=report");
  const date=page.locator('[data-testid="daily-training-receipt"][data-date="2026-09-29"]');
  await date.getByRole("button",{name:/Ada Pedersen/}).click();
  await expect(date.getByTestId("daily-receipt-latest-score")).toHaveCount(0);
  await expect(date.getByTestId("daily-receipt-mobile-score")).toHaveCount(0);
  await expect(date.getByTestId("daily-receipt-pass-score")).toHaveCount(0);
  await expect(date.getByLabel("54 til 56")).toBeVisible();
});

for (const mode of ["complete","pending","reconciliation"]) {
  test(`#5915 ${mode}: date receipt preserves evidence and expands the rider inline`,async({page},testInfo)=>{
    await page.clock.install({time:new Date("2026-09-30T10:00:00Z")});
    await installNetworkMocks(page);
    await page.route("**/api/training/me",route=>json(route,trainingReceiptMock(SEED_TRAINING,mode)));
    await stabilizePage(page);
    await login(page);
    await page.goto("/training?tab=report");
    const date=page.locator('[data-testid="daily-training-receipt"][data-date="2026-09-29"]');
    await expect(date).toHaveAttribute("data-status",mode==="complete"?"complete":mode==="pending"?"pending":"reconciliation");
    await expect(page.locator('[data-testid="daily-training-receipt"][data-date="2026-09-29"]')).toHaveCount(1);
    await date.getByRole("button",{name:/Ada Pedersen/}).click();
    const details=date.getByTestId("daily-receipt-rider-details");
    await expect(details).toBeVisible();
    await expect(details.locator("ol li")).toHaveCount(mode==="pending"?3:5);
    if(mode==="complete") {
      await expect(details.getByLabel("54 til 56")).toBeVisible();
      await expect(details).toContainText("140%");
      await expect(date.getByTestId("daily-receipt-latest-score")).toHaveText("56");
      await expect(details.getByTestId("daily-receipt-pass-score")).toHaveText(["Score: 52","Score: 55","Score: 56"]);
      await expect(date.getByTestId("daily-receipt-mobile-score")).toHaveText("Seneste passcore: 56");
    } else {
      await expect(date.getByLabel("11 til 19")).toHaveCount(0);
      await expect(date.getByTestId("daily-receipt-latest-score")).toHaveText("—");
      for (const score of await details.getByTestId("daily-receipt-pass-score").allTextContents()) expect(score).toBe("Score: —");
    }
    const sizes=await page.locator("main").evaluate(el=>({width:el.clientWidth,content:el.scrollWidth}));
    expect(sizes.content).toBeLessThanOrEqual(sizes.width+1);
    await page.screenshot({ path:evidenceShotPath(`pr-screens/5915/${testInfo.project.name}-${mode}.png`),fullPage:false });
  });
}
