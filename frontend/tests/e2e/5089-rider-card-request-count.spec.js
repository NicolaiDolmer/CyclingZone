import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// #5089: maaletest for rytterkortets API-fan-out.
//
// ── Hvorfor den findes ──────────────────────────────────────────────────────
//
// Railway-loggen 10/9 kl. 10:12:24 UTC viste flere hundrede 429'ere fra
// `api-baseline` inden for fire millisekunder. Moenstret var ca. 14 kald pr.
// rytterkort, og tre af dem var GLOBALE (`/api/transfers`,
// `/api/deadline-day/status`, `/api/scouting/me`): de svarer det samme uanset
// hvilken rytter der vises, men blev hentet forfra ved hvert eneste mount.
//
// Graensen i `apiBaselineLimiter` (backend/routes/api.js) er en sikkerheds-
// kontrol og maa IKKE haeves som "fix". Denne spec er den anden ende af den
// aftale: den holder fan-outen nede, saa graensen kan blive staaende.
//
// ── Hvordan den maaler ──────────────────────────────────────────────────────
//
// Kun rytterkortets EGNE endpoints taelles. App-skallen (inbox, presence,
// online-count, forum, academy, training) fyrer sine egne kald ved hver
// navigation og har intet med #5089 at goere; at taelle dem med ville goere
// ratchetten stoej-foelsom og ubrugelig som regressions-vagt.
//
// Tallene er RATCHETS: de maa saenkes naar fan-outen falder, aldrig haeves uden
// at #5089 genaabnes.

// Rytterkortets eget budget: alt under /api/riders/<id>/, pro-historikken, samt
// de tre globale endpoints issuet naevner.
const RIDER_CARD_RE = /\/api\/(riders\/[^/]+\/|pro\/rider-history\/|transfers$|deadline-day\/status$|scouting\/(me|estimates)$)/;

function countRiderCardCalls(page) {
  const calls = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!RIDER_CARD_RE.test(url.pathname)) return;
    calls.push(`${request.method()} ${url.pathname}`);
  });
  return calls;
}

function tally(calls) {
  const counts = {};
  for (const c of calls) counts[c] = (counts[c] || 0) + 1;
  return counts;
}

async function settleOnProfile(page) {
  // Eksplicit timeout: profilen er en lazy chunk, og under parallelle workers
  // kan foerste indlaesning overskride expect-defaulten paa 5 s lokalt. Det er
  // "testen naaede ikke frem", ikke en langsom flade (samme afvejning som
  // test-timeouten i #4647).
  await expect(page.getByRole("tab", { name: /Overblik|Overview/ })).toBeVisible({ timeout: 15000 });
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("cold rider profile stays inside the api-baseline budget (#5089)", async ({ page }) => {
  await login(page);
  // Dashboard'et mounter selv app-skallen (Layout -> useScoutingCentral). Lad den
  // falde til ro FOER taelleren saettes paa, ellers lander dashboardets egne kald
  // i profilens regnskab og tallet bliver stoej-afhaengigt.
  await page.waitForLoadState("networkidle");
  const calls = countRiderCardCalls(page);

  // rider-2 er en RIVAL-rytter (fixture): ingen ejer-handlinger i hero'en.
  await page.goto("/riders/rider-2");
  await settleOnProfile(page);
  const rival = [...calls];

  console.log("[#5089] rival profile, cold load:", JSON.stringify(tally(rival), null, 2));

  // Ratchet: hele profilens fan-out ved en kold sideindlaesning.
  // Maalt 10/9: 15 foer, 8 efter.
  expect(rival.length).toBeLessThanOrEqual(8);

  const rivalTally = tally(rival);

  // Layout mounter useScoutingCentral og profilen mounter useScouting. Begge
  // laeser /api/scouting/me; de skal dele svaret, ikke hente hver sin kopi.
  expect(rivalTally["GET /api/scouting/me"] ?? 0).toBeLessThanOrEqual(1);

  // Fane-gatede endpoints maa ikke fyre paa Overblik-fanen.
  for (const gated of ["history", "interest", "view-count", "watchlist-count", "development", "development-projection"]) {
    expect(rivalTally[`GET /api/riders/rider-2/${gated}`] ?? 0).toBe(0);
  }
});

test("global endpoints are not refetched when navigating into a rider profile (#5089)", async ({ page }) => {
  await login(page);

  // Holdsiden henter selv begge globale endpoints ved mount.
  await page.goto("/team");
  await expect(page.getByRole("link", { name: /Pedersen/ }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");

  // Taelleren starter FOERST her, saa vi kun maaler navigationen ind i profilen.
  const calls = countRiderCardCalls(page);

  await page.getByRole("link", { name: /Pedersen/ }).first().click();
  await settleOnProfile(page);

  console.log("[#5089] own profile, warm client-side navigation:", JSON.stringify(tally(calls), null, 2));

  const warm = tally(calls);
  expect(warm["GET /api/deadline-day/status"] ?? 0).toBe(0);
  expect(warm["GET /api/scouting/me"] ?? 0).toBe(0);
  expect(warm["GET /api/transfers"] ?? 0).toBeLessThanOrEqual(1);

  // Ratchet: den DYRE profil (egen rytter, med salgs-knap og kontrakt-panel)
  // efter en klient-navigation. Maalt 10/9: 16 foer, 7-8 efter.
  //
  // 7 ELLER 8: POST /api/scouting/estimates afhaenger af om profilens egen
  // useScouting-instans naar at bede om rytterens potentiale-baand, og det er
  // ikke deterministisk (25 ms batch-timer + mount-raekkefoelge). Estimaterne er
  // bevidst IKKE lagt i sharedRequestCache: baandet er viewer-maskeret pr.
  // (rytter, hold) og aendrer sig naar en scout-opgave modner, saa et delt
  // cache uden invaliderings-kontrakt ville kunne vise et foraeldet baand.
  expect(calls.length).toBeLessThanOrEqual(8);
});

test("tab data is fetched on tab open, once per rider (#5089)", async ({ page }) => {
  await login(page);
  await page.waitForLoadState("networkidle");
  const calls = countRiderCardCalls(page);

  await page.goto("/riders/rider-2");
  await settleOnProfile(page);
  expect(tally(calls)["GET /api/riders/rider-2/history"] ?? 0).toBe(0);

  await page.getByRole("tab", { name: /Historik|History/ }).click();
  await expect.poll(() => tally(calls)["GET /api/riders/rider-2/history"] ?? 0).toBe(1);

  // Frem og tilbage mellem fanerne maa ikke hente forfra.
  await page.getByRole("tab", { name: /Overblik|Overview/ }).click();
  await page.getByRole("tab", { name: /Historik|History/ }).click();
  await page.waitForLoadState("networkidle");
  expect(tally(calls)["GET /api/riders/rider-2/history"]).toBe(1);
});
