// #987 · Marked-genvej direkte til transferlisten.
// Verificerer at (1) /transfers?tab=market deep-linker til markeds-fanen,
// (2) /transfers uden param stadig lander på "Modtagne tilbud" (default),
// (3) sidebar-genvejen "Transferliste" findes og navigerer korrekt (desktop —
//     på mobile er sidebaren en drawer og dækkes ikke her).
import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, corsHeaders, json } from "./fixtures.js";

// Fixture-mocks: /api/transfers → [], så markeds-fanen viser sin empty-state.
const MARKET_EMPTY = /No riders for sale|Ingen ryttere til salg/i;
const RECEIVED_EMPTY = /No received offers|Ingen modtagne tilbud/i;

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("?tab=market deep-linker til markeds-fanen (#987)", async ({ page }) => {
  await login(page);
  await page.goto("/transfers?tab=market");
  await expect(page.locator("main")).toContainText(MARKET_EMPTY);
});

test("/transfers uden param + handels-aktivitet lander på modtagne tilbud (default-fane #987)", async ({ page }) => {
  // #1569: en HELT tom spiller (ingen tilbud/swaps/loans) auto-defaulter til
  // markeds-fanen (se næste test), så base-default'en 'received' (#987) gælder
  // kun når der ER handels-aktivitet. Giv manageren ét udgående tilbud, så
  // #1569's tom-auto-switch IKKE fyrer, og vi tester den faktiske default-fane.
  // Det sendte tilbud renderes ikke (sent-fanen er inaktiv) — det gør blot
  // allTradeTabsEmpty=false, så siden bliver på DEFAULT_TAB='received'.
  await page.route("**/api/transfers/my-offers**", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, { sent: [{ id: "offer-sent-1", status: "pending" }], received: [], archivedSent: [], archivedReceived: [] });
  });
  await login(page);
  await page.goto("/transfers");
  await expect(page.locator("main")).toContainText(RECEIVED_EMPTY);
  await expect(page.locator("main")).not.toContainText(MARKET_EMPTY);
});

test("/transfers uden param auto-defaulter til markeds-fanen når alle handels-faner er tomme (#1569)", async ({ page }) => {
  // Fixturen returnerer tomme handels-endpoints → en ny spiller har ingen
  // tilbud/swaps/loans. #1569 skifter da ÉN gang til markeds-fanen (hvor der
  // faktisk kan være ryttere) i stedet for at lande på en tom 'received'-blindgyde.
  await login(page);
  await page.goto("/transfers");
  await expect(page.locator("main")).toContainText(MARKET_EMPTY);
});

test("sidebar-genvej 'Transferliste' navigerer til markeds-fanen (#987)", async ({ page, isMobile }) => {
  test.skip(isMobile, "Sidebar er en drawer på mobile — genvejen testes på desktop");
  await login(page);
  await page.goto("/transfers");

  const shortcut = page.getByRole("link", { name: /^(Transferliste|Transfer list)$/ });
  await expect(shortcut).toBeVisible();
  await shortcut.click();

  await expect(page).toHaveURL(/\/transfers\?tab=market$/);
  await expect(page.locator("main")).toContainText(MARKET_EMPTY);
});
