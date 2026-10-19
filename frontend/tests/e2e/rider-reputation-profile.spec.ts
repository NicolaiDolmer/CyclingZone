import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, RIDERS } from "./fixtures.js";

const reputationEvents = [
  { event_kind: "stage_win", form_points: 0.6, race: { name: "Tour de Preview" } },
  { event_kind: "stage_podium", form_points: 0.4, race: { name: "Tour de Preview" } },
  { event_kind: "gc_top10", form_points: 0.3, race: { name: "Preview Tour" } },
  { event_kind: "one_day_top10", form_points: 0.2, race: { name: "Preview Classic" } },
  { event_kind: "leader_day", form_points: 0.1, race: { name: "Preview Tour" } },
];

test("rider reputation is a tappable summary with all fetched events", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/display-flags", (route) => json(route, { rider_reputation_enabled: true }));
  await page.route("**/rest/v1/riders*", (route) => {
    const request = route.request();
    const rider = { ...RIDERS[0], popularity: 3, reputation: 3, team: { id: "team-e2e", name: "E2E Racing" } };
    const body = request.headers().accept?.includes("vnd.pgrst.object") ? rider : [rider];
    return json(route, body);
  });
  await page.route("**/rest/v1/rider_reputation_events*", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, reputationEvents);
  });

  await login(page);
  await page.goto("/riders/rider-1");
  await expect(page.getByRole("heading", { name: "Ada Pedersen" })).toBeVisible();
  const reputation = page.getByRole("button", { name: "Ukendt" });
  await expect(reputation).toBeVisible();
  await expect(reputation.locator("svg")).toBeVisible();
  await expect(page.getByText("3 / 20 til Kendt")).toBeVisible();
  await expect(page.getByText("Hvorfor omdømmet flyttede sig")).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await reputation.evaluate((element) => getComputedStyle(element).cursor)).toBe("pointer");
  await page.screenshot({ path: "test-results/rider-reputation-desktop-closed.png" });
  await reputation.click();
  const details = page.getByRole("dialog", { name: "Hvorfor omdømmet flyttede sig" });
  await expect(details).toBeVisible();
  await expect(details).toHaveAttribute("aria-modal", "true");
  await expect(details).toHaveAttribute("aria-labelledby", "rider-reputation-dialog-title");
  expect(await details.evaluate((element) => element.parentElement === document.body)).toBe(true);
  await expect(details.getByText("+0,6")).toBeVisible();
  await expect(details.getByText("Preview Tour").first()).toBeVisible();
  await expect(details.getByText("+0,1")).toBeVisible();
  await expect(details.locator("li")).toHaveCount(5);
  await expect(details.getByText("Sejre og store løb tæller mest")).toBeVisible();
  const helpLink = details.getByRole("link", { name: "Sådan virker omdømme" });
  await expect(helpLink).toBeVisible();
  await expect(helpLink).toBeInViewport();
  await expect(helpLink).toHaveAttribute("href", "/help?section=riders");
  expect(await reputation.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
  await page.screenshot({ path: "test-results/rider-reputation-desktop-open.png" });
  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await expect(details).toHaveCount(0);
  await reputation.click();
  await expect(details).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect(details).toHaveCount(0);
  await reputation.click();
  await expect(details).toBeVisible();
  await reputation.click();
  await expect(details).toHaveCount(0);
  await reputation.focus();
  await page.keyboard.press("Enter");
  await expect(details).toBeVisible();
  const closeButton = details.getByRole("button", { name: "Luk" });
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(helpLink).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(reputation).toBeFocused();
  await reputation.click();
  await expect(details).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await reputation.click();
  await expect(details).toBeVisible();
  const mobileBounds = await details.boundingBox();
  expect(mobileBounds).not.toBeNull();
  expect(mobileBounds!.x).toBeGreaterThanOrEqual(0);
  expect(mobileBounds!.x + mobileBounds!.width).toBeLessThanOrEqual(375);
  expect(mobileBounds!.y + mobileBounds!.height).toBeLessThanOrEqual(756);
  await page.screenshot({ path: "test-results/rider-reputation-mobile.png" });
  await expect(details.getByText("+0,1")).toBeVisible();
  await details.getByRole("button", { name: "Luk" }).click();
  await expect(details).toHaveCount(0);
  await page.screenshot({ path: "test-results/rider-reputation-mobile-closed.png" });
  await reputation.click();
  await expect(details).toBeVisible();
  await page.getByRole("heading", { name: "Ada Pedersen" }).click();
  await expect(details).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await reputation.click();
  await expect(helpLink).toBeVisible();
  await helpLink.click();
  await expect(page).toHaveURL(/\/help\?section=riders/);
});
