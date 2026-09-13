import { test, expect } from "./e2e-base.js";
import { corsHeaders, installNetworkMocks, json, login, stabilizePage } from "./fixtures.js";
import { apiResponse } from "../../src/preview/mockHandlers.js";

test("#5176 failed top-scorer request shows an error and retry restores results", async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
  let shouldFail = true;
  await page.route("**/api/rankings/riders**", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    const url = new URL(request.url());
    if (url.searchParams.get("top") !== "5") return route.fallback();
    return shouldFail
      ? json(route, { error: "Unable to load rankings" }, 500)
      : json(route, apiResponse(url.pathname, url.search));
  });
  await login(page);
  await page.goto("/resultater");
  await expect(page.getByText("Resultater kunne ikke indlæses", { exact: true })).toBeVisible();
  shouldFail = false;
  await page.getByRole("button", { name: "Prøv igen", exact: true }).click();
  await expect(page.getByRole("link", { name: /Ada Pedersen.*1\.840 pt/ })).toBeVisible();
  await expect(page.getByText("Resultater kunne ikke indlæses", { exact: true })).toHaveCount(0);
});
