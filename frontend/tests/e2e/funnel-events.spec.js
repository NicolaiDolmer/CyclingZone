import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders } from "./fixtures.js";

// #1583: aktiverings-funnellen skal kunne AFLÆSES direkte — dvs. de eksplicitte
// funnel-events skal faktisk fyre player_events-inserts gennem den byggede kode.
// Vi mocker Supabase + backend (fixtures), giver analytics-consent (ellers
// no-op'er logEvent), og opsnapper POST'er til player_events for at bekræfte at
// signup + onboarding_completed firer fra dashboardet. first_bid/first_transfer
// deler nøjagtigt samme logFirstEvent-maskineri (verificeret her via de-dup'en).

const SIGNUP_MARKER = "cz_pending_signup_event_v1";

// Opsnap event_name fra alle player_events-POST'er. Registreres EFTER
// installNetworkMocks, så denne smallere route vinder (Playwright kører seneste
// matchende handler først). Vi håndterer selv OPTIONS/POST/GET + CORS.
async function capturePlayerEvents(page) {
  const events = [];
  await page.route("**/rest/v1/player_events**", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(req) });
    if (req.method() === "POST") {
      try {
        const body = JSON.parse(req.postData() || "{}");
        for (const row of Array.isArray(body) ? body : [body]) {
          if (row?.event_name) events.push(row.event_name);
        }
      } catch { /* tom/ugyldig body — ignorér */ }
      return json(route, [], 201);
    }
    return json(route, []);
  });
  return events;
}

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
  // Override consent → analytics TIL (stabilizePage sætter false), så
  // player_events-instrumenteringen ikke no-op'er på consent-gaten.
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1,
      necessary: true,
      analytics: true,
      marketing: false,
      email_marketing: false,
      updated_at: "2026-05-13T00:00:00.000Z",
    }));
  });
});

test("signup-funnel-event firer ved authenticated dashboard når en pending-markør er sat", async ({ page }) => {
  // Simulér at brugeren netop har gennemført signUp() (LoginPage sætter markøren).
  await page.addInitScript(marker => {
    window.localStorage.setItem(marker, "1");
  }, SIGNUP_MARKER);

  const events = await capturePlayerEvents(page);
  await login(page);

  // signup skal fyre præcis én gang når brugeren lander authenticated på dashboardet.
  await expect.poll(() => events.filter(e => e === "signup").length).toBe(1);

  // De-dup: markøren skal være ryddet, så et reload ikke fyrer signup igen.
  const marker = await page.evaluate(key => window.localStorage.getItem(key), SIGNUP_MARKER);
  expect(marker).toBeNull();
});

test("signup firer IKKE uden pending-markør (eksisterende brugere forurener ikke funnellen)", async ({ page }) => {
  const events = await capturePlayerEvents(page);
  await login(page);

  // Giv dashboardet tid til at loade team + køre effekterne.
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.waitForTimeout(500);
  expect(events.filter(e => e === "signup")).toHaveLength(0);
});

test("onboarding_completed firer når onboarding-progress er 4/4", async ({ page }) => {
  // Override progress-endpointet til fuldført (4/4) — trigger for completion-eventet.
  await page.route("**/api/me/onboarding-progress", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(req) });
    return json(route, {
      completed_count: 4,
      total_count: 4,
      steps: [
        { key: "team_named", done: true },
        { key: "first_rider_owned", done: true },
        { key: "first_bid_placed", done: true },
        { key: "board_plan_set", done: true },
      ],
    });
  });

  const events = await capturePlayerEvents(page);
  await login(page);

  await expect.poll(() => events.filter(e => e === "onboarding_completed").length).toBe(1);
});
