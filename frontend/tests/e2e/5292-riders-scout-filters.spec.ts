import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, RIDERS, TEST_TEAM, evidenceShotPath } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-16T12:00:00Z"));
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);
});

test("filters, sort and page survive a rider visit and browser back", async ({ page }) => {
  await page.goto("/riders?q=Ada&nationality_code=dk&min_age=18&sort=firstname&sort_dir=asc&page=2");
  const search = page.getByTestId("filter-name");
  await expect(search).toHaveValue("Ada");
  const filteredUrl = page.url();
  await page.getByRole("link", { name: "Ada Pedersen", exact: true }).click();
  await expect(page).toHaveURL(/\/riders\/rider-1/);
  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
  await expect(search).toHaveValue("Ada");
  await expect(page.getByRole("link", { name: "Ada Pedersen", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/page=2/);
  await page.getByRole("link", { name: "Ada Pedersen", exact: true }).click();
  await page.getByRole("button", { name: "Tilbage", exact: true }).click();
  await expect(page).toHaveURL(filteredUrl);
  await expect(search).toHaveValue("Ada");
});

test("the existing session fallback restores filters on direct list navigation and a URL takes precedence", async ({ page }) => {
  await page.goto("/riders?q=Ada&sort=firstname&sort_dir=asc");
  await expect(page.getByTestId("filter-name")).toHaveValue("Ada");
  await page.getByRole("link", { name: "Ada Pedersen", exact: true }).click();
  await expect(page).toHaveURL(/\/riders\/rider-1/);
  await page.goto("/riders");
  await expect(page.getByTestId("filter-name")).toHaveValue("Ada");
  await expect(page).toHaveURL(/sort=firstname/);
  await page.goto("/riders?q=Mikkel");
  await expect(page.getByTestId("filter-name")).toHaveValue("Mikkel");
});

test("returning through history restores the URL filters while the list stays mounted", async ({ page }) => {
  await page.goto("/riders?q=Ada&nationality_code=dk");
  await expect(page.getByTestId("filter-name")).toHaveValue("Ada");
  // Follow the actual app link to the same route without a document reload.
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole("button", { name: /Åbn menu/ }).click();
  }
  await page.locator('a[href="/riders"]').filter({ visible: true }).first().click();
  await page.getByTestId("filter-name").fill("Sofie");
  await expect(page).toHaveURL(/q=Sofie/);
  await page.goBack();
  await expect(page.getByTestId("filter-name")).toHaveValue("Ada");
  await expect(page).toHaveURL(/q=Ada/);
  await page.goForward();
  await expect(page.getByTestId("filter-name")).toHaveValue("Sofie");
  await page.getByTestId("filter-reset").click();
  await expect(page.getByTestId("filter-name")).toHaveValue("");
  await page.reload();
  await expect(page.getByTestId("filter-name")).toHaveValue("");
});

test("rapid typing never loses characters to an older URL transition", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-webkit", "CPU throttling uses Chromium CDP; history is covered on every browser above.");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto("/riders");
  const input = page.getByTestId("filter-name");
  const historyLength = await page.evaluate(() => history.length);
  for (const name of ["Mikkel Hansen", "abcdefghijklmnopqrstuv", "Ada Pedersen"]) {
    await input.fill("");
    await input.pressSequentially(name, { delay: 0 });
    await expect(input).toHaveValue(name);
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(name);
  }
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.getByRole("link", { name: "Ada Pedersen", exact: true }).click();
  await page.goBack();
  await expect(input).toHaveValue("Ada Pedersen");
});

test("legacy filter URL normalizes once and reset stays empty after profile/back", async ({ page }) => {
  await page.goto("/riders?min_uci=150000&sort=uci_points&q=Ada");
  await expect.poll(() => new URL(page.url()).searchParams.get("min_value")).toBe("150000");
  await expect.poll(() => new URL(page.url()).searchParams.has("min_uci")).toBe(false);
  await page.getByTestId("filter-reset").click();
  await expect(page.getByTestId("filter-name")).toHaveValue("");
  await page.getByRole("link", { name: "Ada Pedersen", exact: true }).click();
  await page.goBack();
  await expect(page.getByTestId("filter-name")).toHaveValue("");
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("quick scout needs no column switch or horizontal scroll and stays on the filtered list", async ({ page }, testInfo) => {
  const requests: unknown[] = [];
  await page.route("**/api/scouting/me", route => json(route, {
    teamId: TEST_TEAM.id, maxLevel: 3, levels: {}, scoutSystemEnabled: true,
    jobModel: { capacity: 3, active: [] },
  }));
  await page.route("**/api/scouting/estimates", route => json(route, {
    estimates: Object.fromEntries(RIDERS.map(r => [r.id, r.team_id === TEST_TEAM.id
      ? { prog: { lo: 35, hi: 45 }, level: 3 }
      : { hidden: true, level: 0 }])),
  }));
  await page.route("**/api/scouting/assignments", route => {
    requests.push(route.request().postDataJSON());
    return json(route, { ok: true, assignment: { readyOn: "2026-09-17" } });
  });
  await page.goto("/riders?nationality_code=dk");
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Mikkel Hansen", exact: true }) });
  const scout = row.getByRole("button", { name: /^Scout$/ });
  await expect(scout).toBeVisible();
  // Mobile may need vertical scrolling to the second row. The action must
  // fit horizontally without revealing another column or the full table.
  const bounds = await scout.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const filteredUrl = page.url();
  await page.screenshot({ path: evidenceShotPath(`pr-screens/5292-riders-${testInfo.project.name}.png`), fullPage: true });
  await scout.click();
  await expect.poll(() => requests).toEqual([{ kind: "target", riderId: "rider-2" }]);
  await expect(page).toHaveURL(filteredUrl);
  await expect(page).toHaveURL(/nationality_code=dk/);
  await expect(scout).toHaveCount(0);
  await expect(row.getByText(/Rapport om/)).toBeVisible();
  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 375, height: 852 });
    await expect(page.getByRole("columnheader")).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("a rejected scout shows an error and preserves the filters for retry", async ({ page }) => {
  await page.route("**/api/scouting/me", route => json(route, {
    teamId: TEST_TEAM.id, maxLevel: 3, levels: {}, scoutSystemEnabled: true,
    jobModel: { capacity: 3, active: [] },
  }));
  await page.route("**/api/scouting/estimates", route => json(route, {
    estimates: { "rider-2": { hidden: true, level: 0 } },
  }));
  await page.route("**/api/scouting/assignments", route => json(route, { ok: false, error: "failed" }, 400));
  await page.goto("/riders?q=Mikkel");
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Mikkel Hansen", exact: true }) });
  await row.getByRole("button", { name: /^Scout$/ }).click();
  await expect(row.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("filter-name")).toHaveValue("Mikkel");
  await expect(row.getByRole("button", { name: /^Scout$/ })).toBeEnabled();
});
