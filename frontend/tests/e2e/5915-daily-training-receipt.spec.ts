import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, evidenceShotPath } from "./fixtures.js";
import { SEED_TRAINING } from "../../src/preview/seedData.js";
import { trainingReceiptMock } from "../../src/preview/trainingReceiptMock.ts";

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
    } else {
      await expect(date.getByLabel("11 til 19")).toHaveCount(0);
    }
    const sizes=await page.locator("main").evaluate(el=>({width:el.clientWidth,content:el.scrollWidth}));
    expect(sizes.content).toBeLessThanOrEqual(sizes.width+1);
    await page.screenshot({ path:evidenceShotPath(`pr-screens/5915/${testInfo.project.name}-${mode}.png`),fullPage:false });
  });
}
