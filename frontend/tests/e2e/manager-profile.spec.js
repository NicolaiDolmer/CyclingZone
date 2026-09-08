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

// #5007: Founder-mærket manglede på denne side (forum/stilling/holdside havde det,
// profilen ikke). Samme kilde-bindings-mønster som EMPTY_TEXT ovenfor.
const daPro = JSON.parse(
  readFileSync(new URL("../../public/locales/da/pro.json", import.meta.url), "utf8")
);
const FOUNDER_LABEL = daPro.founderMark.label;

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

// #3200-afløseren 8/9. Her stod `scrollIntoViewIfNeeded()` + `click({ force: true })`
// i hver test, og det fejlede kun på mobile-webkit: `scrollIntoViewIfNeeded` ruller
// LIGE nok til at elementet er i viewporten, så fanen landede i den nederste kant —
// under den faste bundnavigation, som på webkits lavere viewport ligger hen over
// indholdet. `force: true` springer netop obstruktions-tjekket over, så klikket blev
// leveret på de koordinater og ramte "Ryttere" i bundbjælken: testen endte på
// rytterdatabasen og ledte efter en overskrift der aldrig kunne findes. Begge
// chromium-projekter har en højere viewport og ramte aldrig bjælken.
//
// `block: "center"` flytter fanen væk fra begge kanter, og klikket sker UDEN force,
// så Playwright igen får lov at fejle højlydt hvis noget dækker den.
async function openTab(page, name) {
  const tab = page.getByRole("tab", { name });
  await tab.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await tab.click();
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

  await openTab(page, /Achievements \d+\/\d+/);

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

  await openTab(page, /Sæsonhistorik/);

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

// #5007: Founder-mærket (#4649) manglede på den offentlige managerprofil — forum,
// stilling og holdside havde det, men ikke denne side. mockHandlers.js'
// founder_public_list seeder BÅDE TEST_TEAM og RIVAL_TEAM som Founders (bruges
// også af Standings/holdside/forum-mockene), så der findes ingen ikke-Founder
// managerprofil at navigere til her — negativ-tilfældet ("ikke vist for
// ikke-Founders") er allerede dækket af FounderMark.jsx' egen guard
// (`founderNumber == null → return null`), som er fælles for alle sider der
// bruger komponenten og ikke ændret af denne fix.
test("Founder-mærket vises for en Founder-manager (egen profil)", async ({ page }) => {
  await openProfile(page, TEST_TEAM.id);
  await expect(page.getByText(FOUNDER_LABEL, { exact: false }).first()).toBeVisible();
});

// #5007-accept: "maerket ses af ANDRE managere". login() logger ind som TEST_TEAM's
// bruger, så RIVAL_TEAM her er netop en ANDEN konto set udefra — RIVAL_TEAM er også
// Founder i mocken (se note ovenfor), så dette er det reelle regressionstjek for
// accept-kriteriet, ikke bare "vises på egen profil".
test("Founder-mærket vises på en ANDEN managers profil, ikke kun ens egen", async ({ page }) => {
  await openProfile(page, RIVAL_TEAM.id);
  await expect(page.getByText(FOUNDER_LABEL, { exact: false }).first()).toBeVisible();
});
