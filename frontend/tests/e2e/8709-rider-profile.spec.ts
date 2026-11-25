import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

test("rider header renders while trading data is still pending", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-25T12:00:00Z"));
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/rest/v1/auctions?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("rider_id") === "eq.rider-1") await gate;
    await route.fallback();
  });
  try {
    await page.goto("/riders/rider-1");
    await expect(page.getByRole("heading", { name: "Ada Pedersen", exact: true })).toBeVisible();
    await expect(page.locator('[data-loading-region="rider-market"]')).toHaveAttribute("aria-busy", "true");
  } finally {
    release();
  }
});
