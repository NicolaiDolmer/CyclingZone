// #2400 — Discord-feedback: "no sale" auctions cluttered the transfer history,
// making it hard to see actual signings/sales/releases. TeamTransferHistoryTab
// now hides no_sale events by default (filterTransferHistoryNoSale) with a
// toggle to reveal them. Mock data (SEED_TRANSFER_HISTORY, seedData.js) has one
// real auction sale, one no_sale auction, and one real transfer purchase.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, collectBrowserErrors, evidenceShotPath } from "./fixtures.js";

const CONSOLE_NOISE = [/WebSocket connection to .*supabase\.co.*failed/i, /ERR_NAME_NOT_RESOLVED/i];

test.describe("Transferhistorik skjuler no_sale-auktioner som default (#2400)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
  });

  test("no_sale-auktioner er skjult som default, og toggle'en viser dem", async ({ page }, testInfo) => {
    const capture = testInfo.project.name === "desktop-chromium";
    const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });

    await login(page);
    await page.goto("/team");
    await page.getByRole("button", { name: /Transferhistorik|Transfer history/ }).click();

    await expect(page.getByRole("heading", { name: /Transferhistorik|Transfer history/ })).toBeVisible();

    // #1107: profit-panelet UNDER historikken bruger SAMME data-sortable-attribut
    // på sin egen <table> — .first() scoper til historik-tabellen (renderes
    // først i DOM'et, se TeamTransferHistoryTab.jsx).
    const rows = page.locator("table[data-sortable]").first().locator("tbody tr");
    // ── Default: no_sale skjult → kun de 2 faktiske handler ─────────────────
    await expect(rows).toHaveCount(2);
    await expect(rows.getByText("Sofie Lund")).toBeVisible();
    await expect(rows.getByText("Emil Kjær")).toBeVisible();
    await expect(rows.getByText("Jonas Brandt")).toHaveCount(0);

    // Info-linjen fortæller hvor mange der er skjult.
    await expect(page.getByText(/1 auktion uden bud er skjult|1 auction with no bids is hidden/)).toBeVisible();

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/2400-history-default-hidden.png"), fullPage: true });
    }

    // ── Toggle: vis auktioner uden bud → alle 3 events ──────────────────────
    await page.getByRole("checkbox", { name: /Vis auktioner uden bud|Show auctions with no bids/ }).check();
    await expect(rows).toHaveCount(3);
    await expect(rows.getByText("Jonas Brandt")).toBeVisible();
    await expect(rows.getByText(/Ingen bud|No bids/)).toBeVisible();

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/2400-history-toggle-shown.png"), fullPage: true });
    }

    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("mobil: transferhistorik-fanen med toggle renderer korrekt", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop-chromium", "Dækket af desktop-testen ovenfor.");
    await login(page);
    await page.goto("/team");
    await page.getByRole("button", { name: /Transferhistorik|Transfer history/ }).click();
    await expect(page.getByRole("heading", { name: /Transferhistorik|Transfer history/ })).toBeVisible();
    await page.screenshot({ path: evidenceShotPath(`pr-screens/2400-history-mobile-${testInfo.project.name}.png`), fullPage: true });
  });
});
