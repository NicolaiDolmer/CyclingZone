// #987 · Marked-genvej direkte til transferlisten.
// Verificerer at (1) /transfers?tab=market deep-linker til markeds-fanen,
// (2) /transfers uden param stadig lander på "Modtagne tilbud" (default),
// (3) sidebar-genvejen "Transferliste" findes og navigerer korrekt (desktop —
//     på mobile er sidebaren en drawer og dækkes ikke her).
import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

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

test("/transfers uden param lander på modtagne tilbud (default-fane)", async ({ page }) => {
  await login(page);
  await page.goto("/transfers");
  await expect(page.locator("main")).toContainText(RECEIVED_EMPTY);
  await expect(page.locator("main")).not.toContainText(MARKET_EMPTY);
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
