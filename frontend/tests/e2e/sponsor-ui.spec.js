// #1663/#2948 · UI-verifikation for Sponsorvalg 2.0: 5 arketype-tilbud med
// bonusklausuler, divisionsvælger m. løbsdage, deadline-banner og Review &
// sign-bekræftelse + kontraktpanel med klausuler og earnings. Sponsor-UI'et
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
import { test, expect } from "@playwright/test";
import {
  installNetworkMocks,
  login,
  json,
  stabilizePage,
  corsHeaders,
  collectPageErrors,
  WEBKIT_DEV_NOISE,
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
  test("Finance sponsor tab renders contract + earnings; Board modal shows 5 archetype offers with clauses", async ({ page }, testInfo) => {
    // Screenshot-artefakterne skrives KUN fra desktop-chromium. Før #2862 skrev
    // alle 3 projekter til samme filnavn, så den committede PNG afhang af hvilket
    // projekt der kørte sidst.
    const capture = testInfo.project.name === "desktop-chromium";
    // #3601: page-errors filtreres for webkit-dev-noise (afbrudte route-chunks +
    // mock-CORS) — se WEBKIT_DEV_NOISE i fixtures.js. Uden det gik netop denne
    // spec rød på tilfældige PR'er under fuld belastning, og frontend-smoke er
    // en required check, så en test-artefakt blokerede merges for alle.
    const pageErrors = collectPageErrors(page, testInfo);
    const isWebkit = testInfo.project.name.includes("webkit");
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (CONSOLE_NOISE.some((p) => p.test(text))) return;
      if (isWebkit && WEBKIT_DEV_NOISE.some((p) => p.test(text))) return;
      consoleErrors.push(text);
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
      await page.screenshot({ path: "tests/screenshots/sponsor-contract-panel.png", fullPage: true });
    }

    // ── Board → "Se tilbud"-CTA → tilbuds-modal med 5 arketyper ─────────────
    await page.goto("/board");

    await expect(page.getByRole("heading", { name: "Vælg din sponsor til sæson 2" })).toBeVisible();
    const ctaButton = page.getByRole("button", { name: "Se tilbud" });
    await expect(ctaButton).toBeVisible();
    await ctaButton.click();

    // Modal åbner (offers.title) med de 5 arketyper (variant.*). exact: true —
    // CTA-headingen "Vælg din sponsor til sæson 2" er stadig i DOM bag modalen.
    await expect(page.getByRole("heading", { name: "Vælg din sponsor", exact: true })).toBeVisible();
    await expect(page.getByText("Den sikre aftale")).toBeVisible();
    await expect(page.getByText("Den loyale aftale")).toBeVisible();
    await expect(page.getByText("Løbsaftalen")).toBeVisible();
    await expect(page.getByText("Resultataftalen")).toBeVisible();
    await expect(page.getByText("Ambitionsaftalen")).toBeVisible();

    // Enheds-definition + deadline/default-regel (#2862/#1778/#2914).
    await expect(page.getByText(/1 løbsdag = én etape dit hold stiller til start i/)).toBeVisible();
    await expect(page.getByText(/Ikke en kalenderdag/)).toBeVisible();
    await expect(page.getByText(/Vælger du ikke, underskriver klubben den sikre 1-sæsons aftale/)).toBeVisible();

    // #2862: enheden oversat til holdets EGNE tal — etapetal for den valgte
    // division + forholdet til kalenderdagene (84 etaper / 28 dage = 3 pr. dag).
    // Det var præcis regnestykket spillerne byggede regneark for at gætte.
    await expect(
      page.getByText(/Division 3 kører 84 etaper i sæson 2, altså 84 løbsdage du kan tjene på/)
    ).toBeVisible();
    await expect(
      page.getByText(/fordelt over 28 kalenderdage, så de fleste dage bærer omkring 3 etaper/)
    ).toBeVisible();

    // Divisionsvælger med løbsdage fra kalenderdata (#2862).
    await expect(page.getByRole("button", { name: "Division 3 · 84 løbsdage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Division 2 · 112 løbsdage" })).toBeVisible();

    // cuchiet 25/7 spørgsmål 1: hvorfor flytter totalen sig ikke når man skifter
    // division? Fordi divisionen kun omfordeler den samme pulje over flere etaper.
    // #3020 (ejer-beslutning 27/7): eksplicit copy-fix — maks-udbetalingen er den
    // samme uanset valgt division, kun raten pr. etape ændrer sig.
    await expect(
      page.getByText(/Din maksimale udbetaling ændrer sig ikke, uanset hvilken division du vælger/)
    ).toBeVisible();

    // cuchiet 25/7 spørgsmål 2: rører bestyrelsens modifier løbsdags-pengene? Nej.
    await expect(
      page.getByText(/Den rører ikke løbsdags-pengene eller bonusserne/)
    ).toBeVisible();

    // Regnestykket på kortene: løbsdage × rate, og hvad man ender med ved at
    // stille til start hver etape. Tallene er BEREGNEDE (ikke perRaceDayRate fra
    // payloaden), så assertionen fanger hvis projektionen driver.
    await expect(page.getByText("84 løbsdage × 455 CZ$")).toBeVisible();
    await expect(page.getByText("478.261 CZ$")).toBeVisible();
    await expect(page.getByText("84 løbsdage × 3.300 CZ$")).toBeVisible();
    await expect(page.getByText("516.240 CZ$")).toBeVisible();
    await expect(page.getByText(/Hvis du starter hver etape/).first()).toBeVisible();
    // Betinget bonus-top holdes adskilt fra det sikre beløb (results-kortet).
    await expect(page.getByText("+239.000 CZ$")).toBeVisible();

    // Skift division → raten skal ændre sig (112 etaper i D2), totalen ikke.
    await page.getByRole("button", { name: "Division 2 · 112 løbsdage" }).click();
    await expect(page.getByText("112 løbsdage × 342 CZ$")).toBeVisible();
    await expect(page.getByText("478.261 CZ$")).toBeVisible();
    await page.getByRole("button", { name: "Division 3 · 84 løbsdage" }).click();

    // Klausul-linjer på kortene.
    await expect(page.getByText(/38\.240 CZ\$ underskriftsbonus/)).toBeVisible();
    await expect(page.getByText(/8\.604 CZ\$ pr\. etapesejr/)).toBeVisible();
    await expect(page.getByText(/Slut i øverste halvdel af din division/)).toBeVisible();

    // 5 "Gennemgå og underskriv"-knapper (én pr. kort).
    await expect(page.getByRole("button", { name: "Gennemgå og underskriv" })).toHaveCount(5);

    // Review & sign-flow: bekræftelses-bar med "Underskriv aftale" (eneste gold).
    // Mobil-viewport: kortet ligger langt nede i modal-scrollen → scroll først.
    const reviewButton = page.getByRole("button", { name: "Gennemgå og underskriv" }).first();
    await reviewButton.scrollIntoViewIfNeeded();
    await reviewButton.click();
    await expect(page.getByText(/Underskriv med Meridian Bank i 1 sæson\?/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Underskriv aftale" })).toBeVisible();
    await page.getByRole("button", { name: "Annullér" }).click();

    if (capture) {
      // Modalen har intern scroll og står nede ved Review-knappen efter flowet
      // ovenfor. Rul tilbage til toppen, så artefaktet viser enheds-forklaringen
      // og ikke bare midten af kort-griddet.
      const modalTop = page.getByRole("heading", { name: "Vælg din sponsor", exact: true });
      await modalTop.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "tests/screenshots/sponsor-offer-modal.png", fullPage: true });

      // 360px: den smalleste udbredte telefon. Mobil er 54,9 % af trafikken, så
      // regnestykket på kortet skal kunne læses uden vandret scroll her.
      await page.setViewportSize({ width: 360, height: 900 });
      await expect(page.getByText("84 løbsdage × 455 CZ$")).toBeVisible();
      await modalTop.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "tests/screenshots/sponsor-offer-modal-360.png", fullPage: true });
      await page.setViewportSize({ width: 1280, height: 800 });
    }

    // ── Ingen uncaught fejl undervejs ───────────────────────────────────────
    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });
});
