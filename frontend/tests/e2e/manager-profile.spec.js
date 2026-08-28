import { readFileSync } from "node:fs";
import { test, expect } from "./e2e-base.js";
import { stabilizePage, installNetworkMocks, login, TEST_TEAM, RIVAL_TEAM } from "./fixtures.js";

// #2917: managerprofilen havde ingen mock-handler i den DELTE mock (mockHandlers.js),
// så siden kollapsede til sin fejl-tilstand på preview og kunne ikke klik-testes før
// noget gik live. Denne spec kører BEVIDST uden lokal route-override — den beviser at
// den delte mock alene kan bære siden, hvilket er præcis det preview'en har brug for.
//
// Skærmbilleder skrives til test-results/2917/ (gitignoreret) så en session kan
// dokumentere UI'et uden at committe binære filer.
const SHOT_DIR = "test-results/2917";

// Læses fra locale-filen i stedet for at være hardkodet: #2917's CI-fejl var netop
// at testen påstod en tekst som merge-committen ikke rendrede (duplikat-nøgle mellem
// to parallelle branches). Bindes assertionen til kilden, kan de to ikke drive fra
// hinanden — og en omformulering af copy'en bryder ikke testen.
const daTeam = JSON.parse(
  readFileSync(new URL("../../public/locales/da/team.json", import.meta.url), "utf8")
);
const EMPTY_TEXT = daTeam.manager.noRecentAchievements;

async function openProfile(page, teamId) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);
  // Lad dashboardets egne fetches settle før vi navigerer videre — ellers kan webkit
  // afbryde goto'en midt i. networkidle alene er ikke nok (mobile-webkit afbrød stadig
  // ~1 ud af 4 kørsler), så vi navigerer én gang mere hvis URL'en ikke sad fast.
  await page.waitForLoadState("networkidle");
  const target = new RegExp(`/managers/${teamId}$`);
  await page.goto(`/managers/${teamId}`);
  if (!target.test(page.url())) {
    await page.goto(`/managers/${teamId}`);
  }
  await expect(page).toHaveURL(target);
  // Siden er klar når heroet har rendret — alt nedenfor må først måles derefter.
  await expect(page.getByRole("tab", { name: /Overblik/ })).toBeVisible();
}

test("managerprofilen bæres af den delte preview-mock (ingen lokal override)", async ({ page }, testInfo) => {
  await openProfile(page, TEST_TEAM.id);

  await expect(page.getByRole("heading", { name: TEST_TEAM.name })).toBeVisible();
  // Fejl-tilstanden må IKKE vises — det var symptomet før mock-handleren fandtes.
  await expect(page.getByRole("heading", { name: TEST_TEAM.name })).toBeVisible();
  // "Senest låst op" har badges, ikke tomtilstand.
  await expect(page.getByText(EMPTY_TEXT, { exact: false })).toHaveCount(0);

  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({ path: `${SHOT_DIR}/manager-overview-unlocked.png`, fullPage: false });
  }
});

test("achievements-fanen viser de nye sæson-badges + progress", async ({ page }, testInfo) => {
  await openProfile(page, TEST_TEAM.id);

  const achievementsTab = page.getByRole("tab", { name: /Achievements \d+\/\d+/ });
  await achievementsTab.scrollIntoViewIfNeeded();
  await achievementsTab.click({ force: true });

  // Kategorierne fra achievements-tabellen grupperer badges.
  await expect(page.getByRole("heading", { name: "sæson" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "hold" })).toBeVisible();

  // #1008-progress på en låst tæller-achievement (season_2_seasons: 1/2).
  await expect(page.getByText("1/2").first()).toBeVisible();
  const meter = page.getByRole("progressbar").first();
  await expect(meter).toBeVisible();

  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({ path: `${SHOT_DIR}/manager-achievements-tab.png`, fullPage: true });
  }
});

test("sæsonhistorikken viser en rigtig placering (ikke #—)", async ({ page }) => {
  await openProfile(page, TEST_TEAM.id);

  const seasonTab = page.getByRole("tab", { name: /Sæsonhistorik/ });
  await seasonTab.scrollIntoViewIfNeeded();
  await seasonTab.click({ force: true });

  // #2917: kolonnen læste `final_rank`, som ikke findes i season_standings — alle
  // rækker viste "#—". Seedet har en sæson vundet (rank 1) og en 2.-plads.
  await expect(page.getByRole("cell", { name: "#1", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "#2", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "#—", exact: true })).toHaveCount(0);
});

test("en manager uden achievements får en ordentlig tomtilstand", async ({ page }, testInfo) => {
  await openProfile(page, RIVAL_TEAM.id);

  // #2917: kortet blev tidligere skjult helt, så en ny manager aldrig så at
  // achievements fandtes. Nu står overskriften med en forklarende tomtilstand.
  await expect(page.getByRole("heading", { name: "Senest låst op" })).toBeVisible();
  await expect(page.getByText(EMPTY_TEXT, { exact: false })).toBeVisible();

  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({ path: `${SHOT_DIR}/manager-overview-empty.png`, fullPage: false });
  }
});
