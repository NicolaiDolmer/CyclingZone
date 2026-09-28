// #5124 — ejerens A-go 28/9: én valgt race, tre ordnede løbsdage, eksplicit
// Før/Senere og ingen vandret scroll i matrix eller side på telefonen. Desktop
// beholder den fulde tabel; begge layouts bruger samme dag-header-handling.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, corsHeaders, evidenceShotPath } from "./fixtures.js";

const ABILITIES = Object.fromEntries(
  ["climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone", "acceleration",
    "recovery", "tactics", "positioning", "flat", "tempo", "durability", "aggression", "descending"]
    .map((k) => [k, 60])
);

const SEASON_MATRIX_BODY = {
  enabled: true,
  season: { id: "season-5124-1", number: 1 },
  ownPoolId: 2,
  readOnly: false,
  races: [
    { id: "r1", name: "Grand Prix de Namur", raceClass: "Class2", stages: 1, status: "scheduled", stagesCompleted: 0,
      gameDayStart: 12, gameDayEnd: 12, restGameDays: [], sizeMin: 6, sizeMax: 6, demandVector: { sprint: 1 } },
    { id: "r2", name: "Tour des Hauts Plateaux", raceClass: "ProSeries", stages: 4, status: "scheduled", stagesCompleted: 0,
      gameDayStart: 14, gameDayEnd: 17, restGameDays: [16], sizeMin: 6, sizeMax: 6, demandVector: { climbing: 0.6, tempo: 0.4 } },
  ],
  riders: [
    { id: "rider-1", name: "Ada Pedersen", primaryType: "climber", secondaryType: null, abilities: ABILITIES, injured: false },
    { id: "rider-2", name: "Bo Madsen", primaryType: "sprinter", secondaryType: null, abilities: ABILITIES, injured: false },
  ],
  entries: [],
  dayDates: [
    { gameDay: 12, date: "2026-07-02" },
    { gameDay: 14, date: "2026-07-04" }, { gameDay: 15, date: "2026-07-05" },
    { gameDay: 16, date: "2026-07-06" }, { gameDay: 17, date: "2026-07-07" },
  ],
};

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/races/selection/season**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders(request), body: JSON.stringify(SEASON_MATRIX_BODY) });
  });
});

test("mobil 393px: tre løbsdage uden vandret scroll og dag-headeren åbner board", async ({ page }, testInfo) => {
  await login(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/planning?view=season");
  await expect(page.getByRole("heading", { name: "Udtagelsesmatrix" })).toBeVisible();
  const mobile = page.getByTestId("season-matrix-mobile");
  await expect(mobile.getByText("Ada Pedersen")).toBeVisible();
  await mobile.getByLabel("Løb").selectOption("r2");
  await expect(mobile.getByText("Dage 1-3 af 4")).toBeVisible();

  const noPageScroll = () => page.evaluate(
    () => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth + 1
  );
  await expect.poll(noPageScroll).toBe(true);
  await expect.poll(() => mobile.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-season-matrix-mobile-393-${testInfo.project.name}.png`), fullPage: false });

  // Den delte onOpenDay-handling skal fortsat have et rigtigt tap-mål.
  const dayHeaderButton = mobile.locator("thead button").first();
  await expect(dayHeaderButton).toBeVisible();
  const box = await dayHeaderButton.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  await dayHeaderButton.click();
  await expect.poll(noPageScroll).toBe(true);
});

test("desktop 1280px: uændret", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only regressionstjek.");
  await login(page);
  await page.goto("/planning?view=season");
  await expect(page.getByRole("heading", { name: "Udtagelsesmatrix" })).toBeVisible();
  await expect(page.getByTestId("season-matrix-desktop").getByText("Ada Pedersen")).toBeVisible();
  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-season-matrix-desktop-1280-${testInfo.project.name}.png`), fullPage: false });
});
