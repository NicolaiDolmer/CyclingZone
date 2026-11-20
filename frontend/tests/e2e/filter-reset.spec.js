import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";
import { riderSearchInput } from "./lib/riders-title-bar.ts";

// #960: the reset button used to be hidden entirely until a filter was active,
// so users never discovered it. It must always render — disabled/grey with
// no filters (so the affordance is learnable) and enabled with a count once a
// filter is set. RiderFilters is shared across riders/auctions/market/squad, so
// verifying it on /riders covers every surface.
// #8280 (TASTE P21): on /riders the reset lives in the filter sheet of the table's
// title line, so the sheet is opened first.
test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("#960 filter reset: always visible, disabled until a filter is set, shows active count", async ({ page }) => {
  await login(page);
  await page.goto("/riders");
  await page.getByTestId("table-title-bar").waitFor();

  const reset = page.getByTestId("filter-reset");

  // Always rendered in the sheet, even with no active filter — but disabled so
  // the user learns it exists before they need it.
  await page.getByTestId("table-filters-open").click();
  await expect(reset).toBeVisible();
  await expect(reset).toBeDisabled();
  await page.keyboard.press("Escape");

  // Setting one filter enables it and surfaces the count "(1)". On a phone the
  // search is an icon that unfolds a field over the title line.
  await (await riderSearchInput(page)).fill("Ada");
  const closeSearch = page.getByTestId("table-search-close");
  if (await closeSearch.isVisible()) await closeSearch.click();
  await page.getByTestId("table-filters-open").click();
  await expect(reset).toBeEnabled();
  await expect(reset).toHaveText(/\(1\)/);

  // Clicking it clears the filter and returns to the disabled state.
  await reset.click();
  await expect(page.getByTestId("filter-name")).toHaveValue("");
  await expect(reset).toBeDisabled();
});
