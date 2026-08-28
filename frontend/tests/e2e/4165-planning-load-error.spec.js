// #4165 - planlægnings-hubben blankede for en spiller. Holdudtagelses-boardet
// havde ingen fejl-state: et ikke-2xx svar blev kastet væk, og
// `if (!data?.enabled) return null` tegnede derefter intet - en flade uden
// spinner, uden besked og uden retry. (Om en genindlæsning hjalp den aften er
// IKKE afgjort - tråden siger to forskellige ting. Skriv det ikke som fastslået.)
//
// Testhullet der lod bugget slippe ud: preview-mocken svarer altid 200 på
// /api/races/distribution, så hele fejl-halvdelen af kontrakten var utestet. Den
// her spec dækker netop den halvdel - den fejler mod koden fra før fixet.
//
// Mønster: stabilizePage (sætter cz_lang=da) → installNetworkMocks → spec-
// override (LIFO) → login → goto, samme som race-distribution.spec.js. Copyen
// der assertes på er derfor den danske.
import { test, expect } from "./e2e-base.js";
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

// Sæson-visningen på SAMME fane (?view=season). Vær præcis om hvad den her spec
// beviser: HTTP-grenen viste allerede en ErrorState før fixet, så testen fanger
// ikke den oprindelige tavshed. Den fejler mod pre-fix-koden på `role="alert"`,
// som fixet tilføjede - altså at fejlen nu også ANNONCERES, ikke kun tegnes.
//
// Den gren der faktisk var tavs her, var AUTH-grenen: uden token returnerede
// effekten uden at sætte noget, og render-grenen sagde "Ingen løb på kalenderen
// endnu". Den kan ikke nås i e2e (fladen ligger bag ProtectedRoute, så App
// redirecter før komponenten mounter), og er derfor kildeguardet i
// silentFailureContract.4165.test.js i stedet. Assertionen på den tomme tilstand
// nedenfor er alligevel den rigtige regression-guard: den pinner at fejl-grenen
// ligger før den tomme gren, uanset hvilken gren der satte fejlen.
function mockCalendar(page, { failures, status = 500 }) {
  const calls = { count: 0 };
  page.route("**/api/races/calendar**", (route) => {
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
    return route.continue();
  });
  return calls;
}

test("fejlet kalender-hentning i saeson-visningen viser en fejl, ikke en tom kalender", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  mockCalendar(page, { failures: 99 });

  await login(page);
  await page.goto("/planning?view=season");

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert.getByText("Sæsonkalenderen kunne ikke hentes", { exact: false })).toBeVisible();
  await expect(alert.getByRole("button", { name: "Prøv igen" })).toBeVisible();
  // Kernen i fundet: den tomme tilstand må IKKE være det manageren ser.
  await expect(page.getByText("Ingen løb på kalenderen endnu")).toHaveCount(0);
});
