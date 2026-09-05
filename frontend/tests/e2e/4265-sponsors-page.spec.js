// #4265 · Sponsors-siden: egen flade under Klubhus, "overblik først + faner ud".
//
// Ejer-direktiv 25/8: bestyrelsen og sponsorerne skal adskilles i UI'et
// (docs/BOARD_RULES.md §5). Forhandlingen laa paa Board-fladen indtil denne PR.
// Mockup med ejer-go 6/9: docs/design/mockups-sponsors-2026-09-06/sponsors-page-tabs.html.
//
// Guarden holder paa:
//   1) Fire underline-faner med Overview som default, ?tab= som dyb-link.
//   2) Overview svarer sidens spørgsmål paa ét skærmbillede: fire tal + to linjer.
//   3) Deal/Payments viser aftalens raekker og saesonens udbetalinger, inkl.
//      divisions-tillaegget (#4376) i Garanteret-gruppen.
//   4) Next season baerer tilbuddene inline med Review & sign → confirm-strip,
//      og de tre ejer-beslutninger fra modalen overlevede: enheden er en etape
//      (#2862), samme maksimum uanset division (#3020) og divisions-tillaegget
//      er synligt FOER underskriften (#4376).
//   5) Én guld pr. view: sidehovedets primary daempes paa Next season-fanen.
//   6) Board ejer ikke laengere flowet — kun ét stille link.
//
// Fixturen laaser app'en til DA-locale (stabilizePage → cz_lang=da), saa
// assertions matcher public/locales/da/sponsor.json. Tallene er mockuppens egne
// og hænger sammen: 214.200 + 30.000 garanteret, 33 etaper á 345, 22.491 i
// bonusser = 278.076 CZ$ i alt.
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

const CONSOLE_NOISE = [/WebSocket connection to .*supabase\.co.*failed/i, /ERR_NAME_NOT_RESOLVED/i];

const CONTRACT = {
  sponsor_name: "Corvus Aviation",
  guaranteed_base: 214200,
  per_race_day_rate: 345,
  length_seasons: 2,
  start_season: 2,
  expires_after_season: 3,
  status: "active",
  variant: "results",
  guaranteed_fraction: 0.55,
  race_day_share: 0.1,
  signed_division: 3,
  results_bonus_paid: 22491,
  bonus_clauses: [
    { type: "stage_win", amount: 12495 },
    { type: "podium", amount: 4998 },
    { type: "results_cap", amount: 189210 },
  ],
  created_at: "2026-05-08T00:00:00Z",
};

const raceDay = (id, amount, raceId, raceName, at) => ({
  id,
  type: "sponsor_race_day",
  amount,
  raceId,
  raceName,
  createdAt: at,
});

const SEASON = {
  number: 3,
  stagesTotal: 124,
  transactions: [
    { id: "b1", type: "sponsor", amount: 214200, createdAt: "2026-08-28T00:00:00Z" },
    { id: "b2", type: "division_adjustment", amount: 30000, createdAt: "2026-08-28T00:01:00Z" },
    raceDay("s1", 6210, "r1", "Giro della Penisola", "2026-08-30T00:00:00Z"),
    raceDay("s2", 2070, "r2", "Vuelta a los Pirineos", "2026-08-31T00:00:00Z"),
    raceDay("s3", 2070, "r3", "Tour of South Australia", "2026-09-01T00:00:00Z"),
    raceDay("s4", 345, "r4", "Klassieker van Kuurne", "2026-09-02T00:00:00Z"),
    raceDay("s5", 345, "r5", "Rund um Koeln Neu", "2026-09-02T01:00:00Z"),
    raceDay("s6", 345, "r6", "Ronde van Drenthe Nieuw", "2026-09-02T02:00:00Z"),
    {
      id: "x1",
      type: "sponsor_result_bonus",
      amount: 12495,
      raceId: "r1",
      raceName: "Giro della Penisola",
      createdAt: "2026-08-30T01:00:00Z",
      metadata: { params: { wins: 1, podiums: 0 } },
    },
    {
      id: "x2",
      type: "sponsor_result_bonus",
      amount: 4998,
      raceId: "r2",
      raceName: "Vuelta a los Pirineos",
      createdAt: "2026-08-31T01:00:00Z",
      metadata: { params: { wins: 0, podiums: 1 } },
    },
    {
      id: "x3",
      type: "sponsor_result_bonus",
      amount: 4998,
      raceId: "r4",
      raceName: "Klassieker van Kuurne",
      createdAt: "2026-09-02T03:00:00Z",
      metadata: { params: { wins: 0, podiums: 1 } },
    },
  ],
};

