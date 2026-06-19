// #1421 Slice A · Dead-click forward-guard for /transfers.
// Clarity (uge 2026-06-09→06-16) viste dead/rage clicks på rytter-elementer der
// SÅ klikbare ud. Rytternavnene linkede allerede, men de store rytter-data-arealer
// (TransferCard-stats-grid, SwapCard-rytter-celle) var døde. Denne test fastholder
// at de arealer nu navigerer til rytterprofilen — ikke bare bærer cursor-affordance.
import { expect, test } from "@playwright/test";
import { corsHeaders, installNetworkMocks, json, login, stabilizePage } from "./fixtures.js";

const FULL_STATS = {
  stat_fl: 71, stat_bj: 68, stat_kb: 70, stat_bk: 72, stat_tt: 66, stat_prl: 64,
  stat_bro: 58, stat_sp: 80, stat_acc: 78, stat_ned: 71, stat_udh: 73, stat_mod: 69,
  stat_res: 67, stat_ftr: 75,
};

// #1529: visningen bruger nu CZ-evner (kort flatten'er rider.rider_derived_abilities,
// men direkte evne-keys på rytter-objektet bevares også → her lagt direkte på).
const ABILITIES = {
  climbing: 78, time_trial: 66, flat: 71, tempo: 64, sprint: 80, acceleration: 78,
  punch: 72, endurance: 70, recovery: 67, durability: 69, descending: 62,
  cobblestone: 58, positioning: 73, aggression: 55, tactics: 71,
};

const SALE_RIDER = {
  id: "rider-sale", firstname: "Tobias", lastname: "Lund", nationality_code: "dk",
  birthdate: "2000-03-10", base_value: 1200000, market_value: 1200000, salary: 90000,
  contract_length: 2, contract_end_season: 4, primary_type: "sprinter", secondary_type: "leadout",
  team: { id: "team-rival", name: "Regression VC" }, ...FULL_STATS, ...ABILITIES,
};

const LISTING = {
  id: "listing-1", rider: SALE_RIDER, asking_price: 1300000,
  seller: { id: "team-rival", name: "Regression VC" }, created_at: "2026-06-10T00:00:00.000Z",
};

const SWAP_OFFERED = {
  id: "rider-offered", firstname: "Sander", lastname: "Vik", nationality_code: "no",
  base_value: 820000, market_value: 820000, ...FULL_STATS, ...ABILITIES,
};
const SWAP_REQUESTED = {
  id: "rider-requested", firstname: "Ada", lastname: "Pedersen", nationality_code: "dk",
  base_value: 1680000, market_value: 1680000, ...FULL_STATS, ...ABILITIES,
};

const SWAP = {
  id: "swap-1", status: "pending",
  proposing: { id: "team-rival", name: "Regression VC" },
  receiving: { id: "team-e2e", name: "E2E Racing" },
  offered: SWAP_OFFERED, requested: SWAP_REQUESTED,
  cash_adjustment: 0, message: "",
};

async function installTransferContent(page) {
  // Registreret EFTER installNetworkMocks → vinder over fixturens tomme defaults.
  await page.route("**/api/transfers", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, [LISTING]);
  });
  await page.route("**/api/transfers/swaps", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, { sent: [], received: [SWAP] });
  });
}

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await installTransferContent(page);
  await stabilizePage(page);
});

test("TransferCard stats-grid navigerer til rytterprofil (#1421)", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/transfers?tab=market");

  // To links peger på rytteren: navnet (header) og det nye evne-grid (har 'FLT').
  const statsLink = page.locator('a[href="/riders/rider-sale"]').filter({ hasText: "FLT" });
  await expect(statsLink).toBeVisible();
  await statsLink.hover();

  const shot = await page.locator("main").screenshot();
  await testInfo.attach("transfercard-market", { body: shot, contentType: "image/png" });

  await statsLink.click();
  await expect(page).toHaveURL(/\/riders\/rider-sale$/);
});

test("SwapCard rytter-celle navigerer til rytterprofil (#1421)", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/transfers?tab=swaps");

  // Hele rytter-cellen (label + navn + CLM/SPR/TT/FLT-evner) er ét link med rytternavnet
  // som aria-label; 'CLM' findes kun i celle-evnerne, ikke i navne-linket.
  const swapCell = page.locator('a[href="/riders/rider-offered"]').filter({ hasText: "CLM" });
  await expect(swapCell).toBeVisible();
  await swapCell.hover();

  const shot = await page.locator("main").screenshot();
  await testInfo.attach("swapcard", { body: shot, contentType: "image/png" });

  await swapCell.click();
  await expect(page).toHaveURL(/\/riders\/rider-offered$/);
});
