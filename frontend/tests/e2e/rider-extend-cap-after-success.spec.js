// #3597 · Forward-guard for runde 3 af Sentry CYCLINGZONE-45
// (`player action rejected: rider_extend_quote`).
//
// Reproduktionen er ikke et race og ikke browser-specifik: den forlængelse der
// bruger rytterens SIDSTE tilladte sæson efterlader rytter-profilen med
// `extendQuote === null` (den brugte quote smides væk) og `extendCapped ===
// false` (der er aldrig kommet et 409). Mount-tjekket er nøglet på `[rider.id]`,
// som ikke ændrer sig, så det kører ikke igen. Resultatet var en guld, klikbar
// "Forlæng kontrakt"-knap på en rytter hvis næste extend-quote er garanteret
// afvist — ét klik, én Sentry-hændelse, uanset browser.
//
// Testen kører hele spillerens vej: forlæng en rytter der har 1 forlængelse
// tilbage, og kræv at knappen er LÅST bagefter (og at tælleren står 3/3).
// Uden fixet er knappen enabled her, og testen fejler.
import { expect, test } from "./e2e-base.js";
import { corsHeaders, installNetworkMocks, json, login, stabilizePage } from "./fixtures.js";

const RIDER = "rider-1"; // hører til TEST_TEAM → egen-rytter-handlingerne rendres

const MAX_SEASON = 4;

// 2/3 brugt: én forlængelse tilbage. Dette er svaret FØR forlængelsen.
const QUOTE_ONE_LEFT = {
  currentSalary: 42000,
  newSalary: 48000,
  contract_end_season: MAX_SEASON,
  contract_length: 3,
  extensionCap: { maxSeason: MAX_SEASON, maxExtensions: 3, usedExtensions: 2, remainingExtensions: 1 },
};

// Svaret på selve forlængelsen: den sidste sæson er nu brugt (3/3, 0 tilbage).
const EXTEND_CONSUMES_LAST = {
  success: true,
  newSalary: 48000,
  contract_end_season: MAX_SEASON,
  contract_length: 3,
  extensionCap: { maxSeason: MAX_SEASON, maxExtensions: 3, usedExtensions: 3, remainingExtensions: 0 },
};

// Spejler den ægte backend: efter forlængelsen AFVISER extend-quote med 409.
// Kommer der et kald hertil efter forlængelsen, er hullet åbent igen.
const QUOTE_REJECTED = {
  error: "This rider's contract can't be extended any further right now",
  errorCode: "contract_extension_cap_reached",
  errorParams: { maxSeason: MAX_SEASON },
  extensionCap: { maxSeason: MAX_SEASON, maxExtensions: 3, usedExtensions: 3, remainingExtensions: 0 },
};

test("#3597: forlæng-knappen låser når forlængelsen bruger sidste tilladte sæson", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Tæller kald mod extend-quote EFTER forlængelsen. Et sådant kald er præcis
  // den afviste request Sentry-hændelsen blev rapporteret fra.
  let extended = false;
  let rejectedQuoteCalls = 0;

  // Registreret EFTER installNetworkMocks → vinder over fixturens generiske /api-mock.
  await page.route(`**/api/riders/${RIDER}/extend-quote`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (!extended) return json(route, QUOTE_ONE_LEFT);
    rejectedQuoteCalls += 1;
    return json(route, QUOTE_REJECTED, 409);
  });

  await page.route(`**/api/riders/${RIDER}/extend-contract`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    extended = true;
    return json(route, EXTEND_CONSUMES_LAST);
  });

  await login(page);
  await page.goto(`/riders/${RIDER}`);

  // Fixturen låser locale til DA (se stabilizePage).
  const trigger = page.getByRole("button", { name: "Forlæng kontrakt" });
  const counter = page.getByText("Forlængelser brugt").locator("xpath=following-sibling::span[1]");

  // Udgangspunkt: 2/3 brugt, knappen er åben (mount-tjekket er landet).
  await expect(trigger).toBeEnabled();
  await expect(counter).toHaveText("2/3");

  await trigger.click();
  await page.getByRole("button", { name: "Bekræft forlængelse" }).click();
  await expect(page.getByText("Kontrakt forlænget.")).toBeVisible();

  // Kontrakten: kapaciteten er brugt op, så knappen må ikke kunne klikkes igen.
  // Præcis her stod den enabled før fixet — ét klik = én afvist extend-quote.
  await expect(counter).toHaveText("3/3");
  await expect(trigger).toBeDisabled();

  // Og forklaringen skal følge med, så en låst knap ikke bare er tavs.
  await expect(page.getByText(`Kontrakt på maksimal længde (til og med sæson ${MAX_SEASON}).`)).toBeVisible();

  // Ingen doomed request nåede backend efter forlængelsen.
  expect(rejectedQuoteCalls).toBe(0);
});
