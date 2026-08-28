// #3708 — Discord-feedback (2 spillere, @thelamba + @knud_r_flink): transferhistorik
// var fyldt med "no sale"-støj og interne pladsholdere ("-"/"Unknown") hvor
// spilleren forventede "AI-hold". Denne spec dækker de tre flader fra issuet:
//
//   1. Transfer history (other teams) — TeamTransferHistoryTab (samme komponent
//      som "own team", #2400 dækker allerede no-sale-toggle'en der): et garanteret
//      AI-salg (current_bidder_id tomt, is_guaranteed_sale sat) viste "-" i
//      modpart-kolonnen. Skal nu vise "AI team".
//   2. History (Players) — RiderHistoryTab: no_sale-auktioner ("received no
//      bids") er nu filtreret helt fra (ikke bare skjult bag en toggle, som på
//      egen-holds-fanen — denne side er offentlig og har ingen toggle).
//   3. History (Players) — buyerFallback for et garanteret AI-salg viste
//      "Unknown". Skal nu vise "AI team" (symmetrisk med den eksisterende
//      sellerFallbackAi).
import { expect, test } from "./e2e-base.js";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  collectBrowserErrors,
  evidenceShotPath,
  json,
} from "./fixtures.js";
import { SEED_TRANSFER_HISTORY, TEST_TEAM, RIVAL_TEAM, ACTIVE_SEASON } from "../../src/preview/seedData.js";

const CONSOLE_NOISE = [/WebSocket connection to .*supabase\.co.*failed/i, /ERR_NAME_NOT_RESOLVED/i];

// Samme fixture som #2400 (SEED_TRANSFER_HISTORY) + ét garanteret AI-salg uden
// modpart — den eneste vej counterparty-kolonnen reelt kan lande på "AI team"
// (se teamTransferHistory.js: winner er kun tom, uden at være no_sale, når
// is_guaranteed_sale er sat).
const SEED_TRANSFER_HISTORY_WITH_GUARANTEED = [
  ...SEED_TRANSFER_HISTORY,
  {
    id: "auction:tx-e2e-guaranteed",
    type: "auction",
    direction: "out",
    cash_flow: "in",
    date: "2026-07-22T10:00:00.000Z",
    rider: { id: "rider-6", firstname: "Marco", lastname: "Ferrante" },
    counterparty: null,
    amount: 95000,
    no_sale: false,
    is_guaranteed_sale: true,
    season_number: ACTIVE_SEASON.season_number,
  },
];

test.describe("#3708 — transferhistorik-oprydning (no-sale + AI-hold fallback)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
  });

  test("team-transferhistorik: garanteret AI-salg viser 'AI team' i stedet for '-'", async ({ page }, testInfo) => {
    const capture = testInfo.project.name === "desktop-chromium";
    const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });

    // Overskriver #2400-fixturen med den udvidede variant — registreret EFTER
    // installNetworkMocks, så den vinder (se fixtures.js-kommentaren om
    // "senest registrerede route").
    await page.route("**/api/teams/*/transfer-history", (route) =>
      json(route, SEED_TRANSFER_HISTORY_WITH_GUARANTEED)
    );

    await login(page);
    await page.goto("/team");
    await page.getByRole("button", { name: /Transferhistorik|Transfer history/ }).click();
    await expect(page.getByRole("heading", { name: /Transferhistorik|Transfer history/ })).toBeVisible();

    // Vis alle (inkl. no_sale) er irrelevant her — det garanterede salg er IKKE
    // no_sale, så det er synligt i default-visningen.
    const rows = page.locator("table[data-sortable]").first().locator("tbody tr");
    await expect(rows.getByText("Marco Ferrante")).toBeVisible();
    await expect(rows.filter({ has: page.getByText("Marco Ferrante") }).getByText(/AI team|AI-hold/)).toBeVisible();

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/3708-team-history-ai-fallback.png"), fullPage: true });
    }

    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("rytter-historik: no_sale-rækker er væk, garanteret AI-salg viser 'AI team'", async ({ page }, testInfo) => {
    const capture = testInfo.project.name === "desktop-chromium";
    const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });

    await login(page);
    await page.goto("/riders/rider-1?tab=history");
    await expect(page.getByRole("heading", { name: /Ada Pedersen/ }).first()).toBeVisible();

    // #3708: no_sale-auktionen (SEED_RIDER_HISTORY) må ikke optræde overhovedet.
    await expect(page.getByText(/received no bids|modtog ingen bud/i)).toHaveCount(0);

    // Scopet til <main> — "E2E Racing" (TEST_TEAM.name) optræder ALTID i sidebaren
    // (holdnavn), også på mobil hvor den er visuelt skjult (display via CSS, ikke
    // fjernet fra DOM'et) → getByText uden scope fangede den skjulte kopi og
    // strict-mode-fejlede toBeVisible() på mobile-chromium/webkit.
    const main = page.locator("main");

    // Garanteret AI-salg: buyer-fallback er "AI team", ikke "Unknown"/"Ukendt".
    await expect(main.getByText(/AI team|AI-hold/).first()).toBeVisible();
    await expect(main.getByText(/^Unknown$|^Ukendt$/)).toHaveCount(0);

    // Den almindelige handel (rigtig køber/sælger) er der stadig.
    await expect(main.getByText(TEST_TEAM.name).first()).toBeVisible();
    await expect(main.getByText(RIVAL_TEAM.name).first()).toBeVisible();

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/3708-rider-history-ai-fallback.png"), fullPage: true });
    }

    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("mobil: begge flader renderer korrekt efter oprydningen", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop-chromium", "Dækket af desktop-testene ovenfor.");

    await page.route("**/api/teams/*/transfer-history", (route) =>
      json(route, SEED_TRANSFER_HISTORY_WITH_GUARANTEED)
    );

    await login(page);
    await page.goto("/team");
    await page.getByRole("button", { name: /Transferhistorik|Transfer history/ }).click();
    await expect(page.getByRole("heading", { name: /Transferhistorik|Transfer history/ })).toBeVisible();
    await page.screenshot({ path: evidenceShotPath(`pr-screens/3708-team-history-mobile-${testInfo.project.name}.png`), fullPage: true });

    await page.goto("/riders/rider-1?tab=history");
    await expect(page.getByText(/AI team|AI-hold/).first()).toBeVisible();
    await page.screenshot({ path: evidenceShotPath(`pr-screens/3708-rider-history-mobile-${testInfo.project.name}.png`), fullPage: true });
  });
});
