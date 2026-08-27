// #4165 - planlægnings-hubben blankede for en spiller, og en genindlæsning hjalp
// ikke. Holdudtagelses-boardet havde ingen fejl-state: et ikke-2xx svar blev
// kastet væk, og `if (!data?.enabled) return null` tegnede derefter intet - en
// flade uden spinner, uden besked og uden retry.
//
// Testhullet der lod bugget slippe ud: preview-mocken svarer altid 200 på
// /api/races/distribution, så hele fejl-halvdelen af kontrakten var utestet. Den
// her spec dækker netop den halvdel - den fejler mod koden fra før fixet.
//
// Mønster: stabilizePage (sætter cz_lang=da) → installNetworkMocks → spec-
// override (LIFO) → login → goto, samme som race-distribution.spec.js. Copyen
// der assertes på er derfor den danske.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, corsHeaders } from "./fixtures.js";

const OK_BODY = {
  enabled: true,
  race_v3_enabled: false,
  season: { id: "s1", number: 1 },
  currentDay: 1,
  focusDay: 1,
  timeline: { totalDays: 3, currentDay: 1, days: [{ day: 1, dateText: null, terrain: "flat", hasMyRace: false }] },
  columns: [],
  bindingMap: {},
};

// Fejler de `failures` første kald, svarer 200 derefter. Tæller kaldene, så
// testen kan bevise at "Prøv igen" faktisk sender et NYT request.
function mockDistribution(page, { failures, status = 500 }) {
  const calls = { count: 0 };
  page.route("**/api/races/distribution**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    calls.count += 1;
    if (calls.count <= failures) {
      return route.fulfill({
        status,
        contentType: "application/json",
        headers: corsHeaders(request),
        body: JSON.stringify({ error: "boom" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify(OK_BODY),
    });
  });
  return calls;
}

test("fejlet board-hentning viser en fejl med retry, ikke en tom flade", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  mockDistribution(page, { failures: 99 });

  await login(page);
  await page.goto("/planning");

  // Selve bugget: manageren fik hverken board, spinner eller besked.
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert.getByText("Holdudtagelsen kunne ikke hentes")).toBeVisible();
  await expect(alert.getByRole("button", { name: "Prøv igen" })).toBeVisible();
  await expect(page.getByTestId("race-hub-board")).toHaveCount(0);
});

test("Proev igen henter board'et igen og fjerner fejlen", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const calls = mockDistribution(page, { failures: 1 });

  await login(page);
  await page.goto("/planning");

  const retry = page.getByRole("alert").getByRole("button", { name: "Prøv igen" });
  await expect(retry).toBeVisible();
  await retry.click();

  await expect(page.getByTestId("race-hub-board")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(calls.count).toBeGreaterThan(1);
});
