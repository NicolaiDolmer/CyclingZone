// #2491 · Graduation Day-siden (T1) efter den ejer-godkendte hi-fi-mockup 2/9,
// artboards 3g (fyldt) og 3h (tom).
//
// Guarden holder paa netop de ting mockuppen og HANDOFF.md binder os paa, og
// som en kilde-tekst-test ikke kan se:
//   1) Ét kort pr. overgang, med de overgange serveren faktisk sendte.
//   2) Pr. rytter: identitet, rating-plade, potentiale-baand, kontrakt,
//      traenerens vurdering og segmentet.
//   3) `Move up` som default, og blokeret `Move up` = uvaelgelig + aarsag i
//      danger + `Sell` forvalgt.
//   4) Præcis ÉN guld primary paa viewet: `Confirm all`.
//   5) Tom tilstand = EmptyState uden guld (3h).
//   6) Academy har banner, ikke en anden graduerings-flade.
//
// Fixturen laaser app'en til DA-locale (stabilizePage → cz_lang=da), saa
// assertions matcher public/locales/da/academy.json.
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, login, json, stabilizePage, corsHeaders, collectBrowserErrors,
} from "./fixtures.js";
import { SEED_ACADEMY } from "../../src/preview/seedData.js";
import { GRADUATES, ESTIMATES_PAYLOAD } from "./2491-graduation-day.fixture.js";

const CONSOLE_NOISE = [/WebSocket connection to .*supabase\.co.*failed/i, /ERR_NAME_NOT_RESOLVED/i];

async function installGraduationMocks(page, { graduations = GRADUATES } = {}) {
  // Registreret EFTER installNetworkMocks, saa denne handler vinder
  // (Playwright: senest tilfoejede route matcher foerst).
  await page.route("**/api/academy/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, { ...SEED_ACADEMY, graduations });
  });
  await page.route("**/api/scouting/estimates", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "POST") return route.fallback();
    return json(route, ESTIMATES_PAYLOAD);
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

test("ét kort pr. overgang, med de overgange serveren sendte", async ({ page }, testInfo) => {
  collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });
  await installGraduationMocks(page);
  await login(page);
  await page.goto("/academy/graduation");

  await expect(page.getByRole("heading", { name: "Graduation Day", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fra juniorholdet til U23-holdet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fra U23-holdet til seniorholdet" })).toBeVisible();

  // Alle tre ryttere staar paa fladen, ingen overgang er skaaret vaek.
  for (const name of ["Mikkel Toft", "Nuno Fialho", "Aksel Berg"]) {
    await expect(page.getByRole("link", { name })).toBeVisible();
  }
});

test("raekken baerer rating-plade, potentiale-baand, kontrakt og traenerens vurdering", async ({ page }, testInfo) => {
  collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });
  await installGraduationMocks(page);
  await login(page);
  await page.goto("/academy/graduation");

  // Potentiale-baandet kommer fra det maskerede scout-estimat, samme
  // ScoutablePotentiale som resten af appen (data-potential-band="lo-hi").
  await expect(page.locator('[data-potential-band="44-52"]').first()).toBeVisible();
  await expect(page.locator('[data-potential-band="46-50"]').first()).toBeVisible();

  // Kontrakt + loen, tabulaert.
  await expect(page.getByText("Til sæson 5").first()).toBeVisible();
  await expect(page.getByText("21.500 CZ$").first()).toBeVisible();

  // Traenerens vurdering: den fog-gatede, hedgede saetning for rytteren der kun
  // er scoutet 1 af 3, og en rigtig vurdering for de faerdig-scoutede.
  await expect(
    page.getByText("Jeg har en fornemmelse af ham, men ikke en sikker en endnu."),
  ).toBeVisible();
});

test("Move up er default, blokeret Move up er uvaelgelig med aarsag og Sell forvalgt", async ({ page }, testInfo) => {
  collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });
  await installGraduationMocks(page);
  await login(page);
  await page.goto("/academy/graduation");

  // Seniortruppen har plads (18/30) → Ryk op er valgt.
  const senior = page.getByRole("group", { name: "Valg for Aksel Berg" });
  await expect(senior.getByRole("button", { name: "Ryk op" })).toHaveAttribute("aria-pressed", "true");
  await expect(senior.getByRole("button", { name: "Ryk op" })).toBeEnabled();

  // U23-truppen er fuld (12/12) → Ryk op staar, men er uvaelgelig, og Sælg er forvalgt.
  const junior = page.getByRole("group", { name: "Valg for Mikkel Toft" });
  await expect(junior.getByRole("button", { name: "Ryk op" })).toBeDisabled();
  await expect(junior.getByRole("button", { name: "Sælg" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Truppen er fuld (12/12)").first()).toBeVisible();
});

test("præcis ÉN guld primary paa viewet: Confirm all", async ({ page }, testInfo) => {
  collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });
  await installGraduationMocks(page);
  await login(page);
  await page.goto("/academy/graduation");

  const confirm = page.getByRole("button", { name: "Bekræft alle" });
  await expect(confirm).toBeVisible();
  // Guld-knappen er den ENESTE primary paa siden (TASTE fork 3 / HANDOFF pkt. 7).
  const goldButtons = page.locator("button.bg-cz-accent");
  await expect(goldButtons).toHaveCount(1);

  // Én linje om default-adfaerden, ÉN gang.
  await expect(
    page.getByText("Gør du ingenting, rykker rytterne op hvis der er plads, ellers bliver de sat til salg."),
  ).toHaveCount(1);
});

test("Confirm all sender ét kald pr. rytter med rytterens eget valg", async ({ page }, testInfo) => {
  collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });
  await installGraduationMocks(page);
  const sent = [];
  await page.route("**/api/academy/graduate", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    try { sent.push(JSON.parse(request.postData() || "{}")); } catch { /* tom body */ }
    return json(route, { riderId: "ok", action: "promoted" });
  });
  await login(page);
  await page.goto("/academy/graduation");

  await page.getByRole("group", { name: "Valg for Nuno Fialho" }).getByRole("button", { name: "Fyr" }).click();
  await page.getByRole("button", { name: "Bekræft alle" }).click();
  await expect.poll(() => sent.length).toBe(3);

  const byRider = Object.fromEntries(sent.map((s) => [s.riderId, s.action]));
  // Blokeret oprykning → sælg; det aktive valg → fyr; plads i senior → op.
  expect(byRider["grad-j1"]).toBe("sell");
  expect(byRider["grad-j2"]).toBe("release");
  expect(byRider["grad-u1"]).toBe("promote");
});

test("tom tilstand er EmptyState uden guld (artboard 3h)", async ({ page }, testInfo) => {
  collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });
  await installGraduationMocks(page, { graduations: [] });
  await login(page);
  await page.goto("/academy/graduation");

  await expect(page.getByText("Ingen ryttere skifter trup")).toBeVisible();
  await expect(page.getByRole("link", { name: "Tilbage til Akademiet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bekræft alle" })).toHaveCount(0);
  await expect(page.locator("button.bg-cz-accent")).toHaveCount(0);
});

test("Academy viser banneret, ikke en anden graduerings-flade", async ({ page }, testInfo) => {
  collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });
  await installGraduationMocks(page);
  await login(page);
  await page.goto("/academy");

  const link = page.getByRole("link", { name: "Åbn Graduation Day" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/academy/graduation");

  // Den gamle blok havde tre knapper pr. rytter paa Academy. De er vaek.
  await expect(page.getByRole("button", { name: "Sælg" })).toHaveCount(0);

  await link.click();
  await expect(page.getByRole("heading", { name: "Graduation Day", level: 1 })).toBeVisible();
});
