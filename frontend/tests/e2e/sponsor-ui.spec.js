// #1663/#2948 · UI-verifikation for sponsorkontrakt-panelet paa Finance-fanen:
// aktiv kontrakt, bonusklausuler og hvad aftalen har indbragt. Tilbuds-flowet
// (5 arketyper, divisionsvaelger, Review & sign) laa ogsaa her indtil #4265
// flyttede det til /sponsors — det bevogtes nu af 4265-sponsors-page.spec.js.
// Sponsor-UI'et
// henter fra BACKEND-API'et (${VITE_API_URL}/api/sponsor/contract +
// /api/sponsor/offers), IKKE Supabase direkte — så vi mocker disse to endpoints
// OVEN PÅ installNetworkMocks (catch-all `**/api/**`); senest registrerede
// route vinder i Playwright.
//
// Verifikations-artefakt, ikke en cross-browser snapshot: kører kun på
// desktop-chromium og gemmer rå page.screenshot-billeder (ingen toHaveScreenshot-
// baseline), så ren visuel dokumentation uden snapshot-treadmill.
//
// Fixturen låser app'en til DA-locale (stabilizePage → cz_lang=da), så alle
// assertions matcher de danske sponsor-strenge (public/locales/da/sponsor.json).
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks,
  login,
  json,
  stabilizePage,
  corsHeaders,
  collectBrowserErrors,
  evidenceShotPath,
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
  variant: "results",
  guaranteed_fraction: 0.55,
  race_day_share: 0.1,
  bonus_clauses: [
    { type: "stage_win", amount: 8900 },
    { type: "podium", amount: 3500 },
    { type: "results_cap", amount: 247000 },
  ],
  created_at: "2026-05-08T00:00:00Z",
};

// Earnings-breakdown (#2948): panelet viser hvad kontrakten faktisk har givet.
const CONTRACT_EARNINGS = {
  base: 544000,
  raceDays: 96000,
  results: 17800,
  signing: 0,
  objective: 0,
  total: 657800,
};

// #2948-payload: 5 arketyper med frosne andele + klausuler.
const OFFERS_STATE = {
  negotiable: true,
  upcomingSeasonNumber: 2,
  pendingVariant: null,
  teamDivision: 3,
  stageCounts: { byTier: { 2: 112, 3: 84 }, fallbackDays: 28 },
  offers: [
    { variant: "safe", sponsorName: "Meridian Bank", guaranteedBase: 440000, guaranteedFraction: 0.92, raceDayShare: 0.08, perRaceDayRate: 1367, lengthSeasons: 1, clauses: [] },
    { variant: "loyal", sponsorName: "Nordhavn Shipping", guaranteedBase: 373000, guaranteedFraction: 0.78, raceDayShare: 0.18, perRaceDayRate: 3074, lengthSeasons: 3, clauses: [{ type: "signing", amount: 38240 }] },
    { variant: "racing", sponsorName: "Kestrel Outdoor", guaranteedBase: 239000, guaranteedFraction: 0.5, raceDayShare: 0.58, perRaceDayRate: 9906, lengthSeasons: 1, clauses: [] },
    { variant: "results", sponsorName: "Vesna Robotics", guaranteedBase: 263000, guaranteedFraction: 0.55, raceDayShare: 0.1, perRaceDayRate: 1708, lengthSeasons: 2, clauses: [{ type: "stage_win", amount: 8604 }, { type: "podium", amount: 3346 }, { type: "results_cap", amount: 239000 }] },
    { variant: "ambition", sponsorName: "Larkin Brewing", guaranteedBase: 335000, guaranteedFraction: 0.7, raceDayShare: 0.2, perRaceDayRate: 3416, lengthSeasons: 2, clauses: [{ type: "season_objective", objective: "top_half", amount: 86040 }] },
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
    return json(route, { contract: ACTIVE_CONTRACT, earnings: CONTRACT_EARNINGS });
  });

  await page.route("**/api/sponsor/offers", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, OFFERS_STATE);
  });
}

test.describe("#2948 sponsor UI", () => {
  test("Finance sponsor tab renders contract + earnings", async ({ page }, testInfo) => {
    // Screenshot-artefakterne skrives KUN fra desktop-chromium. Før #2862 skrev
    // alle 3 projekter til samme filnavn, så den committede PNG afhang af hvilket
    // projekt der kørte sidst.
    const capture = testInfo.project.name === "desktop-chromium";
    // #3601: BEGGE fejlkanaler filtreres for webkit-dev-noise (afbrudte
    // route-chunks + mock-CORS) — se WEBKIT_DEV_NOISE i fixtures.js. Uden det
    // gik netop denne spec rød på tilfældige PR'er under fuld belastning, og
    // frontend-smoke er en required check, så en test-artefakt blokerede
    // merges for alle. Opsamlingen ligger i fixtures.js, ikke her: da den lå
    // her, fik konsol-kanalen kun to af de tre kendte beskedvarianter.
    const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, {
      consoleNoise: CONSOLE_NOISE,
    });

    await stabilizePage(page);
    await installNetworkMocks(page);
    await installSponsorMocks(page);

    await login(page);

    // ── Finance → Sponsor-fane: aktiv kontrakt-panel m. klausuler + earnings ──
    await page.goto("/finance?tab=sponsors");

    await expect(page.getByRole("heading", { name: "Nuværende sponsor" })).toBeVisible();
    await expect(page.getByText("Alta Cycles")).toBeVisible();
    // formatNumber er locale-aware (da → punktum som tusindtals-separator).
    await expect(page.getByText("544.000 CZ$").first()).toBeVisible();
    await expect(page.getByText("2.400 CZ$")).toBeVisible();
    await expect(page.getByText(/2 sæsoner/)).toBeVisible();
    await expect(page.getByText(/Løber sæson 2 ud/)).toBeVisible();
    // #2948: klausul-linjer + earnings-sektion.
    await expect(page.getByText("Bonusklausuler")).toBeVisible();
    await expect(page.getByText(/8\.900 CZ\$ pr\. etapesejr/)).toBeVisible();
    await expect(page.getByText("Tjent på denne kontrakt")).toBeVisible();
    await expect(page.getByText("657.800 CZ$")).toBeVisible();

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("frontend/tests/screenshots/sponsor-contract-panel.png"), fullPage: true });
    }

    // ── Ingen uncaught fejl undervejs ───────────────────────────────────────
    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });
});
