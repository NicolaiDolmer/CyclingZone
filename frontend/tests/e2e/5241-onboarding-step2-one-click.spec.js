import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, evidenceShotPath } from "./fixtures.js";

// #5241 (ejer-beslutning 14/9 efter #4964-undersøgelsen): onboarding-kortets
// trin 2 ("Kør din første træningsdag") bliver ét klik. "Kør ugens træning"
// sætter assistentens anbefalede fokus for hele truppen (det eksisterende
// bulk-fokus-endpoint, session="smart") og kører derefter dagens træning
// (samme vej som "Kør træning"-knappen på træningssiden). Trin 2 var det
// eneste FALDENDE onboarding-trin (52 % → 34 %, docs/audits/2026-09-14-
// launch-cohort-dropoff.md) fordi den gamle vej krævede fokus rytter for
// rytter på træningssiden.
//
// Denne spec beviser: klik -> bulk-fokus + kør-i-dag kaldes -> trin 2
// krydses af -> resultatlinjen viser antallet -> eventet fyrer -> idempotent
// guard når dagens træning allerede er kørt.

const ONBOARDING_PROGRESS_OPEN = {
  completed_count: 1,
  total_count: 4,
  dismissed: false,
  established: false,
  steps: [
    { key: "first_bid_placed", done: true },
    { key: "first_training_run", done: false },
    { key: "first_squad_selected", done: false },
    { key: "board_plan_set", done: false },
  ],
};

// Minimal /api/training/me — to ryttere uden eksisterende plan, så bulk-smart
// rammer begge (matcher TrainingPage.jsx's "Accept"-sti, ingen ny model).
function trainingMeResponse({ todayRun = null } = {}) {
  return {
    enabled: true,
    teamId: "team-e2e",
    slots: { total: 4, used: 0, remaining: 4 },
    plans: {},
    todayRun,
    condition: {},
    progress: {},
    capped: {},
    trainability: {},
    smartDefaultFocus: { "rider-1": "sprint", "rider-2": "vo2max" },
    weekPlan: null,
    riderWeekPlans: {},
  };
}

const RUN_TODAY_REPORT = {
  riders: [
    { rider_id: "rider-1", score: 1, gains: {}, status: "normal", focus: "sprint", intensity: "normal" },
    { rider_id: "rider-2", score: 1, gains: {}, status: "normal", focus: "vo2max", intensity: "normal" },
  ],
  bonus_applied: true,
  executed_by: "manager",
  tick_date: "2026-09-14",
};

async function installOnboardingMocks(page, { todayRun = null } = {}) {
  await page.route("**/api/me/onboarding-progress", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(req) });
    return json(route, ONBOARDING_PROGRESS_OPEN);
  });
  await page.route("**/api/training/me", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(req) });
    return json(route, trainingMeResponse({ todayRun }));
  });
  await page.route("**/api/training/bulk", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(req) });
    return json(route, {
      ok: true,
      applied: 2,
      appliedRiderIds: ["rider-1", "rider-2"],
      skipped: { notOwned: [], noSlots: [], hasPlan: [] },
      plans: {
        "rider-1": { focus: "sprint", intensity: "normal" },
        "rider-2": { focus: "vo2max", intensity: "normal" },
      },
      slots: { total: 4, used: 2, remaining: 2 },
    });
  });
  await page.route("**/api/training/run-today", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(req) });
    return json(route, { ok: true, tickDate: "2026-09-14", report: RUN_TODAY_REPORT });
  });
}

