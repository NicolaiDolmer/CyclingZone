import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// #5089: maaletest for rytterkortets API-fan-out.
//
// Baggrund: Railway-loggen 10/9 kl. 10:12 UTC viste flere hundrede 429'ere fra
// `api-baseline` paa fire millisekunder. Moenstret var 14 kald pr. rytter, og
// de GLOBALE kald (/api/deadline-day/status, /api/transfers, /api/scouting/me)
// blev gentaget for HVER rytter i stedet for at blive hentet een gang.
//
// Denne spec er tallet, ikke en formodning: den taeller faktiske HTTP-kald mod
// backend-API'et (ikke Supabase /rest/v1 og /auth/v1) mens to rytterprofiler
// aabnes efter hinanden. Groensen er en RATCHET: den maa saenkes naar fan-outen
// falder, aldrig haeves uden at issuet genaabnes.
//
// Maalt paa desktop-chromium, overblik-fanen (den fane spilleren lander paa).

const API_PATH_RE = /\/api\//;

function countApiCalls(page) {
  const calls = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!API_PATH_RE.test(url)) return;
    if (url.includes("/rest/v1/") || url.includes("/auth/v1/")) return;
    calls.push(`${request.method()} ${new URL(url).pathname}`);
  });
  return calls;
}

function tally(calls) {
  const counts = {};
  for (const c of calls) counts[c] = (counts[c] || 0) + 1;
  return counts;
}

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("rider card fan-out stays inside the api-baseline budget (#5089)", async ({ page }) => {
  await login(page);

  const calls = countApiCalls(page);

  await page.goto("/riders/rider-2");
  await expect(page.getByRole("tab", { name: /Overblik|Overview/ })).toBeVisible();
  await page.waitForLoadState("networkidle");

  const firstRiderCalls = [...calls];

  await page.goto("/riders/rider-1");
  await expect(page.getByRole("tab", { name: /Overblik|Overview/ })).toBeVisible();
  await page.waitForLoadState("networkidle");

  const secondRiderCalls = calls.slice(firstRiderCalls.length);

  // Diagnostik i rapporten, saa et fremtidigt regressionsfund viser HVILKET
  // endpoint der voksede og ikke bare et tal der ikke passer.
  console.log("[#5089] rider 1 of 2:", JSON.stringify(tally(firstRiderCalls), null, 2));
  console.log("[#5089] rider 2 of 2:", JSON.stringify(tally(secondRiderCalls), null, 2));

  // Ratchet 1: foerste rytterprofil (kold cache).
  expect(firstRiderCalls.length).toBeLessThanOrEqual(9);

  // Ratchet 2: NAESTE rytterprofil i samme session. De globale kald er delte,
  // saa rytter nr. 2 maa koste mindre end rytter nr. 1.
  expect(secondRiderCalls.length).toBeLessThanOrEqual(6);

  // De tre globale endpoints maa ikke gentages pr. rytter.
  const secondTally = tally(secondRiderCalls);
  expect(secondTally["GET /api/deadline-day/status"] ?? 0).toBe(0);
  expect(secondTally["GET /api/transfers"] ?? 0).toBe(0);
  expect(secondTally["GET /api/scouting/me"] ?? 0).toBe(0);

  // Fane-gatede endpoints maa ikke fyre paa Overblik-fanen.
  const firstTally = tally(firstRiderCalls);
  for (const gated of ["history", "interest", "view-count", "watchlist-count", "development", "development-projection"]) {
    expect(firstTally[`GET /api/riders/rider-2/${gated}`] ?? 0).toBe(0);
  }
});
