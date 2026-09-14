// #5124 — D-047 til Transferlisten på mobil. #5124's ejer-tekst siger "<768px",
// men mekanikken genbruger D-047/DataTable.jsx's egen 640px-grænse
// (`useIsMobileViewport`) — ÉN grænse i hele appen, ikke to. Markeds-tabellen kan
// ikke bruge <DataTable> (bulk-select-checkbokse i den sticky navne-celle + en
// expander-handlingsrække pr. listing, se WRAP-kommentaren i TransfersPage.jsx),
// og de 15 evne-kolonner havde ALDRIG en `hidden`-klasse — det er den reelle
// årsag til at siden er "almost unplayable" på mobil (#5124's ordvalg).
//
// Beviser konkret:
//   1) Siden scroller ALDRIG vandret på mobil (document.scrollingElement) —
//      hverken i standardtilstanden eller i "Fuld tabel".
//   2) Hovedhandlingen (#5124: "vælge til bulk" for egne listinger, "Byd/Tilbud"
//      for markedslistinger) virker uden "Fuld tabel".
//   3) "Fuld tabel" afslører de 15 evne-kolonner (kontaineret scroll, ikke
//      sidescroll).
// Desktop (1280px) er uændret.
import { test, expect } from "./e2e-base.js";
import { corsHeaders, installNetworkMocks, json, login, stabilizePage, TEST_TEAM, evidenceShotPath } from "./fixtures.js";

const FULL_STATS = {
  stat_fl: 71, stat_bj: 68, stat_kb: 70, stat_bk: 72, stat_tt: 66, stat_prl: 64,
  stat_bro: 58, stat_sp: 80, stat_acc: 78, stat_ned: 71, stat_udh: 73, stat_mod: 69,
  stat_res: 67, stat_ftr: 75,
};
const ABILITIES = {
  climbing: 78, time_trial: 66, flat: 71, tempo: 64, sprint: 80, acceleration: 78,
  punch: 72, endurance: 70, recovery: 67, durability: 69, descending: 62,
  cobblestone: 58, positioning: 73, aggression: 55, tactics: 71,
};

const MARKET_RIDER = {
  id: "rider-market-5124", firstname: "Tobias", lastname: "Lund", nationality_code: "dk",
  birthdate: "2000-03-10", base_value: 1200000, market_value: 1200000, salary: 90000,
  contract_length: 2, contract_end_season: 4, primary_type: "sprinter", secondary_type: "leadout",
  team: { id: "team-rival-5124", name: "Regression VC" }, ...FULL_STATS, ...ABILITIES,
};
const OWN_RIDER = {
  id: "rider-own-5124", firstname: "Sander", lastname: "Vik", nationality_code: "no",
  birthdate: "1999-05-01", base_value: 820000, market_value: 820000, salary: 60000,
  contract_length: 1, contract_end_season: 3, primary_type: "climber", secondary_type: null,
  team: { id: TEST_TEAM.id, name: TEST_TEAM.name }, ...FULL_STATS, ...ABILITIES,
};

const MARKET_LISTING = {
  id: "listing-market-5124", rider: MARKET_RIDER, asking_price: 1300000,
  seller: { id: "team-rival-5124", name: "Regression VC" }, created_at: "2026-06-10T00:00:00.000Z",
};
const OWN_LISTING = {
  id: "listing-own-5124", rider: OWN_RIDER, asking_price: 700000,
  seller: { id: TEST_TEAM.id, name: TEST_TEAM.name }, created_at: "2026-06-11T00:00:00.000Z",
};

async function installTransferContent(page) {
  await page.route("**/api/transfers", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, [MARKET_LISTING, OWN_LISTING]);
  });
  await page.route("**/api/transfers/swaps", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, { sent: [], received: [] });
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installTransferContent(page);
});

test("mobil 393px: markeds-tabellen scroller aldrig vandret, og bulk-select + 'Tilbud' virker uden 'Fuld tabel'", async ({ page }, testInfo) => {
  await login(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/transfers?tab=market");
  await page.locator("table[data-sortable]").first().waitFor();
  await expect(page.getByText("Tobias Lund")).toBeVisible();

  const noPageScroll = () => page.evaluate(
    () => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth + 1
  );
  await expect.poll(noPageScroll).toBe(true);

  // De 15 evne-kolonner er væk som standard — ingen "CLM"/klatre-header synlig.
  await expect(page.getByRole("columnheader", { name: "CLM" })).toHaveCount(0);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-transfers-mobile-393-${testInfo.project.name}.png`), fullPage: false });

  // #5124's hovedhandling for en markedslisting: "Send tilbud" (Offer) er
  // altid synlig (handlingskolonnen er FAST, ikke bag "Fuld tabel").
  const marketRow = page.locator("tbody tr", { hasText: "Tobias Lund" }).first();
  await marketRow.getByRole("button", { name: /Send tilbud/ }).click();
  await expect(page.getByPlaceholder(/besked/i)).toBeVisible();

  // Egen listing: bulk-select-checkboxen i den sticky navne-celle virker også
  // uden "Fuld tabel".
  const ownRow = page.locator("tbody tr", { hasText: "Sander Vik" }).first();
  await ownRow.getByRole("checkbox", { name: /Sander Vik/ }).check();
  await expect(page.getByText(/1 markeret|1 selected/)).toBeVisible();
  await expect.poll(noPageScroll).toBe(true);

  // "Fuld tabel" afslører evne-kolonnerne — stadig ingen sidescroll (kontaineret).
  await page.getByRole("button", { name: "Fuld tabel" }).click();
  await expect(page.getByRole("columnheader", { name: "CLM" })).toBeVisible();
  await expect.poll(noPageScroll).toBe(true);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-transfers-mobile-393-fulltable-${testInfo.project.name}.png`), fullPage: false });
});

test("desktop 1280px: uændret — evne-kolonner synlige uden 'Fuld tabel'-knap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only regressionstjek — dækket af mobile-projekterne ovenfor.");
  await login(page);
  await page.goto("/transfers?tab=market");
  await page.locator("table[data-sortable]").first().waitFor();

  await expect(page.getByRole("columnheader", { name: "CLM" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fuld tabel" })).toHaveCount(0);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-transfers-desktop-1280-${testInfo.project.name}.png`), fullPage: false });
});