// Fem arketyper med frosne andele mod en 448.000 CZ$-pulje, saa de projicerede
// rater og "hvis du kører hver etape"-tallene er mockuppens egne.
const OFFERS_STATE = {
  negotiable: true,
  upcomingSeasonNumber: 4,
  pendingVariant: null,
  teamDivision: 2,
  stageCounts: { byTier: { 1: 140, 2: 124, 3: 84 }, fallbackDays: 31 },
  offers: [
    { variant: "safe", sponsorName: "Meridian Bank", guaranteedBase: 412160, guaranteedFraction: 0.92, raceDayShare: 0.08, perRaceDayRate: 289, lengthSeasons: 1, clauses: [] },
    { variant: "loyal", sponsorName: "Falcon Logistics", guaranteedBase: 349440, guaranteedFraction: 0.78, raceDayShare: 0.18, perRaceDayRate: 650, lengthSeasons: 3, clauses: [{ type: "signing", amount: 35840 }] },
    { variant: "racing", sponsorName: "Alta Cycles", guaranteedBase: 224000, guaranteedFraction: 0.5, raceDayShare: 0.58, perRaceDayRate: 2095, lengthSeasons: 1, clauses: [] },
    { variant: "results", sponsorName: "Vesna Robotics", guaranteedBase: 268800, guaranteedFraction: 0.6, raceDayShare: 0.12, perRaceDayRate: 434, lengthSeasons: 2, clauses: [{ type: "stage_win", amount: 15680 }, { type: "podium", amount: 6272 }, { type: "results_cap", amount: 237440 }] },
    { variant: "ambition", sponsorName: "Larkin Brewing", guaranteedBase: 313600, guaranteedFraction: 0.7, raceDayShare: 0.2, perRaceDayRate: 723, lengthSeasons: 2, clauses: [{ type: "season_objective", objective: "top_40pct", amount: 170240 }] },
  ],
};

async function installSponsorMocks(page, { offers = OFFERS_STATE } = {}) {
  await page.route("**/api/sponsor/contract", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, { contract: CONTRACT, earnings: null, season: SEASON });
  });

  await page.route("**/api/sponsor/offers", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, offers);
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installSponsorMocks(page);
});

