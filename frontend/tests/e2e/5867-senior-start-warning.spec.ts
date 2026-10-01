import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, TEST_TEAM, RIDERS } from "./fixtures.js";

test("#5867 dashboard warning follows the actual senior squad on desktop and mobile", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  let seniorCount = 5;
  await page.route("**/rest/v1/teams?*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("user_id") !== `eq.${TEST_TEAM.user_id}`) return route.fallback();
    return json(route, { ...TEST_TEAM, is_test_account: false, is_frozen: false, parked_at: null, retired_at: null });
  });
  await page.route("**/rest/v1/riders?*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("team_id") !== `eq.${TEST_TEAM.id}` ||
      !url.searchParams.get("select")?.includes("contract_end_season")) return route.fallback();
    return json(route, Array.from({ length: seniorCount }, (_, i) => ({
      ...RIDERS[0], id: `senior-${i + 1}`, squad: "senior", is_academy: false, is_retired: false,
    })));
  });

  await login(page);
  await page.goto("/dashboard");
  const warning = page.getByText(/Seniortrup: 5 af 6/);
  await expect(warning).toBeVisible();
  await expect(page.getByRole("link", { name: /Find en rytter/i })).toHaveAttribute("href", "/auctions");
  if (testInfo.project.name !== "mobile-webkit") {
    await warning.scrollIntoViewIfNeeded();
    const banner = warning.locator("..");
    await banner.evaluate((element: HTMLElement) => { element.style.display = "none"; });
    await page.screenshot({ path: testInfo.outputPath("before.png") });
    await banner.evaluate((element: HTMLElement) => { element.style.display = ""; });
    await page.screenshot({ path: testInfo.outputPath("after.png") });
  }

  seniorCount = 6;
  await page.reload();
  await expect(page.getByText("Division 2 · 6 ryttere")).toBeVisible();
  await expect(warning).toHaveCount(0);
});
