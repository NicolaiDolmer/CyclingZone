import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, AUCTIONS } from "./fixtures.js";

// #2577 · Closing countdown ring: ved <= 10s tilbage skifter auktionens "tid
// tilbage" fra tekst til en nedtællingsring (role="timer", "0:0X"-format).
// Fixture-auktionen overrides med en calculated_end tæt på nu, så ringen er
// den deterministiske sluttilstand. Over 10s vises den almindelige tekst-timer
// fortsat (dækkes implicit af core-smoke's /auctions-snapshot).

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("auction time-left shows countdown ring in the final 10 seconds (#2577)", async ({ page }) => {
  // Mere specifik route end installNetworkMocks' rest-catch-all → registreret
  // sidst, så Playwright vælger den. 9s giver margen til load uden at udløbe.
  const soon = new Date(Date.now() + 9000).toISOString();
  const closingAuctions = AUCTIONS.map(a => ({ ...a, calculated_end: soon }));
  await page.route("**/rest/v1/auctions**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, closingAuctions);
  });

  await login(page);
  await page.goto("/auctions");

  // Ringen rendres som role="timer" med mono-tal "0:0X" (<= 9s tilbage).
  const ring = page.getByRole("timer").first();
  await expect(ring).toBeVisible();
  await expect(ring).toHaveText(/^0:0\d$/);
  // Selve SVG-ringen er til stede (to cirkler: spor + fremdrift).
  await expect(ring.locator("svg circle")).toHaveCount(2);
});
