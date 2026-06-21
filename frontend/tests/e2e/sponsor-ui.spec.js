// #1663 · UI-verifikation for renown-skaleret sponsor + forhandlbare kontrakter
// + per-løbsdag-indkomst. Sponsor-UI'et henter fra BACKEND-API'et
// (${VITE_API_URL}/api/sponsor/contract + /api/sponsor/offers), IKKE Supabase
// direkte — så vi mocker disse to endpoints OVEN PÅ installNetworkMocks
// (catch-all `**/api/**`); senest registrerede route vinder i Playwright.
//
// Verifikations-artefakt, ikke en cross-browser snapshot: kører kun på
// desktop-chromium og gemmer rå page.screenshot-billeder (ingen toHaveScreenshot-
// baseline), så ren visuel dokumentation uden snapshot-treadmill.
//
// Fixturen låser app'en til DA-locale (stabilizePage → cz_lang=da), så alle
// assertions matcher de danske sponsor-strenge (public/locales/da/sponsor.json).
import { test, expect } from "@playwright/test";
import {
  installNetworkMocks,
  login,
  json,
  stabilizePage,
  corsHeaders,
} from "./fixtures.js";

// Kendt mock-miljø-støj: Supabase realtime-websocket'en peger på den fiktive
// e2e-host (cycling-zone-e2e.supabase.co) der aldrig resolver → en network-level
// console.error uden relation til sponsor-flowet. Filtrér den fra så assertionen
// stadig fanger ÆGTE app-fejl.
const CONSOLE_NOISE = [/WebSocket connection to .*supabase\.co.*failed/i, /ERR_NAME_NOT_RESOLVED/i];

const ACTIVE_CONTRACT = {
  sponsor_name: "Alta Cycles",
  guaranteed_base: 544000,
  per_race_day_rate: 2400,
  length_seasons: 2,
  start_season: 1,
  expires_after_season: 2,
  status: "active",
};

const OFFERS_STATE = {
  negotiable: true,
  upcomingSeasonNumber: 2,
  pendingVariant: null,
  offers: [
    { variant: "predictable", sponsorName: "Meridian Bank", guaranteedBase: 479000, perRaceDayRate: 1000, lengthSeasons: 1 },
    { variant: "activity", sponsorName: "Alta Cycles", guaranteedBase: 299000, perRaceDayRate: 4100, lengthSeasons: 2 },
    { variant: "long", sponsorName: "Provincia Forsikring", guaranteedBase: 397000, perRaceDayRate: 2700, lengthSeasons: 3 },
  ],
};

// Registrér de to sponsor-routes EFTER installNetworkMocks så de vinder over
// catch-all'en. GET-only-guard: POST /api/sponsor/offers/accept falder igennem
// til catch-all'en (returnerer { ok: true }) hvis den nogensinde rammes.
async function installSponsorMocks(page) {
  await page.route("**/api/sponsor/contract", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, { contract: ACTIVE_CONTRACT });
  });

  await page.route("**/api/sponsor/offers", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, OFFERS_STATE);
  });
}

test.describe("#1663 sponsor UI", () => {
  test("Finance sponsor tab renders the active contract + Board negotiation modal shows 3 offers", async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (CONSOLE_NOISE.some((p) => p.test(text))) return;
      consoleErrors.push(text);
    });

    await stabilizePage(page);
    await installNetworkMocks(page);
    await installSponsorMocks(page);

    await login(page);

    // ── Finance → Sponsor-fane: aktiv kontrakt-panel ────────────────────────
    await page.goto("/finance?tab=sponsors");

    // Panel-titel (sponsor.json → contract.title) + sponsornavn + tal.
    await expect(page.getByRole("heading", { name: "Nuværende sponsor" })).toBeVisible();
    await expect(page.getByText("Alta Cycles")).toBeVisible();
    // formatNumber er locale-aware (da → punktum som tusindtals-separator).
    await expect(page.getByText("544.000 CZ$")).toBeVisible();
    await expect(page.getByText("2.400 CZ$")).toBeVisible();
    // Kontraktlængde (field.seasons, count=2) + "løber sæson 2 ud".
    await expect(page.getByText(/2 sæsoner/)).toBeVisible();
    await expect(page.getByText(/Løber sæson 2 ud/)).toBeVisible();

    await page.screenshot({ path: "tests/screenshots/sponsor-contract-panel.png", fullPage: true });

    // ── Board → "Se tilbud"-CTA → tilbuds-modal med 3 tilbud ────────────────
    await page.goto("/board");

    // CTA-titel + knap (sponsor.json → cta.title/cta.button, sæson 2).
    await expect(page.getByRole("heading", { name: "Vælg din sponsor for sæson 2" })).toBeVisible();
    const ctaButton = page.getByRole("button", { name: "Se tilbud" });
    await expect(ctaButton).toBeVisible();
    await ctaButton.click();

    // Modal åbner (offers.title) med de 3 varianter (variant.*).
    await expect(page.getByRole("heading", { name: "Sponsortilbud" })).toBeVisible();
    await expect(page.getByText("Stabil bagmand")).toBeVisible();
    await expect(page.getByText("Løbsdags-bagmand")).toBeVisible();
    await expect(page.getByText("Langsigtet partner")).toBeVisible();
    // De tre tilbuds sponsornavne — beviser at alle 3 kort renderes.
    // (Modal-primitivens luk-knap deler accessible name "Vælg" med kortenes
    //  vælg-knap, så vi tæller IKKE knapper; sponsornavnene er entydige.)
    await expect(page.getByText("Meridian Bank")).toBeVisible();
    await expect(page.getByText("Provincia Forsikring")).toBeVisible();
    // Tre vælg-knapper i kortene + modalens luk-knap = 4 "Vælg" i alt.
    await expect(page.getByRole("button", { name: "Vælg", exact: true })).toHaveCount(4);

    await page.screenshot({ path: "tests/screenshots/sponsor-offer-modal.png", fullPage: true });

    // ── Ingen uncaught fejl undervejs ───────────────────────────────────────
    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });
});
