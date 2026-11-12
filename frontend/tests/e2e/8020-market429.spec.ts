import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } from "./fixtures.js";

const NOW = Date.parse("2026-11-12T12:00:00Z");
test("#8020 initial 429 stays quiet and recovers only after manual retry beyond Retry-After", async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
  await installNetworkMocks(page); await stabilizePage(page);
  await page.addInitScript(user => {
    localStorage.setItem("sb-cycling-zone-e2e-auth-token", JSON.stringify({ access_token: "e2e-access-token", refresh_token: "e2e-refresh-token", token_type: "bearer", expires_at: 1893456000, user }));
  }, TEST_USER);
  let reads = 0;
  await page.route("**/api/transfers", route => {
    if (route.request().method() !== "GET") return route.fallback();
    reads += 1;
    if (reads === 1) return route.fulfill({ status: 429, contentType: "application/json", headers: { ...corsHeaders(route.request()), "Retry-After": "1", "Access-Control-Expose-Headers": "Retry-After" }, body: JSON.stringify({ error: "rate limited", retry_after_seconds: 1 }) });
    return json(route, [{ id: "listing-recovery-8020", rider_id: RIDERS[0].id, seller_team_id: TEST_TEAM.id, asking_price: 250000, status: "open", created_at: "2026-11-12T12:00:00Z", rider: { ...RIDERS[0], firstname: "Recovery", lastname: "Rider", team_id: TEST_TEAM.id }, seller: { id: TEST_TEAM.id, name: TEST_TEAM.name } }]);
  });
  await page.goto("/transfers?tab=market");
  const waiting = page.getByTestId("market-read-waiting");
  const retry = waiting.getByRole("button");
  await expect(waiting).toBeVisible(); await expect(retry).toBeVisible();
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  expect(reads).toBe(1);
  await retry.click();
  await expect(waiting).toBeVisible(); expect(reads).toBe(1);
  await page.clock.setFixedTime(new Date(NOW + 2000));
  await page.waitForTimeout(1100); expect(reads).toBe(1);
  await retry.click();
  await expect(waiting).toHaveCount(0);
  await expect(page.getByText("Recovery Rider", { exact: false }).first()).toBeVisible();
  expect(reads).toBe(2);
});
