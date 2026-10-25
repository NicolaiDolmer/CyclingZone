// #6110 S26 - "Dagens beslutning" oeverst paa Today-fanen, bag training_decision_card
// (serveren leverer `decisionCard` som en bar boolean).
//
// Guarden holder paa det kortet LOVER:
//   1) Flag ON: kortet staar over overblikket med forslag for de traette ryttere
//      der har en haard dag planlagt, traetteste foerst, og ingen for de andre.
//   2) "Use" skriver aktiv restitution for netop den rytter (POST /api/training/:id).
//   3) "Use all" skriver for alle viste forslag; kortet skrumper til "ingen aendring".
//   4) Flag OFF: ingen kort (den gamle visning).
// Testene saetter selv viewport, saa alle Playwright-projekter koerer dem.
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS, evidenceShotPath } from "./fixtures.js";

const base = RIDERS.find((r: { id: string }) => r.id === "rider-1");
if (!base) throw new Error("fixtures.js: rider-1 mangler i RIDERS");
const FIRST = ["Mathias", "Tom", "Luca", "Rafael", "Viktor", "Antoine"];
const LAST = ["Sørensen", "Van Aerde", "Colombo", "Duran", "Lindqvist", "Fabre"];
const SQUAD = FIRST.map((firstname, i) => ({
  ...base,
  id: `rider-6110-${i}`,
  firstname,
  lastname: LAST[i],
  primary_type: i % 2 ? "climber" : "sprinter",
  team_id: TEST_TEAM.id,
  is_academy: false,
}));
// Rytter 0 og 1 er traette med en haard dag (risiko oppe), 2 er traet men paa let dag.
const FATIGUE = [86, 78, 82, 40, 30, 20];
const RISK = [0.2, 0.12, 0, 0, 0, 0];

function trainingMe(decisionCard: boolean) {
  const plans: Record<string, { focus: string; intensity: string }> = {};
  const condition: Record<string, { form: number; fatigue: number; injured_until: null; risk: number }> = {};
  for (const [i, rider] of SQUAD.entries()) {
    plans[rider.id] = i === 2 ? { focus: "endurance", intensity: "easy" } : { focus: i < 2 ? "threshold" : "tempo", intensity: i < 2 ? "hard" : "normal" };
    condition[rider.id] = { form: 60, fatigue: FATIGUE[i], injured_until: null, risk: RISK[i] };
  }
  return {
    enabled: true,
    betaTester: true,
    mobileTable: true,
    decisionCard,
    teamId: TEST_TEAM.id,
    slots: { total: null, used: SQUAD.length, remaining: null },
    focuses: ["tempo", "endurance", "threshold"],
    intensities: ["easy", "normal", "hard", "rest"],
    plans,
    condition,
    progress: {},
    capped: {},
    trainability: {},
    smartDefaultFocus: {},
    weekPlan: null,
    riderWeekPlans: {},
    todayRun: null,
  };
}

function preflight(route: Route) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    route.fulfill({ status: 204, headers: corsHeaders(request) });
    return true;
  }
  return false;
}

type PlanBody = { dayType: string; session: string | null };

async function openTraining(page: Page, { decisionCard, width = 1440, height = 900 }: { decisionCard: boolean; width?: number; height?: number }) {
  const posts: Array<PlanBody & { riderId: string }> = [];
  const me = trainingMe(decisionCard);
  await page.setViewportSize({ width, height });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/riders**", (route: Route) => (preflight(route) ? undefined : json(route, SQUAD)));
  await page.route("**/rest/v1/training_day_runs**", (route: Route) => (preflight(route) ? undefined : json(route, [])));
  await page.route("**/api/training/me**", (route: Route) => (preflight(route) ? undefined : json(route, me)));
  await page.route("**/api/training/programs/forecast**", (route: Route) =>
    preflight(route) ? undefined : json(route, { available: false }));
  await page.route("**/api/training/programs", (route: Route) =>
    preflight(route) ? undefined : json(route, { enabled: false, cellsEnabled: false, seeds: {}, catalog: [], assigned: {} }));
  await page.route(/\/api\/training\/rider-6110-\d$/, (route: Route) => {
    if (preflight(route)) return;
    const body = route.request().postDataJSON() as PlanBody;
    const riderId = route.request().url().split("/").pop() as string;
    posts.push({ riderId, ...body });
    return json(route, { ok: true, plan: { focus: "restitution", intensity: "recovery" }, slots: me.slots });
  });
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.goto("/training");
  await page.getByTestId("training-overview").waitFor();
  return posts;
}

const rows = (page: Page) => page.getByTestId("daily-decision-row");

test("flag ON: kortet staar oeverst med forslag for de traette, traetteste foerst", async ({ page }) => {
  await openTraining(page, { decisionCard: true });
  const card = page.getByTestId("daily-decision");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Today's decision");
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toContainText("Mathias Sørensen");
  await expect(rows(page).nth(0)).toContainText("Fatigue 86");
  await expect(rows(page).nth(1)).toContainText("Tom Van Aerde");
  // Over overblikket.
  const cardY = (await card.boundingBox())!.y;
  const overviewY = (await page.getByTestId("training-overview").boundingBox())!.y;
  expect(cardY).toBeLessThan(overviewY);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6110/after-desktop.png") });
});

test("Use skriver aktiv restitution for netop den rytter", async ({ page }) => {
  const posts = await openTraining(page, { decisionCard: true });
  await rows(page).nth(0).getByTestId("daily-decision-use").click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ riderId: SQUAD[0].id, dayType: "recovery", session: null });
  // Forslaget er opfyldt og forsvinder; det andet staar tilbage.
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).nth(0)).toContainText("Tom Van Aerde");
});

test("Use all skriver for alle viste forslag og kortet skrumper til en linje", async ({ page }) => {
  const posts = await openTraining(page, { decisionCard: true });
  await page.getByTestId("daily-decision-use-all").click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts.map((p) => p.riderId).sort()).toEqual([SQUAD[0].id, SQUAD[1].id].sort());
  await expect(page.getByTestId("daily-decision-none")).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
});

test("flag OFF: den gamle visning, intet kort", async ({ page }) => {
  await openTraining(page, { decisionCard: false });
  await expect(page.getByTestId("daily-decision")).toHaveCount(0);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6110/before-desktop.png") });
});

test("mobil 375: kortet staar oeverst uden vandret scroll", async ({ page }) => {
  await openTraining(page, { decisionCard: true, width: 375, height: 812 });
  await expect(page.getByTestId("daily-decision")).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6110/after-375.png") });
});

test("mobil 375 uden flag: foer-billede", async ({ page }) => {
  await openTraining(page, { decisionCard: false, width: 375, height: 812 });
  await expect(page.getByTestId("daily-decision")).toHaveCount(0);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6110/before-375.png") });
});
