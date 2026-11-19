import { expect, type Locator, type Page } from "@playwright/test";

// #8280 (TASTE P21): Rytterdatabasens filtre bor i tabellens titellinje. Søgefeltet
// er et felt på computer og et ikon der folder et felt ud på telefon; nulstil ligger
// i filter-arket. Disse hjælpere gør specs uafhængige af bredden.

/** Det synlige søgefelt: computerens felt, eller telefonens udfoldede felt. */
export async function riderSearchInput(page: Page): Promise<Locator> {
  await page.getByTestId("table-title-bar").waitFor();
  const desktop = page.getByTestId("filter-name");
  if (await desktop.isVisible()) return desktop;
  await page.getByTestId("filter-name-open").click();
  return page.getByTestId("filter-name-mobile");
}

/**
 * Telefon: henter en kolonne frem via kolonne-knappen i titellinjen (arket afløser
 * chip-rækken, P21). Computer viser alle kolonner, så dér er det en no-op.
 */
export async function revealTitleBarColumn(page: Page, label: RegExp): Promise<void> {
  if ((page.viewportSize()?.width ?? 1280) > 640) return;
  await page.getByTestId("table-columns-open").click();
  const sheet = page.getByRole("dialog");
  const item = sheet.getByRole("button", { name: label }).first();
  await item.waitFor({ state: "visible" });
  if ((await item.getAttribute("aria-pressed")) !== "true") {
    await item.click();
    await expect(item).toHaveAttribute("aria-pressed", "true");
  }
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
}

/** Åbner filter-arket, trykker "Nulstil alt" og lukker arket igen. */
export async function resetRiderFilters(page: Page): Promise<void> {
  // Et åbent søgefelt på telefon dækker hele linjen; luk det for at nå filter-ikonet.
  const closeSearch = page.getByTestId("table-search-close");
  if (await closeSearch.isVisible()) await closeSearch.click();
  await page.getByTestId("table-filters-open").click();
  await page.getByTestId("filter-reset").click();
  await page.keyboard.press("Escape");
}
