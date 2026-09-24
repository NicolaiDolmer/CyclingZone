// #5643 (epik #4592, spor A4) — et parkeret hold vender tilbage fra
// tilmeldingskortet med det samme, og kortet viser den nye division.
//
// Guarden holder på det kortet LOVER:
//   1) Parkeret: knappen hedder "Return to the league" og POST'er
//      /api/season/comeback (ikke /api/season/signup).
//   2) Efter svaret: "Welcome back" + divisionen fra serverens svar, og
//      knappen er væk (holdet er ikke længere parkeret).
//   3) Et fejlet kald viser en fejltekst, og knappen bliver stående.
//
// Beviserne (før/efter, desktop 1440 × 900 og mobil 390 × 844) tages kun i
// desktop-chromium-projektet, så tre projekter ikke skriver samme fil.
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import {
  installNetworkMocks,
  stabilizePage,
  login,
  json,
  corsHeaders,
  evidenceShotPath,
  waitForStableSnapshotTarget,
} from "./fixtures.js";

const PARKED = { enabled: true, eligible: true, parked: true, signed_up: false, next_season_number: 5 };

const SIZES = [
  { label: "desktop 1440 × 900", slug: "desktop", width: 1440, height: 900 },
  { label: "mobil 390 × 844", slug: "mobile", width: 390, height: 844 },
];

type ComebackCalls = { comeback: number; signup: number };

async function mockSeasonEndpoints(page: Page, { comebackStatus = 200 }: { comebackStatus?: number } = {}) {
  const calls: ComebackCalls = { comeback: 0, signup: 0 };
  await page.route("**/api/season/signup-status**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, PARKED);
  });
  await page.route("**/api/season/signup", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    calls.signup += 1;
    return json(route, { ok: true, signed_up: true, next_season_number: 5 });
  });
  await page.route("**/api/season/comeback", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    calls.comeback += 1;
    if (comebackStatus !== 200) return json(route, { error: "comeback_failed" }, comebackStatus);
    return json(route, {
      ok: true,
      returned: true,
      already_returned: false,
      division: 3,
      league_division_id: 12,
      pool_label: "Pool B",
      season_number: 4,
      sponsor: { paid: true, amount: 150000 },
    });
  });
  // Ingen planlagte løb: holdudtagelses-kortet vises ikke, og tilmeldingen ejer guldet.
  await page.route("**/rest/v1/races?**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, []);
  });
  return calls;
}

async function openDashboard(page: Page, width: number, height: number) {
  await login(page);
  // EN-first copy: sproget sættes EFTER login (login-helperen kræver de danske
  // placeholders), samme greb som 452-signup-card-top.spec.ts.
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.setViewportSize({ width, height });
  const statusAnswered = page.waitForResponse((res) => res.url().includes("/api/season/signup-status"));
  await page.goto("/dashboard");
  await statusAnswered;
  await expect(page.getByRole("heading", { name: "E2E Racing" })).toBeVisible();
  await waitForStableSnapshotTarget(page);
}

const writesEvidence = () => test.info().project.name === "desktop-chromium";

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

for (const size of SIZES) {
  test(`${size.label}: parkeret hold vender tilbage og ser sin nye division`, async ({ page }) => {
    const calls = await mockSeasonEndpoints(page);
    await openDashboard(page, size.width, size.height);

    const card = page.getByTestId("season-signup-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Your team was parked/);
    await expect(card).toContainText(/placed by your Global Rank/);
    const button = card.getByRole("button", { name: /Return to the league/ });
    await expect(button).toBeVisible();
    if (writesEvidence()) {
      await page.screenshot({ path: evidenceShotPath(`pr-screens/4592-comeback-${size.slug}-before.png`) });
    }

    await button.click();

    await expect(card).toContainText(/Welcome back/);
    await expect(card).toContainText(/Your team is back in Division 3/);
    await expect(card.getByRole("button")).toHaveCount(0);
    expect(calls.comeback).toBe(1);
    expect(calls.signup).toBe(0);
    if (writesEvidence()) {
      await page.screenshot({ path: evidenceShotPath(`pr-screens/4592-comeback-${size.slug}-after.png`) });
    }
  });
}

test("fejlet comeback: fejltekst, og knappen bliver stående", async ({ page }) => {
  const calls = await mockSeasonEndpoints(page, { comebackStatus: 409 });
  await openDashboard(page, 1440, 900);

  const card = page.getByTestId("season-signup-card");
  await card.getByRole("button", { name: /Return to the league/ }).click();

  await expect(card.getByRole("alert")).toContainText(/Could not bring your team back/);
  await expect(card.getByRole("button", { name: /Return to the league/ })).toBeVisible();
  await expect(card).toContainText(/Your team was parked/);
  expect(calls.comeback).toBe(1);
});
