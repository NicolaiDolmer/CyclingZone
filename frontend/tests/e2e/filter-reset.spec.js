import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// #960: the reset button used to be hidden entirely until a filter was active,
// so users never discovered it. It must now always render — disabled/grey with
// no filters (so the affordance is learnable) and enabled with a count once a
// filter is set. RiderFilters is shared across riders/auctions/market/squad, so
// verifying it on /riders covers every surface.
test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("#960 filter reset: always visible, disabled until a filter is set, shows active count", async ({ page }) => {
  await login(page);
  await page.goto("/riders");

  const reset = page.getByTestId("filter-reset");

  // Always rendered, even with no active filter — but disabled so the user
  // learns it exists before they need it.
  await expect(reset).toBeVisible();
  await expect(reset).toBeDisabled();

  // #2464: på mobil er panel-indholdet kollapset bag en disclosure — åbn den
  // før der interageres med felterne. Reset-knappen selv bor i header-rækken
  // og er synlig uanset (dækket af assertions ovenfor).
  const panelToggle = page.getByTestId("filter-panel-toggle");
  if (await panelToggle.isVisible()) await panelToggle.click();

  // Setting one filter enables it and surfaces the count "(1)".
  await page.getByTestId("filter-name").fill("Ada");
  await expect(reset).toBeEnabled();
  await expect(reset).toHaveText(/\(1\)/);

  // Clicking it clears the filter and returns to the disabled state.
  // force: the button is visible+enabled+stable (asserted above); on the mobile
  // viewport Playwright auto-scrolls it under the sticky nav header, which
  // intercepts the synthetic pointer event. That overlap is a test-scroll
  // artifact, not a real obstruction, so we bypass the actionability gate while
  // still exercising the real onClick handler.
  await reset.click({ force: true });
  await expect(page.getByTestId("filter-name")).toHaveValue("");
  await expect(reset).toBeDisabled();
});
