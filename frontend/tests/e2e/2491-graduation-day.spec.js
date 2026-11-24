import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

test("legacy Graduation Day redirects to Academy without the decision banner (#7323)", async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
  await login(page);
  await page.goto("/academy/graduation");
  await expect(page).toHaveURL(/\/academy$/);
  await expect(page.getByText(/Emil Kristiansen/i)).toBeVisible();
  await expect(page.locator('main a[href="/academy/graduation"]')).toHaveCount(0);
});
