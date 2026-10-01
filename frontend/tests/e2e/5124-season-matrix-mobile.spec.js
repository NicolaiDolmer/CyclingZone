// #5124 — ejerens A-go 28/9: én valgt race, tre ordnede løbsdage, eksplicit
// Før/Senere og ingen vandret scroll i matrix eller side på telefonen. Desktop
// beholder den fulde tabel; begge layouts bruger samme dag-header-handling.
// Ejer 1/10: visningen ligger bag stadie-flaget season_matrix_mobile (beta
// først). Flag fra = den fulde tabel på alle bredder, præcis som før.
import fs from "node:fs";
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
  entries: [
    { raceId: "r2", riderId: "rider-1", raceRole: "captain" },
  ],
  dayDates: [
    { gameDay: 12, date: "2026-07-02" },
    { gameDay: 14, date: "2026-07-04" }, { gameDay: 15, date: "2026-07-05" },
    { gameDay: 16, date: "2026-07-06" }, { gameDay: 17, date: "2026-07-07" },
  ],
};

// Spiller-svaret fra GET /api/feature-flags (featureFlagsApi.js). Den generiske
// /api/**-fallback svarer {} = alt off, så flag-on skal mockes eksplicit.
async function mockMobileFlag(page, on) {
  await page.route("**/api/feature-flags**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({
      status: 200, contentType: "application/json", headers: corsHeaders(request),
      body: JSON.stringify({ flags: { season_matrix_mobile: on } }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/races/selection/season**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders(request), body: JSON.stringify(SEASON_MATRIX_BODY) });
  });
});

test("beta: mobil 393px viser tre løbsdage uden vandret scroll, og dag-headeren åbner board", async ({ page }, testInfo) => {
  await mockMobileFlag(page, true);
  await login(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/planning?view=season");
  await expect(page.getByRole("heading", { name: "Udtagelsesmatrix" })).toBeVisible();
  const mobile = page.getByTestId("season-matrix-mobile");
  await expect(mobile.getByText("Ada Pedersen")).toBeVisible();
  await expect(page.getByTestId("season-matrix-desktop")).toBeHidden();
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

test("flag fra: mobil 393px viser den fulde tabel præcis som før (ingen mobilvisning)", async ({ page }) => {
  await mockMobileFlag(page, false);
  await login(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/planning?view=season");
  await expect(page.getByRole("heading", { name: "Udtagelsesmatrix" })).toBeVisible();
  await expect(page.getByTestId("season-matrix-mobile")).toHaveCount(0);
  const full = page.getByTestId("season-matrix-desktop");
  await expect(full).toBeVisible();
  await expect(full.getByText("Ada Pedersen")).toBeVisible();
  // Den fulde tabel scroller i sin egen container, aldrig siden.
  const bodyOverflowX = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(bodyOverflowX).toBe(true);
});

test("linse-kontrollen er hairline 5px uden fyldt guld og har tryk-mål ≥32px på mobil", async ({ page }) => {
  await mockMobileFlag(page, false);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/planning?view=season");
  await expect(page.getByRole("heading", { name: "Udtagelsesmatrix" })).toBeVisible();
  const group = page.getByRole("group", { name: "Udtagelsesmatrix" });
  await expect(group).toBeVisible();
  const lens = group.getByRole("button", { name: "Rutematch" });
  const problems = page.getByRole("button", { name: "Kun problemer" });
  for (const control of [lens, problems]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
    expect(box?.height ?? 99).toBeLessThanOrEqual(40);
  }
  const groupRadius = await group.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(groupRadius).toBe("5px");
  // Linserne står i én række inden for telefonens bredde.
  const groupBox = await group.boundingBox();
  expect(groupBox?.height ?? 99).toBeLessThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  // Aktiv linse er guld-TEKST, ikke en fyldt guld-flade ved siden af "Gem plan".
  await lens.click();
  await expect(lens).toHaveAttribute("aria-pressed", "true");
  const text = await lens.evaluate((el) => getComputedStyle(el).textTransform);
  expect(text).toBe("none");
});

test("desktop 1280px: uændret med flaget tændt", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only regressionstjek.");
  await mockMobileFlag(page, true);
  await login(page);
  await page.goto("/planning?view=season");
  await expect(page.getByRole("heading", { name: "Udtagelsesmatrix" })).toBeVisible();
  await expect(page.getByTestId("season-matrix-desktop").getByText("Ada Pedersen")).toBeVisible();
  await expect(page.getByTestId("season-matrix-mobile")).toBeHidden();
  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-season-matrix-desktop-1280-${testInfo.project.name}.png`), fullPage: false });
});

// Kun til PR-beviset (scripts/compose-5124-evidence.mjs): skærmbilleder på 390
// og 1440 px + målte kontrolstørrelser. Koeres med EVIDENCE_5124=before mod
// main's SeasonMatrix.jsx og EVIDENCE_5124=after mod denne branch.
test("evidens: matrix-kontroller på 390 og 1440 px", async ({ page }, testInfo) => {
  const phase = process.env.EVIDENCE_5124;
  test.skip(!phase || testInfo.project.name !== "desktop-chromium", "Kun ved manuel evidens-koersel.");
  await mockMobileFlag(page, phase === "after");
  await login(page);
  const sizes = {};
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/planning?view=season");
    const heading = page.getByRole("heading", { name: "Udtagelsesmatrix" });
    await expect(heading).toBeVisible();
    await expect(page.locator("text=Ada Pedersen >> visible=true").first()).toBeVisible();
    // Etapeløbet viser vinduet (tre af fire løbsdage + Før/Senere).
    if (phase === "after" && width === 390) await page.getByTestId("season-matrix-mobile").getByLabel("Løb").selectOption("r2");
    await heading.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12));
    const controls = page.locator("button", { hasText: /^(Udtagelser|Rutematch|Form og peak|Belastning|Kun problemer)$/ });
    sizes[width] = await controls.evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { label: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderTopLeftRadius, transform: cs.textTransform };
    }));
    await page.screenshot({ path: testInfo.outputPath(`${phase}-${width}.png`) });
  }
  fs.writeFileSync(testInfo.outputPath(`${phase}-sizes.json`), JSON.stringify(sizes, null, 2));
});
