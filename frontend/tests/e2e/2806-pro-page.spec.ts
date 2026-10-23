// #2806 — /pro-siden med fordel-fanerne (historik, gemte filtre) og planerne.
//
// Guarden holder på at siden renderer fanerne og planerne uden vandret scroll
// på mobil (390) og desktop (1440), og tager bevis-billeder af begge brudpunkter
// (Codex-fund på PR #7055: desktop-brudpunktet manglede bevis).
import type { Page } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, evidenceShotPath } from "./fixtures.js";

async function openPro(page: Page, width: number, height: number, benefit = "history") {
  await page.setViewportSize({ width, height });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);
  await page.goto(`/pro?benefit=${benefit}`);
  await expect(page.getByRole("tablist").first()).toBeVisible();
}

for (const [name, width, height] of [["mobil", 390, 844], ["desktop", 1440, 900]] as const) {
  test(`${name} ${width}: /pro viser fordel-fanerne og planerne uden vandret scroll (#2806)`, async ({ page }) => {
    await openPro(page, width, height);
    await expect(page.getByRole("tab").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "ingen vandret scroll").toBeLessThanOrEqual(0);
    await page.screenshot({ path: evidenceShotPath(`pr-screens/2806-pro-${width}.png`), fullPage: true });
  });
}
