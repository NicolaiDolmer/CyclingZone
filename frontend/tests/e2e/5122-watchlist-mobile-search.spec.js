import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, evidenceShotPath } from "./fixtures.js";

// #5122 (@smukkethomsen 8/9): soegefeltet i RiderFilters' panel-layout sad kun
// inde bag WatchlistPage's mobil-disclosure ("More filters") — spilleren
// skulle aabne folden foer feltet overhovedet var synligt. "det er umuligt at
// soege paa spillere" paa mobil.
//
// Fixet tilfoejer et separat sm:hidden soegefelt (data-testid
// "watchlist-mobile-search") umiddelbart under sidehovedet, som kun er synligt
// <640px. Paa desktop (>=640px) er RiderFilters' oprindelige panel altid aabent
// (uaendret adfaerd) - der er soegefeltet stadig det oprindelige "filter-name"-
// felt. Denne spec beviser begge dele + at soegning rent faktisk filtrerer
// listen, paa alle tre projekter (desktop-chromium, mobile-chromium,
// mobile-webkit) uden at kraeve noget klik foerst.
const WATCHLIST_ROWS = [
  {
    id: "wl-1",
    note: null,
    created_at: "2026-06-01T10:00:00.000Z",
    rider: {
      id: "rider-bjerre", firstname: "Lars", lastname: "Bjerre",
      team_id: null, team: null,
      birthdate: "1998-04-12", nationality_code: "dk",
      market_value: 500000, salary: 50000, prize_earnings_bonus: 0, is_u25: false,
    },
  },
  {
    id: "wl-2",
    note: null,
    created_at: "2026-06-01T09:00:00.000Z",
    rider: {
      id: "rider-stone", firstname: "Anders", lastname: "Stone",
      team_id: null, team: null,
      birthdate: "1999-08-20", nationality_code: "dk",
      market_value: 300000, salary: 30000, prize_earnings_bonus: 0, is_u25: false,
    },
  },
];

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await page.route("**/rest/v1/rider_watchlist**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, WATCHLIST_ROWS);
  });
  // Ingen aktive auktioner/lister for disse fixture-ryttere.
  await page.route("**/rest/v1/auctions**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, []);
  });
  await page.route("**/rest/v1/transfer_listings**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, []);
  });
  await stabilizePage(page);
});

// Under sm-breakpointet (640px) er det det nye mobil-felt der er synligt (det
// oprindelige felt sidder skjult i den lukkede fold); paa desktop-bredder er det
// omvendt — det oprindelige panel-felt er altid synligt, det nye mobil-only felt
// er sm:hidden. Begge veje: præcis ét søgefelt skal være synligt uden klik.
function visibleSearchInput(page) {
  const width = page.viewportSize()?.width ?? 0;
  return width < 640
    ? page.getByTestId("watchlist-mobile-search")
    : page.getByTestId("filter-name");
}

test("watchlist search field is visible without opening the filter fold (#5122)", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/watchlist");

  await expect(page.getByRole("row", { name: /Bjerre/ })).toBeVisible();

  // Selve beviset: søgefeltet er synligt UDEN at klikke "More filters"/
  // panel-disclosure'en først.
  await expect(visibleSearchInput(page)).toBeVisible();

  await page.screenshot({
    path: evidenceShotPath(`pr-screens/5122/watchlist-search-visible-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("watchlist search filters the list by rider name (#5122)", async ({ page }) => {
  await login(page);
  await page.goto("/watchlist");

  await expect(page.getByRole("row", { name: /Bjerre/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Stone/ })).toBeVisible();

  await visibleSearchInput(page).fill("Stone");

  await expect(page.getByRole("row", { name: /Stone/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Bjerre/ })).toHaveCount(0);
});
