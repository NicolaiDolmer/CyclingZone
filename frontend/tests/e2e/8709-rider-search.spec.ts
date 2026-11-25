import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, json, login, stabilizePage } from "./fixtures.js";

test("rider results render while auction status is still pending", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);

  let releaseAuction: () => void = () => {};
  const auctionGate = new Promise<void>((resolve) => { releaseAuction = resolve; });
  let auctionRequested = false;
  await page.route("**/rest/v1/auctions?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("select") !== "rider_id") {
      await route.fallback();
      return;
    }
    auctionRequested = true;
    await auctionGate;
    await json(route, [{ rider_id: "rider-1" }]);
  });

  try {
    await page.goto("/riders?q=Ada");
    await expect.poll(() => auctionRequested).toBe(true);
    await expect(page.getByRole("link", { name: "Ada Pedersen", exact: true })).toBeVisible({ timeout: 3000 });
  } finally {
    releaseAuction();
  }
});
