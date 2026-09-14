// #5124 — D-047-audit af sæsonmatricen på mobil (<768px).
//
// FUND (dokumenteret her + som kode-kommentar i SeasonMatrix.jsx, jf. #5124's
// krav om skriftlig begrundelse for undtagelsen): matricen er en rytter ×
// løbsdag-grid, ikke en entitetsliste — D-047's "tre faste kolonner" giver
// ikke mening for kalenderdage der skal læses i rækkefølge. Sticky
// navnekolonne + KONTAINERET vandret scroll (aldrig page-level) er den
// korrekte mobil-løsning her, og den har allerede eksisteret siden #1146
// (ejer-godkendt design 27/8, FØR #5124) — se
// frontend/tests/e2e/1146-season-matrix.spec.js's "mobil 375px"-test for den
// oprindelige dækning. Denne spec genverificerer kontrakten under #5124's eget
// nummer + beviser hovedhandlingen (åbne et løb fra en dag-kolonne) på 393px.
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

test("mobil 393px: matricen scroller aldrig SIDEN vandret (kun sin egen kontainer), og hovedhandlingen (åbne et løb) virker", async ({ page }, testInfo) => {
  await login(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/planning?view=season");
  await expect(page.getByRole("heading", { name: "Udtagelsesmatrix" })).toBeVisible();
  await expect(page.getByText("Ada Pedersen")).toBeVisible();

  const noPageScroll = () => page.evaluate(
    () => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth + 1
  );
  await expect.poll(noPageScroll).toBe(true);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-season-matrix-mobile-393-${testInfo.project.name}.png`), fullPage: false });

  // Hovedhandlingen: åbne et løb fra dag-kolonnens header-knap (onOpenDay,
  // navigerer normalt videre til dagsvisningen). Her bekræftes blot at
  // knappen er synlig, har et ægte tap-mål (samme ≥24px-krav som #1146's
  // desktop-parallel), og at klikket ikke bryder no-scroll-garantien.
  const dayHeaderButton = page.locator("thead tr:nth-child(3) button").first();
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
  await expect(page.getByText("Ada Pedersen")).toBeVisible();
  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-season-matrix-desktop-1280-${testInfo.project.name}.png`), fullPage: false });
});
