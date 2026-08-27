// #1146 — sæsonmatrixen (rytter × løbsdag) i Season-visningen. Targeted spec
// (verify-affected-niveau, ikke fuld suite — orkestratoren ejer e2e-slottet).
// Egen route-override for GET /api/races/selection/season (endpointet findes
// endnu ikke i den delte preview-mock, #1146 er den første forbruger) — samme
// LIFO-override-mønster som 4165-planning-load-error.spec.js.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, corsHeaders, evidenceShotPath } from "./fixtures.js";

const ABILITIES = Object.fromEntries(
  ["climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone", "acceleration",
    "recovery", "tactics", "positioning", "flat", "tempo", "durability", "aggression", "descending"]
    .map((k) => [k, 60])
);

const SEASON_MATRIX_BODY = {
  enabled: true,
  season: { id: "season-e2e-1", number: 1 },
  ownPoolId: 2,
  readOnly: false,
  races: [
    { id: "r1", name: "Grand Prix de Namur", raceClass: "Class2", stages: 1, status: "scheduled", stagesCompleted: 0,
      gameDayStart: 12, gameDayEnd: 12, restGameDays: [], sizeMin: 6, sizeMax: 6, demandVector: { sprint: 1 } },
    { id: "r2", name: "Tour des Hauts Plateaux", raceClass: "ProSeries", stages: 4, status: "scheduled", stagesCompleted: 0,
      gameDayStart: 14, gameDayEnd: 17, restGameDays: [16], sizeMin: 6, sizeMax: 6, demandVector: { climbing: 0.6, tempo: 0.4 } },
    { id: "r3", name: "Giro Veneto", raceClass: "Class1", stages: 1, status: "scheduled", stagesCompleted: 0,
      gameDayStart: 20, gameDayEnd: 20, restGameDays: [], sizeMin: 6, sizeMax: 6, demandVector: { climbing: 1 } },
  ],
  riders: [
    { id: "rider-1", name: "Ada Pedersen", primaryType: "climber", secondaryType: null, abilities: ABILITIES, injured: false },
    { id: "rider-2", name: "Bo Madsen", primaryType: "sprinter", secondaryType: null, abilities: ABILITIES, injured: false },
    { id: "rider-3", name: "Cecilie Holm", primaryType: "allrounder", secondaryType: null, abilities: ABILITIES, injured: false },
  ],
  entries: [
    { raceId: "r1", riderId: "rider-1", raceRole: "captain" },
    { raceId: "r1", riderId: "rider-2", raceRole: "helper" },
    { raceId: "r2", riderId: "rider-1", raceRole: "captain" },
  ],
  dayDates: [
    { gameDay: 12, date: "2026-07-02" },
    { gameDay: 14, date: "2026-07-04" }, { gameDay: 15, date: "2026-07-05" },
    { gameDay: 16, date: "2026-07-06" }, { gameDay: 17, date: "2026-07-07" },
    { gameDay: 20, date: "2026-07-10" },
  ],
};

async function mockSelectionSeason(page, body = SEASON_MATRIX_BODY) {
  await page.route("**/api/races/selection/season**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders(request), body: JSON.stringify(body) });
  });
}

test.describe("Sæsonmatrix (#1146)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
    await mockSelectionSeason(page);
  });

  test("gitteret viser rytter-rækker, løbsdags-kolonner og en gemt udtagelse som ét sammenhængende spænd", async ({ page }, testInfo) => {
    await login(page);
    await page.goto("/planning?view=season");

    await expect(page.getByRole("heading", { name: "Udtagelsesmatrix" })).toBeVisible();
    await expect(page.getByText("Ada Pedersen")).toBeVisible();
    await expect(page.getByText("Bo Madsen")).toBeVisible();

    // #4217/#3470: Tour des Hauts Plateaux (gameDay 14-17, hviledag 16) er ÉT
    // sammenhængende spænd for Ada — findes som ét klikbart element med
    // rolle+løbsnavn i sin title, ikke fire separate dag-celler.
    const gtCell = page.getByTitle(/Ada Pedersen, Tour des Hauts Plateaux/);
    await expect(gtCell).toHaveCount(1);

    // Ingen ugemte ændringer endnu → "Gem plan" er ikke synlig (kontrakt #4: kun
    // ÉN gold knap, og kun når kladden reelt afviger fra serveren).
    await expect(page.getByRole("button", { name: "Gem plan" })).toHaveCount(0);

    await page.screenshot({ path: evidenceShotPath(`pr-screens/1146-season-matrix-${testInfo.project.name}.png`), fullPage: false });
  });

  test("celle-klik på en tom celle laver en kladde-ændring og viser 'Gem plan'", async ({ page }) => {
    await login(page);
    await page.goto("/planning?view=season");
    await expect(page.getByRole("heading", { name: "Udtagelsesmatrix" })).toBeVisible();

    // Cecilie Holm er ikke udtaget til Giro Veneto (r3, dag 20) — en tom, klikbar celle.
    const emptyCell = page.getByTitle(/Cecilie Holm, Giro Veneto/);
    await expect(emptyCell).toBeVisible();
    await emptyCell.click();

    await expect(page.getByRole("button", { name: "Gem plan" })).toBeVisible();
  });

  test("mobil 375px: vandret scroll + sticky rytter-kolonne, dag-kolonne-headeren har et tap-mål ≥24px", async ({ page }, testInfo) => {
    await login(page);
    await page.goto("/planning?view=season");
    await expect(page.getByRole("heading", { name: "Udtagelsesmatrix" })).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("heading", { name: "Udtagelsesmatrix" })).toBeVisible();

    // Body scroller ALDRIG vandret (hård regel) — kun gitterets egen container gør.
    const bodyOverflowX = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(bodyOverflowX).toBe(true);

    const dayHeaderButton = page.locator("thead tr:nth-child(3) button").first();
    const box = await dayHeaderButton.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);

    await page.screenshot({ path: evidenceShotPath(`pr-screens/1146-season-matrix-mobile-375-${testInfo.project.name}.png`), fullPage: false });
  });
});
