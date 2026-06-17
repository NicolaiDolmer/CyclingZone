import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json } from "./fixtures.js";

// #251 · Ønskelisten skal vise et "I auktion"-mærke for ryttere der allerede er
// i en aktiv auktion, OG skjule "Start auktion"-knappen for dem — ellers klikker
// brugeren knappen og får først bagefter en backend-fejl-popup.
//
// auction-1 i fixtures er en AKTIV auktion på rider-2 → den rytter skal få badge.
// rider-free er en fri agent uden auktion → beholder "Start auktion"-knappen.
// Kun rider_watchlist overrides (auctions-fixturen har allerede den rette auktion).
const WATCHLIST_ROWS = [
  {
    id: "wl-1",
    note: null,
    created_at: "2026-06-01T10:00:00.000Z",
    rider: {
      id: "rider-2", firstname: "Mikkel", lastname: "Hansen",
      team_id: "team-rival", team: { id: "team-rival", name: "Regression VC" },
      birthdate: "1997-09-03", nationality_code: "dk",
      market_value: 1400000, salary: 140000, prize_earnings_bonus: 0, is_u25: false,
    },
  },
  {
    id: "wl-2",
    note: null,
    created_at: "2026-06-01T09:00:00.000Z",
    rider: {
      id: "rider-free", firstname: "Frank", lastname: "Free",
      team_id: null, team: null,
      birthdate: "2000-01-01", nationality_code: "dk",
      market_value: 90000, salary: 0, prize_earnings_bonus: 0, is_u25: false,
    },
  },
];

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("watchlist marks riders already in an auction and hides Start auction for them (#251)", async ({ page }) => {
  // Mere specifik route end installNetworkMocks' rest-catch-all → registreret
  // sidst, så Playwright vælger den.
  await page.route("**/rest/v1/rider_watchlist**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, WATCHLIST_ROWS);
  });

  await login(page);
  await page.goto("/watchlist");

  // rider-2 er i auction-1 → "I auktion"-badge vises.
  await expect(page.getByText(/^(In auction|I auktion)$/)).toBeVisible();

  // Kun den frie agent uden auktion har "Start auktion"-knappen; rider-2's knap
  // er skjult bag badgen → præcis én knap i tabellen.
  await expect(
    page.getByRole("button", { name: /^(Start auction|Start auktion)$/ })
  ).toHaveCount(1);
});
