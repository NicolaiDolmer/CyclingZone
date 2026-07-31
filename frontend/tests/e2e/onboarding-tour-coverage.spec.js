// #2819 — forward-guard: hvert onboarding-trin i TOUR_PAGE_BY_STEP SKAL lande på en
// side der rent faktisk mounter <OnboardingTour> med et synligt første trin.
//
// Baggrunden: first_training_run og first_squad_selected var mappet til ingenting, så
// dashboardets "Show me how"-knap forsvandt tavst på 2 af 4 trin. Den fejl er usynlig
// i unit-tests (mappet er bare et objekt) og i build/lint — den viser sig først som en
// manglende knap i UI'et. Denne test lukker begge halvdele af hullet:
//   1) et trin uden tour-side (regression til det gamle hul), og
//   2) en tour-side hvis data-tour-anker er forsvundet fra markup'en (så touren ville
//      falde til "target ikke fundet"-fallbacken i stedet for at pege på noget).
//
// Kører i alle projekter, altså også mobile-chromium/mobile-webkit: touren skal virke
// på mobil, hvor over halvdelen af trafikken er.
import { test, expect } from "@playwright/test";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, makeBoardStatus,
} from "./fixtures.js";
import { TOUR_PAGE_BY_STEP } from "../../src/lib/onboardingTour.js";

// Trænings-fladen har ingen /api/training/me i standard-fixturen — uden den er
// rosteret tomt og fokus-/progress-ankrene findes ikke.
const TRAINING_ME = {
  enabled: true,
  teamId: TEST_TEAM.id,
  slots: { total: 2, used: 1 },
  todayRun: null,
  plans: { "rider-1": { focus: "sprint", intensity: "normal" } },
  condition: {
    "rider-1": { form: 72, fatigue: 38, risk: 0.02, injured_until: null },
    "rider-2": { form: 64, fatigue: 51, risk: 0.03, injured_until: null },
  },
  progress: {
    "rider-1": { sprint: 0.82, acceleration: 0.41 },
    "rider-2": { climbing: 0.35, punch: 0.22, tempo: 0.18 },
  },
  capped: {},
  trainability: {},
  smartDefaultFocus: { "rider-2": "vo2max" },
  weekPlan: null,
  riderWeekPlans: {},
};

// Trin → (rute, det data-tour-anker touren peger på i sit FØRSTE trin).
// Ruten skal matche STEP_TARGETS i OnboardingProgressCard.jsx.
const STEP_ROUTE_AND_FIRST_ANCHOR = {
  first_bid_placed: { route: "/auctions", anchor: "auctions-bid-input" },
  first_training_run: { route: "/training", anchor: "training-focus" },
  // #3102 etape 3: boardet bor på Planlægnings-hubbens Holdudtagelse-fane nu.
  first_squad_selected: { route: "/planning", anchor: "races-column" },
  board_plan_set: { route: "/board", anchor: "board-plans" },
};

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, TRAINING_ME);
  });
  // Standard-fixturen er baseline-fase, hvor board'et kun viser observations-
  // banneret og data-tour='board-plans' derfor ikke findes. Den eksisterende
  // board-tour peger på den non-baseline flade (samme som board-*.spec.js bruger).
  await page.route("**/api/board/status**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, makeBoardStatus());
  });
  await login(page);
});

test("every onboarding step maps to a page that mounts a tour", async () => {
  // Rent data-tjek: et trin uden side er præcis den regression #2819 lukkede.
  for (const step of Object.keys(STEP_ROUTE_AND_FIRST_ANCHOR)) {
    expect(TOUR_PAGE_BY_STEP[step], `step ${step} has no tour page`).toBeTruthy();
  }
  expect(Object.keys(TOUR_PAGE_BY_STEP).sort()).toEqual(
    Object.keys(STEP_ROUTE_AND_FIRST_ANCHOR).sort(),
  );
});

for (const [step, { route, anchor }] of Object.entries(STEP_ROUTE_AND_FIRST_ANCHOR)) {
  test(`tour for ${step} renders a real first step on ${route}`, async ({ page }) => {
    const tourPage = TOUR_PAGE_BY_STEP[step];
    // Samme localStorage-nøgle/-form som lib/onboardingTour.js' startTour().
    await page.addInitScript((p) => {
      window.localStorage.setItem("cz-onboarding-tour-step", JSON.stringify({ page: p, step: 0 }));
    }, tourPage);

    await page.goto(route);

    // Ankeret skal findes i markup'en — ellers ville touren vise sin
    // "target ikke fundet"-fallback i stedet for at pege på noget konkret.
    await expect(page.locator(`[data-tour="${anchor}"]`).first()).toBeAttached();

    // Og selve tooltip'en skal være fremme med tekst (ikke en tom/rå i18n-nøgle).
    const tip = page.getByRole("dialog").filter({ hasText: /1\// }).first();
    await expect(tip).toBeVisible();
    await expect(tip).not.toContainText("tour.");
  });
}
