// #4035 — Rating-kolonnen i Rytterdatabasen (RidersPage) reagerede slet ikke
// på klik: den havde INGEN sortKey, fordi ratingen er klient-udregnet
// (riderOverallRating, vægtet snit af evne-kolonner hvor vægtene afhænger af
// rytterens primary_type) og ikke en DB-kolonne PostgREST kan ORDER BY direkte.
// fetchRidersPage diverterer nu "rating" til fetchRidersSortedByRating
// (useRiderFilters.js) — samme fetch-alt+beregn+flet-mønster som løn-
// sorteringen (#2403, mergeSalarySortedIds). Denne test beviser BÅDE at
// klikket faktisk ændrer rækkefølgen (ikke bare tilføjer en død header) og at
// rækkefølgen matcher den viste rating, ikke API-arrival-orden.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, collectBrowserErrors, evidenceShotPath } from "./fixtures.js";

// Alle fem sprinter-evner sat til SAMME tal → riderOverallRating (vægtet snit
// af identiske tal) = netop det tal. Deterministisk og let at assertere på
// uden at kende displayRecipes.js's konkrete vægte udenad.
function sprinterRider(id, lastname, level) {
  return {
    id, firstname: "Test", lastname, nationality_code: "dk", birthdate: "1998-01-01",
    team_id: null, team: null, is_retired: false, is_u25: false, owner_is_ai: false,
    base_value: 500000, market_value: 500000, salary: 40000, contract_length: 2,
    contract_end_season: 3, popularity: 50, prize_earnings_bonus: 0,
    primary_type: "sprinter", secondary_type: null,
    rider_derived_abilities: {
      sprint: level, acceleration: level, positioning: level, flat: level, durability: level,
      climbing: level, time_trial: level, tempo: level, endurance: level, recovery: level,
      descending: level, cobblestone: level, aggression: level, tactics: level, punch: level,
    },
  };
}

// Seedet BEVIDST i en rækkefølge der IKKE er sorteret på rating (arrival-orden),
// samme forward-guard-mønster som #3067's auction-seller-sort.spec.js — så
// testen beviser klient-/server-sorteringen, ikke bare API-rækkefølgen.
const SORT_RIDERS = [
  sprinterRider("rating-mid", "Midtown", 55),
  sprinterRider("rating-low", "Lowlands", 20),
  sprinterRider("rating-top", "Topline", 90),
];

const CONSOLE_NOISE = [/WebSocket connection to .*supabase\.co.*failed/i, /ERR_NAME_NOT_RESOLVED/i];

test.describe("Rytterdatabase Rating-kolonne er sorterbar (#4035)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
    // Overstyrer den generiske riders-mock (installNetworkMocks) med et lille
    // deterministisk sæt — Playwright matcher senest-registrerede route først
    // (samme mønster som #3067's auction-seller-sort.spec.js). Dækker BEGGE
    // grene i fetchRidersSortedByRating: "id=in.(...)" (side-udsnittet, andet
    // kald) får den filtrerede delmængde, alt andet (fetchAllRows' letvægts-
    // fetch, første kald) får hele sættet.
    await page.route("**/rest/v1/riders*", route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      const url = new URL(request.url());
      const idIn = decodeURIComponent(url.search).match(/[?&]id=in\.\(([^)]*)\)/);
      if (idIn) {
        const ids = new Set(idIn[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean));
        return json(route, SORT_RIDERS.filter(r => ids.has(r.id)));
      }
      return json(route, SORT_RIDERS);
    });
  });

  test("klik på Rating-headeren sorterer efter den BEREGNEDE rating, ikke API-orden", async ({ page }, testInfo) => {
    // Rating-kolonnen er `fold: true` (hidden sm:table-cell — foldes ind i
    // navne-underlinjen på mobil, samme mønster som Sælger-kolonnen i #3067).
    // Desktop-only, samme begrundelse.
    test.skip(testInfo.project.name !== "desktop-chromium", "Rating-headeren er kun en egen kolonne i desktop-tabellen (fold: true).");
    const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });

    await login(page);
    await page.goto("/riders");
    await expect(page.getByRole("heading", { name: /Rider Database|Rytterdatabase/ })).toBeVisible();

    const ratingHeader = page.getByRole("columnheader", { name: "Rating" });
    await expect(ratingHeader).toBeVisible();

    // Rating er 5. kolonne: nation, rytter, sammenlign, watchlist, rating.
    const ratingCells = page.locator("table tbody tr td:nth-child(5)");
    await expect(ratingCells).toHaveCount(3);
    // Uden sortering: API-arrival-orden (55, 20, 90) — ikke rating-orden.
    await expect(ratingCells.nth(0)).toHaveText("55");

    await page.screenshot({ path: evidenceShotPath("pr-screens/4035-riders-rating-before-sort-desktop.png"), fullPage: true });

    // ── Første klik: desc (default retning, samme som løn/værdi) ───────────
    await ratingHeader.click();
    await expect(ratingCells.nth(0)).toHaveText("90");
    await expect(ratingCells.nth(1)).toHaveText("55");
    await expect(ratingCells.nth(2)).toHaveText("20");
    await expect(ratingHeader).toHaveAttribute("aria-sort", "descending");

    await page.screenshot({ path: evidenceShotPath("pr-screens/4035-riders-rating-sorted-desc-desktop.png"), fullPage: true });

    // ── Andet klik: vender til asc ──────────────────────────────────────────
    await ratingHeader.click();
    await expect(ratingCells.nth(0)).toHaveText("20");
    await expect(ratingCells.nth(1)).toHaveText("55");
    await expect(ratingCells.nth(2)).toHaveText("90");
    await expect(ratingHeader).toHaveAttribute("aria-sort", "ascending");

    await page.screenshot({ path: evidenceShotPath("pr-screens/4035-riders-rating-sorted-asc-desktop.png"), fullPage: true });

    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("mobil: Rating er valgbar i sorterings-vælgeren (samme sort-nøgle som desktop-headeren)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop-chromium", "Dækket af desktop-testen ovenfor.");
    await login(page);
    await page.goto("/riders");
    await expect(page.getByRole("heading", { name: /Rider Database|Rytterdatabase/ })).toBeVisible();

    const sortSelect = page.getByLabel(/Sort by|Sortér efter/);
    await sortSelect.selectOption("rating");
    await expect(sortSelect).toHaveValue("rating");

    await page.screenshot({ path: evidenceShotPath(`pr-screens/4035-riders-rating-mobile-sort-${testInfo.project.name}.png`), fullPage: true });
  });
});
