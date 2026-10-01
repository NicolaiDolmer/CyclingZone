// #5685 / #5630 — eet-tryks dagvalg + fremgang og prognose i telefonens
// Today-raekke (retning A, ejer-go 1/10, mockup
// docs/design/mockups-5630-5685-mobile-day-choice-2026-10-01).
//
// Guarden holder paa det rettelsen LOVER:
//   1) Mobil 390 bag beta (training_program_cells): hver raekke viser
//      "Fatigue tonight ~X" i serverens baand, saesonens fremgang og
//      Rest / Recovery / Program. Eet tryk paa Rest sender ET kald
//      (POST /api/training/:id, dayType "rest") — samme API som desktoppens
//      hurtig-knapper.
//   2) Efter Train now for i dag er valget laast.
//   3) "Select riders" (#5638) virker stadig: markering skjuler valget.
//   4) Uden beta-flaget er telefonens Today praecis som foer (tabellen).
//
// Testene saetter selv viewport, saa alle tre Playwright-projekter koerer de
// samme assertions. Foer/efter-billedet til PR'en tages i 390.
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS, evidenceShotPath } from "./fixtures.js";

const base = RIDERS.find((r: { id: string }) => r.id === "rider-1");
if (!base) throw new Error("fixtures.js: rider-1 mangler i RIDERS");
const FIRST = ["Mathias", "Tom", "Luca", "Rafael", "Viktor", "Antoine"];
const LAST = ["Sørensen", "Van Aerde", "Colombo", "Duran", "Lindqvist", "Fabre"];
const SQUAD = FIRST.map((firstname, i) => ({
  ...base,
  id: `rider-5685-${i}`,
  firstname,
  lastname: LAST[i],
  team_id: TEST_TEAM.id,
  is_academy: false,
}));
const BANDS = ["ok", "warn", "risk", "ok", "warn", "ok"] as const;

function trainingMe(opts: { todayRun?: unknown } = {}) {
  const plans: Record<string, { focus: string; intensity: string }> = {};
  const condition: Record<string, { form: number; fatigue: number; injured_until: null; risk: number }> = {};
  for (const [i, rider] of SQUAD.entries()) {
    plans[rider.id] = { focus: "tempo", intensity: i === 2 ? "rest" : "normal" };
    condition[rider.id] = { form: 60, fatigue: 20 + i * 10, injured_until: null, risk: 0 };
  }
  return {
    enabled: true,
    betaTester: true,
    mobileTable: true,
    teamId: TEST_TEAM.id,
    slots: { total: null, used: SQUAD.length, remaining: null },
    focuses: ["tempo", "endurance"],
    intensities: ["easy", "normal", "hard", "rest"],
    plans,
    condition,
    progress: {},
    capped: {},
    trainability: {},
    smartDefaultFocus: {},
    weekPlan: null,
    riderWeekPlans: {},
    racingToday: { "rider-5685-1": { race: "Stage race" } },
    todayRun: opts.todayRun ?? null,
  };
}

const RUNS = [
  {
    tick_date: "2026-05-04", executed_by: "manager", bonus_applied: true,
    report: { riders: SQUAD.slice(0, 3).map((r, i) => ({
      rider_id: r.id, name: `${r.firstname} ${r.lastname}`, focus: "tempo", intensity: "normal",
      gains: i === 0 ? { tempo: 3, endurance: 1 } : { tempo: 2 }, fatigue_delta: 3,
    })) },
  },
];

function preflight(route: Route) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    route.fulfill({ status: 204, headers: corsHeaders(request) });
    return true;
  }
  return false;
}

async function mockTraining(page: Page, { beta = true, todayRun = null as unknown } = {}) {
  const me = trainingMe({ todayRun });
  const planCalls: Array<{ riderId: string; dayType: string; session: string | null }> = [];
  await page.route("**/rest/v1/riders**", (route: Route) => (preflight(route) ? undefined : json(route, SQUAD)));
  await page.route("**/rest/v1/training_day_runs**", (route: Route) => (preflight(route) ? undefined : json(route, RUNS)));
  await page.route("**/api/training/me**", (route: Route) => (preflight(route) ? undefined : json(route, me)));
  await page.route("**/api/training/programs/forecast**", (route: Route) => {
    if (preflight(route)) return;
    if (!beta) return json(route, { available: false });
    const riders: Record<string, { fatigue: number; band: string; raceSlots: number[] }> = {};
    for (const [i, rider] of SQUAD.entries()) riders[rider.id] = { fatigue: 31 + i * 9.4, band: BANDS[i], raceSlots: [] };
    return json(route, { available: true, settled: false, tickDate: "2026-05-05", riders });
  });
  await page.route("**/api/training/programs", (route: Route) =>
    preflight(route) ? undefined : json(route, { enabled: false, cellsEnabled: beta, seeds: {}, catalog: [], assigned: {} }));
  await page.route(/\/api\/training\/rider-5685-\d$/, (route: Route) => {
    if (preflight(route)) return;
    const request = route.request();
    const riderId = request.url().split("/").pop() as string;
    const body = JSON.parse(request.postData() || "{}");
    planCalls.push({ riderId, ...body });
    const plan = body.dayType === "rest"
      ? { focus: "tempo", intensity: "rest" }
      : body.dayType === "recovery"
        ? { focus: "recovery", intensity: "easy" }
        : { focus: body.session ?? "tempo", intensity: "normal" };
    me.plans[riderId] = plan;
    return json(route, { plan });
  });
  return planCalls;
}