async function capturePlayerEvents(page) {
  const events = [];
  await page.route("**/rest/v1/player_events**", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(req) });
    if (req.method() === "POST") {
      try {
        const body = JSON.parse(req.postData() || "{}");
        for (const row of Array.isArray(body) ? body : [body]) {
          if (row?.event_name) events.push({ name: row.event_name, data: row.event_data });
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
  // Analytics-consent TIL, ellers no-op'er onboarding_step2_one_click (samme
  // opsætning som funnel-events.spec.js).
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

test("eet klik saetter fokus, koerer ugens traening og krydser trin 2 af (#5241)", async ({ page }, testInfo) => {
  await installOnboardingMocks(page);
  const events = await capturePlayerEvents(page);

  const bulkCalls = [];
  const runTodayCalls = [];
  page.on("request", req => {
    if (req.method() === "POST" && req.url().includes("/api/training/bulk")) bulkCalls.push(req);
    if (req.method() === "POST" && req.url().includes("/api/training/run-today")) runTodayCalls.push(req);
  });

  await login(page);

  const primaryButton = page.getByRole("button", { name: "Kør ugens træning" });
  await expect(primaryButton).toBeVisible();
  // Sekundær vej findes stadig (den gamle vej, "Vælg selv" -> /training).
  await expect(page.getByRole("link", { name: "Vælg selv" })).toBeVisible();
  // Precondition: trin 2 er endnu ikke afkrydset, og resultatlinjen findes ikke.
  await expect(page.getByText(/Ugen kørt:/)).toHaveCount(0);

  await primaryButton.click();

  // Resultatlinjen med det faktiske antal fra run-today-rapporten (2 ryttere).
  await expect(page.getByText("Ugen kørt: 2 ryttere trænet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Se træning" })).toBeVisible();
  // Knapperne er væk — trinnet er afsluttet, ikke længere "næste".
  await expect(primaryButton).toHaveCount(0);

  // Trin 2-raekken viser nu et afkrydset/gennemstreget label (samme visuelle
  // sprog som de andre fuldførte trin, #4625).
  const trainingRow = page.locator("li", { hasText: "Kør din første træningsdag" });
  await expect(trainingRow.locator(".line-through")).toBeVisible();

  // Header-taelleren stiger lokalt fra 1/4 til 2/4 uden at vente paa at
  // DashboardPage refetcher onboarding-progress (denne fil ejer ikke den prop).
  await expect(page.getByText(/2\/4/)).toBeVisible();

  // Backend-kaldene skete i den rigtige raekkefoelge: bulk-smart FOER run-today.
  expect(bulkCalls).toHaveLength(1);
  expect(runTodayCalls).toHaveLength(1);
  const bulkBody = JSON.parse(bulkCalls[0].postData() || "{}");
  expect(bulkBody.session).toBe("smart");
  expect(new Set(bulkBody.riderIds)).toEqual(new Set(["rider-1", "rider-2"]));

  // Eventet der maaler #4964-effekten.
  await expect.poll(() => events.filter(e => e.name === "onboarding_step2_one_click").length).toBe(1);

  // Skaermbilleder til PR-body — kun desktop + mobil-chromium (390-bredden),
  // webkit-projektet koerer testen for daekning uden at gemme et tredje billede.
  if (testInfo.project.name !== "mobile-webkit") {
    await page.screenshot({
      path: evidenceShotPath(`pr-screens/5241/${testInfo.project.name}-after-click.png`),
      fullPage: true,
    });
  }
});

test("idempotent: dagens traening allerede koert viser 'ugen er allerede koert' uden nye kald (#5241)", async ({ page }) => {
  // Racy tilfaelde: onboarding-progress-proppen siger endnu ikke done, men
  // useTraining()'s EGEN friske GET /api/training/me viser at dagen allerede
  // er koert (fx via traeningssiden i et andet faneblad).
  await installOnboardingMocks(page, {
    todayRun: {
      executed_by: "manager", bonus_applied: true, report: RUN_TODAY_REPORT,
      tick_date: "2026-09-14", created_at: "2026-09-14T06:00:00.000Z",
    },
  });

  const bulkCalls = [];
  const runTodayCalls = [];
  page.on("request", req => {
    if (req.method() === "POST" && req.url().includes("/api/training/bulk")) bulkCalls.push(req);
    if (req.method() === "POST" && req.url().includes("/api/training/run-today")) runTodayCalls.push(req);
  });

  await login(page);

  await expect(page.getByText("Ugen er allerede kørt.")).toBeVisible();
  // Ingen knapper at klikke paa — flowet koerer aldrig, hverken bulk eller
  // run-today.
  await expect(page.getByRole("button", { name: "Kør ugens træning" })).toHaveCount(0);
  expect(bulkCalls).toHaveLength(0);
  expect(runTodayCalls).toHaveLength(0);
});

test("uden dagligt-traeningsflag falder trinnet tilbage til den gamle lænke (#5241)", async ({ page }) => {
  await page.route("**/api/me/onboarding-progress", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(req) });
    return json(route, ONBOARDING_PROGRESS_OPEN);
  });
  await page.route("**/api/training/me", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(req) });
    return json(route, { ...trainingMeResponse(), enabled: false });
  });

  await login(page);

  // Ingen ét-klik-knap, men den oprindelige simple CTA-lænke til /training
  // (uaendret adfaerd for hold uden flaget) er der stadig.
  await expect(page.getByRole("button", { name: "Kør ugens træning" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Gå til træning/ })).toBeVisible();
});
