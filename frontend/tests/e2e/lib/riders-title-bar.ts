import type { Locator, Page } from "@playwright/test";

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

/** Åbner filter-arket, trykker "Nulstil alt" og lukker arket igen. */
export async function resetRiderFilters(page: Page): Promise<void> {
  // Et åbent søgefelt på telefon dækker hele linjen; luk det for at nå filter-ikonet.
  const closeSearch = page.getByTestId("table-search-close");
  if (await closeSearch.isVisible()) await closeSearch.click();
  await page.getByTestId("table-filters-open").click();
  await page.getByTestId("filter-reset").click();
  await page.keyboard.press("Escape");
}