test("Overview er default og svarer sidens spørgsmål uden at skifte fane", async ({ page }) => {
  await login(page);
  await page.goto("/sponsors");

  await expect(page.getByRole("heading", { name: "Sponsorer", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/sponsors$/);
  await expect(page.getByRole("tab", { name: "Overblik", selected: true })).toBeVisible();

  await expect(page.getByText("Corvus Aviation")).toBeVisible();
  await expect(page.getByText("Resultataftalen · underskrevet til sæson 2")).toBeVisible();
  await expect(page.getByText("Sæson 3 · division 2")).toBeVisible();

  // De fire tal fra mockuppen. 244.200 = 214.200 base + 30.000 divisions-tillæg.
  await expect(page.getByText("278.076 CZ$").first()).toBeVisible();
  await expect(page.getByText("244.200 CZ$")).toBeVisible();
  await expect(page.getByText("33.876 CZ$")).toBeVisible();
  await expect(page.getByText("33 af 124")).toBeVisible();

  await expect(
    page.getByText("Pr. etape 345 CZ$, 91 etaper tilbage er 31.395 CZ$ værd"),
  ).toBeVisible();
  await expect(
    page.getByText(/Næste sæson: 5 tilbud er åbne, valget låses når sæson 4 starter/),
  ).toBeVisible();
});

test("Deal-fanen viser aftalens rækker, inkl. divisions-tillægget (#4376)", async ({ page }) => {
  await login(page);
  await page.goto("/sponsors");

  await page.getByRole("tab", { name: "Aftalen" }).click();
  await expect(page).toHaveURL(/\/sponsors\?tab=deal$/);

  await expect(page.getByText("Garanteret ved sæsonstart")).toBeVisible();
  await expect(page.getByText("214.200 CZ$")).toBeVisible();
  await expect(page.getByText("124 etaper i division 2")).toBeVisible();
  await expect(page.getByText("42.780 CZ$ over sæsonen")).toBeVisible();
  // Aftalen er prissat i D3, holdet kører i D2 → gulv 0 + 50 % af (400.000 −
  // 340.000) = 30.000. Tallet skal staa paa fladen, ikke kun i motoren.
  await expect(page.getByText("Divisions-tillæg").first()).toBeVisible();
  await expect(
    page.getByText("Aftalen er prissat til division 3, du kører i division 2"),
  ).toBeVisible();
  await expect(page.getByText("30.000 CZ$").first()).toBeVisible();
  await expect(page.getByText("Loft 189.210 CZ$ pr. sæson")).toBeVisible();
  await expect(page.getByText("Løber sæson 3 ud")).toBeVisible();

  // Det stille hjælpe-link i kort-headeren (ingen prosa paa fladen).
  const helpLink = page.getByRole("link", { name: "Sådan virker sponsorpengene" });
  await expect(helpLink).toHaveAttribute("href", "/help?faq=sponsorPayoutTiming");
});

test("Payments-fanen grupperer sæsonens udbetalinger og summer til det samme tal", async ({ page }) => {
  await login(page);
  await page.goto("/sponsors?tab=payments");

  await expect(page.getByRole("tab", { name: "Udbetalinger", selected: true })).toBeVisible();
  await expect(page.getByText("Udbetalt i denne sæson")).toBeVisible();

  await expect(page.getByText("Garanteret", { exact: true })).toBeVisible();
  await expect(page.getByText("Etaper à 345 CZ$")).toBeVisible();
  await expect(page.getByText("Bonusser", { exact: true })).toBeVisible();

  await expect(page.getByText("Sæsonbase")).toBeVisible();
  await expect(page.getByText("Giro della Penisola").first()).toBeVisible();
  await expect(page.getByText("6.210 CZ$")).toBeVisible();

  // Totalrækken: samme tal som Overview's "udbetalt indtil nu".
  await expect(page.getByText("I alt")).toBeVisible();
  await expect(page.getByText("278.076 CZ$")).toBeVisible();
  await expect(page.getByText(/22\.491 af 189\.210/)).toBeVisible();
});

test("Next season: tilbuddene inline, Review & sign → confirm-strip, og kun ét guld", async ({ page }, testInfo) => {
  const capture = testInfo.project.name === "desktop-chromium";
  await login(page);
  await page.goto("/sponsors");

  // Guld-reglen: paa de tre andre faner er sidehovedets CTA den ene guld-knap.
  const headerCta = page.getByRole("button", { name: "Vælg næste sæsons sponsor" });
  await expect(headerCta).toHaveClass(/bg-cz-accent/);

  await page.getByRole("tab", { name: "Næste sæson" }).click();
  await expect(page).toHaveURL(/\/sponsors\?tab=next$/);
  // ... og paa Next season-fanen dæmpes den, saa "Underskriv aftale" er skærmens ene guld.
  await expect(headerCta).not.toHaveClass(/bg-cz-accent/);

  await expect(page.getByText("5 tilbud · division 2 · 124 etaper")).toBeVisible();
  await expect(
    page.getByText(/Dit valg låses når sæson 4 starter. Vælger du ikke, underskriver klubben den sikre 1-sæsons aftale/),
  ).toBeVisible();

  // Fem tilbud som tabelrækker (ikke en modal).
  await expect(page.getByRole("button", { name: "Gennemgå og underskriv" })).toHaveCount(5);
  await expect(page.getByText("Meridian Bank")).toBeVisible();
  await expect(page.getByText("Den sikre aftale · 1 sæson")).toBeVisible();
  await expect(page.getByText("412.160 CZ$")).toBeVisible();
  await expect(page.getByText("448.000 CZ$ hvis du kører hver etape")).toBeVisible();
  await expect(page.getByText("289 CZ$")).toBeVisible();
  // Projicerede rater, ikke payloadens perRaceDayRate — fanger drift i projektionen.
  await expect(page.getByText("2.095 CZ$")).toBeVisible();
  await expect(page.getByText(/35\.840 CZ\$ underskriftsbonus/)).toBeVisible();
  await expect(page.getByText(/Slut i top-40% af din division/)).toBeVisible();

  if (capture) {
    await page.screenshot({
      path: evidenceShotPath("frontend/tests/screenshots/sponsors-next-season.png"),
      fullPage: true,
    });
  }

  const reviewButton = page.getByRole("button", { name: "Gennemgå og underskriv" }).first();
  await reviewButton.scrollIntoViewIfNeeded();
  await reviewButton.click();
  await expect(page.getByText(/Underskriv med Meridian Bank i 1 sæson\?/)).toBeVisible();
  const signButton = page.getByRole("button", { name: "Underskriv aftale" });
  await expect(signButton).toHaveClass(/bg-cz-accent/);
  await page.getByRole("button", { name: "Annullér" }).click();
  await expect(page.getByText(/Underskriv med Meridian Bank i 1 sæson\?/)).toHaveCount(0);
});

test("prissætnings-forklaringen overlevede modalen: enhed, division og tillæg står bag folden", async ({ page }, testInfo) => {
  const capture = testInfo.project.name === "desktop-chromium";
  await login(page);
  await page.goto("/sponsors?tab=next");

  // Folden holder forklaringen ude af første skærm (fold-disciplin), men den ER der.
  await page.getByText("Sådan prissættes tilbuddene").click();

  // #2862: enheden er en etape, oversat til holdets egne tal.
  await expect(
    page.getByText(/Din sponsor betaler pr. etape dit hold stiller til start i/),
  ).toBeVisible();
  await expect(
    page.getByText(/Division 2 kører 124 etaper i sæson 4, og hver eneste af dem betaler/),
  ).toBeVisible();

  // #3020: samme maksimum uanset hvilken division man kigger paa.
  await expect(
    page.getByText(/udbetaler det samme maksimum uanset hvilken division du vælger/),
  ).toBeVisible();

  // #4376: tillægget vises IKKE for holdets egen division, men SKAL staa der
  // naar man kigger paa en anden — forbeholdet spilleren stillede da reglen blev valgt.
  await expect(page.getByText(/divisions-tillæg på .* CZ\$/)).toHaveCount(0);
  await page.getByRole("button", { name: "Division 1 · 140 etaper" }).click();
  await expect(page.getByText(/divisions-tillæg på 100\.000 CZ\$/)).toBeVisible();
  // Raten følger den valgte divisions etapetal (140 i D1).
  await expect(page.getByText("256 CZ$")).toBeVisible();

  // Bestyrelsens modifier rører kun garantien (BOARD_RULES.md §5).
  await expect(page.getByText(/Den rører ikke etape-pengene eller bonusserne/)).toBeVisible();

  if (capture) {
    await page.screenshot({
      path: evidenceShotPath("frontend/tests/screenshots/sponsors-next-season-pricing.png"),
      fullPage: true,
    });
  }
});

test("uden åbne tilbud: ingen guld i sidehovedet, og fanen siger hvornår de åbner", async ({ page }) => {
  await installSponsorMocks(page, {
    offers: { negotiable: false, upcomingSeasonNumber: 4, offers: [], pendingVariant: null, stageCounts: null, teamDivision: 2 },
  });
  await login(page);
  await page.goto("/sponsors?tab=next");

  await expect(page.getByRole("button", { name: "Vælg næste sæsons sponsor" })).toHaveCount(0);
  await expect(page.getByText("Tilbuddene åbner når sæson 3 slutter").first()).toBeVisible();
  const rulesLink = page.getByRole("link", { name: "Læs sponsorreglerne" });
  await expect(rulesLink).toHaveAttribute("href", "/help?faq=sponsorNegotiation");
});

test("Board ejer ikke længere sponsor-flowet — kun ét stille link", async ({ page }, testInfo) => {
  const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, {
    consoleNoise: CONSOLE_NOISE,
  });
  await login(page);
  await page.goto("/board");

  await expect(page.getByRole("heading", { name: "Vælg din sponsor til sæson 4" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Se tilbud" })).toHaveCount(0);
  const link = page.getByRole("link", { name: "Sponsorer" }).first();
  await expect(link).toHaveAttribute("href", "/sponsors");

  expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
  expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
});