async function openTraining(page: Page, width: number, height: number, opts?: { beta?: boolean; todayRun?: unknown }) {
  await page.setViewportSize({ width, height });
  await stabilizePage(page);
  await installNetworkMocks(page);
  const planCalls = await mockTraining(page, opts);
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.goto("/training");
  await page.getByTestId("training-overview").waitFor();
  return planCalls;
}

const rows = (page: Page) => page.getByTestId("training-onetap-row");
const row = (page: Page, i: number) => rows(page).nth(i);

test("mobil 390 × 844 (beta): prognose, saesonfremgang og eet tryk = hvile", async ({ page }) => {
  const planCalls = await openTraining(page, 390, 844);
  await expect(rows(page)).toHaveCount(SQUAD.length);
  await expect(page.getByTestId("training-mobile-roster")).toHaveCount(0);

  // (1) "Fatigue tonight ~X" i serverens baand, eet tal pr. rytter.
  await expect(row(page, 0).getByTestId("training-onetap-forecast")).toHaveAttribute("data-band", "ok");
  await expect(row(page, 0).getByTestId("training-onetap-forecast")).toContainText("Fatigue tonight ~31");
  await expect(row(page, 2).getByTestId("training-onetap-forecast")).toHaveAttribute("data-band", "risk");

  // (2) saesonens fremgang (#5630); en rytter uden point viser ingen linje.
  await expect(row(page, 0).getByTestId("training-onetap-season")).toContainText("+3");
  await expect(row(page, 4).getByTestId("training-onetap-season")).toHaveCount(0);

  // Etape i dag staar i meta-linjen; valget gaelder kun traeningsfelterne.
  await expect(row(page, 1)).toContainText("stage today");

  // (3) trykket segment foelger planen.
  const choice = (i: number, c: string) => row(page, i).locator(`[data-choice="${c}"]`);
  await expect(choice(0, "session")).toHaveAttribute("aria-pressed", "true");
  await expect(choice(2, "rest")).toHaveAttribute("aria-pressed", "true");

  // Touch-targets >= 40 px.
  const box = await choice(0, "rest").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);

  await page.screenshot({ path: evidenceShotPath("pr-screens/5685/after-390.png") });

  await choice(0, "rest").click();
  await expect.poll(() => planCalls.length).toBe(1);
  expect(planCalls[0]).toMatchObject({ riderId: "rider-5685-0", dayType: "rest", session: null });
  await expect(choice(0, "rest")).toHaveAttribute("aria-pressed", "true");

  // Program bringer rytterens egen session tilbage med eet tryk.
  await choice(0, "session").click();
  await expect.poll(() => planCalls.length).toBe(2);
  expect(planCalls[1]).toMatchObject({ riderId: "rider-5685-0", session: "tempo" });
});

test("mobil 390 × 844 (beta): efter Train now er valget laast", async ({ page }) => {
  await openTraining(page, 390, 844, { todayRun: { id: "run-1", created_at: "2026-05-05T08:00:00Z", executed_by: "manager", report: { riders: [] } } });
  await expect(page.getByTestId("training-onetap-locked")).toBeVisible();
  await expect(row(page, 0).locator('[data-choice="rest"]')).toBeDisabled();
});

test("mobil 390 × 844 (beta): Select riders skjuler valget og markerer raekker", async ({ page }) => {
  await openTraining(page, 390, 844);
  await page.getByTestId("training-mobile-select-riders").click();
  await expect(page.getByTestId("training-onetap-choice")).toHaveCount(0);
  await row(page, 1).getByRole("button").first().click();
  await expect(row(page, 1)).toHaveAttribute("data-picked", "true");
  await expect(page.getByTestId("training-mobile-bulk-bar")).toContainText("1 selected");
});

test("mobil 390 × 844 uden beta: telefonens Today er uaendret (tabellen)", async ({ page }) => {
  await openTraining(page, 390, 844, { beta: false });
  await expect(page.getByTestId("training-mobile-roster")).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await page.screenshot({ path: evidenceShotPath("pr-screens/5685/before-390.png") });
});

test("desktop 1440 × 900 (beta): desktop beholder sine hurtig-knapper", async ({ page }) => {
  await openTraining(page, 1440, 900);
  await expect(page.getByTestId("training-today-table")).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
});
