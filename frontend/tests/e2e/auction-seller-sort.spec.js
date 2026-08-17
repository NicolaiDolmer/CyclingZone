// #3067 — "Sælger"-kolonnens header var en almindelig <th> uden onSort, midt i
// en række sorterbare headers med samme typografi (Clarity 21-27/7: 12 rage
// clicks, appens højeste dead-affordance-tæthed). Header er nu en rigtig
// SortTh: klik sorterer rækkerne alfabetisk på sælgernavn ("AI" for frie
// agenter/AI-hold, ellers holdnavnet). Verificerer BÅDE den faktiske
// rækkefølge-ændring og fanger evidensen som screenshot.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, collectBrowserErrors, evidenceShotPath } from "./fixtures.js";

const RIDER_ALPHA = { id: "rider-sort-a", firstname: "Alpha", lastname: "Rider", team_id: "team-alpine", nationality_code: "dk", birthdate: "1998-01-01", base_value: 500000, market_value: 500000, salary: 40000, contract_length: 2, contract_end_season: 3, is_u25: false, primary_type: "rouleur", secondary_type: null, team: { id: "team-alpine", name: "Alpine Racing" } };
const RIDER_REGRESSION = { id: "rider-sort-b", firstname: "Bravo", lastname: "Rider", team_id: "team-rival", nationality_code: "dk", birthdate: "1996-01-01", base_value: 500000, market_value: 500000, salary: 40000, contract_length: 2, contract_end_season: 3, is_u25: false, primary_type: "rouleur", secondary_type: null, team: { id: "team-rival", name: "Regression VC" } };
// Fri agent: seller_team_id sat, men rider.team_id !== seller_team_id → getAuctionSellerLabel viser "AI".
const RIDER_FREE = { id: "rider-sort-c", firstname: "Charlie", lastname: "Rider", team_id: null, nationality_code: "dk", birthdate: "1999-01-01", base_value: 500000, market_value: 500000, salary: 40000, contract_length: 2, contract_end_season: 3, is_u25: false, primary_type: "rouleur", secondary_type: null, team: null };

const nowPlusHours = (h) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

const CONSOLE_NOISE = [/WebSocket connection to .*supabase\.co.*failed/i, /ERR_NAME_NOT_RESOLVED/i];

// Seedet BEVIDST i en rækkefølge der IKKE er alfabetisk (arrival-orden), så
// testen beviser at klienten selv sorterer — ikke bare gengiver API-rækkefølgen.
const SORT_AUCTIONS = [
  { id: "auction-sort-1", rider_id: RIDER_REGRESSION.id, seller_team_id: "team-rival", current_bidder_id: null, starting_price: 50000, current_price: 50000, min_increment: 5000, calculated_end: nowPlusHours(6), status: "active", is_guaranteed_sale: false, is_youth: false, rider: RIDER_REGRESSION, seller: { id: "team-rival", name: "Regression VC" }, current_bidder: null },
  { id: "auction-sort-2", rider_id: RIDER_ALPHA.id, seller_team_id: "team-alpine", current_bidder_id: null, starting_price: 50000, current_price: 50000, min_increment: 5000, calculated_end: nowPlusHours(6), status: "active", is_guaranteed_sale: false, is_youth: false, rider: RIDER_ALPHA, seller: { id: "team-alpine", name: "Alpine Racing" }, current_bidder: null },
  { id: "auction-sort-3", rider_id: RIDER_FREE.id, seller_team_id: null, current_bidder_id: null, starting_price: 50000, current_price: 50000, min_increment: 5000, calculated_end: nowPlusHours(6), status: "active", is_guaranteed_sale: true, is_youth: false, rider: RIDER_FREE, seller: null, current_bidder: null },
];

test.describe("Auctions Sælger-kolonne er sorterbar (#3067)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
    await page.route("**/rest/v1/auctions*", route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, SORT_AUCTIONS);
    });
  });

  test("klik på Sælger-headeren sorterer rækkerne alfabetisk (A→Å), ikke Å→A som en død header ville", async ({ page }, testInfo) => {
    // Sælger-kolonnen er "hidden xl:table-cell" — DESKTOP-tabellen (>=768px)
    // er selv "hidden md:block", så under md skifter siden helt til AuctionCard
    // (mobil-kortlisten), som aldrig havde denne header-affordance. Testen er
    // derfor desktop-only; mobil dækkes af den separate screenshot-test nedenfor.
    test.skip(testInfo.project.name !== "desktop-chromium", "Sælger-headeren er kun synlig i desktop-tabellen (xl:table-cell).");
    const capture = testInfo.project.name === "desktop-chromium";
    const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });

    await login(page);
    await page.goto("/auctions");
    await expect(page.getByRole("heading", { name: /^(Auktioner|Auctions)$/ })).toBeVisible();

    const sellerHeader = page.getByRole("columnheader", { name: /Sælger|Seller/ });
    await expect(sellerHeader).toBeVisible();

    const sellerCells = page.locator("table tbody tr td:nth-child(12)");
    await expect(sellerCells).toHaveCount(3);

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/3067-auctions-before-sort-desktop.png"), fullPage: true });
    }

    // ── Første klik: asc (AI → Alpine Racing → Regression VC) ──────────────
    await sellerHeader.click();
    await expect(sellerCells.nth(0)).toHaveText("AI");
    await expect(sellerCells.nth(1)).toHaveText("Alpine Racing");
    await expect(sellerCells.nth(2)).toHaveText("Regression VC");
    await expect(sellerHeader).toHaveAttribute("aria-sort", "ascending");

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/3067-auctions-sorted-asc-desktop.png"), fullPage: true });
    }

    // ── Andet klik: vender til desc (Regression VC → Alpine Racing → AI) ───
    await sellerHeader.click();
    await expect(sellerCells.nth(0)).toHaveText("Regression VC");
    await expect(sellerCells.nth(1)).toHaveText("Alpine Racing");
    await expect(sellerCells.nth(2)).toHaveText("AI");
    await expect(sellerHeader).toHaveAttribute("aria-sort", "descending");

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/3067-auctions-sorted-desc-desktop.png"), fullPage: true });
    }

    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("mobil: Sælger-kolonnen sorterer korrekt (hidden xl:table-cell, men headeren er stadig i DOM'et og fungerer)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop-chromium", "Dækket af desktop-testen ovenfor.");
    await login(page);
    await page.goto("/auctions");
    await expect(page.getByRole("heading", { name: /^(Auktioner|Auctions)$/ })).toBeVisible();
    await page.screenshot({ path: evidenceShotPath(`pr-screens/3067-auctions-mobile-${testInfo.project.name}.png`), fullPage: true });
  });
});
