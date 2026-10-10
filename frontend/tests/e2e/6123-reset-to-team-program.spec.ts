// #6123 — "Back to team program" paa Today-raekken (desktop + telefon).
//
// Guarden holder paa det designet LOVER:
//   1) Handlingen findes KUN paa ryttere med egen plan/override.
//   2) Et tryk kalder begge DELETE-lag, ugeplan-override foerst, saa egen dag.
//   3) Kvitteringen staar i raekken, og knappen er vaek bagefter.
//   4) Efter Train now er handlingen slaaet fra (samme laas som dagsvaelgeren).
//   5) En afvist nulstilling viser fejlen i raekken.
// Testene saetter selv viewport, saa alle tre Playwright-projekter koerer de
// samme assertions. API'et er mocket (ingen prod-data); navnene er opdigtede.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS, evidenceShotPath } from "./fixtures.js";
import type { Page } from "@playwright/test";

const base = RIDERS.find((r: { id: string }) => r.id === "rider-1");
if (!base) throw new Error("fixtures.js: rider-1 mangler i RIDERS");

const NAMES: Array<[string, string, string]> = [
  ["own-both", "Mathias", "Sorensen"], // egen ugeplan + egen dag
  ["own-week", "Tom", "Van Aerde"], // kun ugeplan-override
  ["own-plan", "Luca", "Colombo"], // kun egen dag
  ["team", "Rafael", "Duran"], // foelger holdet
];
const SQUAD = NAMES.map(([key, firstname, lastname], i) => ({
  ...base,
  id: `rider-6123-${key}`,
  firstname,
  lastname,
  team_id: TEST_TEAM.id,
  primary_type: ["sprinter", "climber", "rouleur", "puncheur"][i],
  is_academy: false,
}));
const id = (key: string) => `rider-6123-${key}`;
const WEEK = { mon: { intensity: "hard" }, tue: { intensity: "easy" } };

function trainingMe({ locked = false } = {}) {
  const plans: Record<string, { focus: string; intensity: string }> = {
    [id("own-both")]: { focus: "threshold", intensity: "hard" },
    [id("own-plan")]: { focus: "endurance", intensity: "normal" },
  };
  const condition: Record<string, unknown> = {};
  for (const r of SQUAD) condition[r.id] = { form: 60, fatigue: 30, injured_until: null, risk: 0 };
  return {
    enabled: true,
    betaTester: true,
    mobileTable: true,
    teamId: TEST_TEAM.id,
    slots: { total: null, used: 2, remaining: null },
    focuses: ["threshold", "endurance"],
    intensities: ["easy", "normal", "hard", "rest"],
    plans,
    condition,
    progress: {},
    capped: {},
    trainability: {},
    smartDefaultFocus: {},
    weekPlan: null,
    riderWeekPlans: { [id("own-both")]: WEEK, [id("own-week")]: WEEK },
    racingToday: {},
    todayRun: locked
      ? { tick_date: "2026-10-10", created_at: "2026-10-10T18:00:00Z", executed_by: "you", bonus_applied: false, report: { riders: [] } }
      : null,
  };
}

async function mockSquad(page: Page, me: ReturnType<typeof trainingMe>, deletes: string[], failPlan = false) {
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, SQUAD);
  });
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, me);
  });
  await page.route("**/api/training/week-plan/rider-6123-*", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() === "DELETE") deletes.push(`week:${request.url().split("/").pop()}`);
    return json(route, { ok: true, days: null });
  });
  await page.route("**/api/training/rider-6123-*", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() === "DELETE") {
      deletes.push(`plan:${request.url().split("/").pop()}`);
      if (failPlan) return json(route, { error: "train_now_locked" }, 409);
      return json(route, { ok: true, plan: null, slots: { total: null, used: 1, remaining: null } });
    }
    return json(route, { ok: true });
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

async function openTraining(page: Page, width: number, height: number, me = trainingMe(), failPlan = false) {
  const deletes: string[] = [];
  await mockSquad(page, me, deletes, failPlan);
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.setViewportSize({ width, height });
  await page.goto("/training");
  await page.getByTestId("training-reset-program").first().waitFor();
  return deletes;
}

const resetButton = (page: Page, name: string) => page.getByRole("button", { name: `Put ${name} back on the team program` });

test("desktop: handlingen findes kun paa ryttere med egen plan, og et tryk fjerner begge lag", async ({ page }) => {
  const deletes = await openTraining(page, 1440, 900);
  await expect(resetButton(page, "Mathias Sorensen")).toBeVisible();
  await expect(resetButton(page, "Tom Van Aerde")).toBeVisible();
  await expect(resetButton(page, "Luca Colombo")).toBeVisible();
  await expect(resetButton(page, "Rafael Duran")).toHaveCount(0);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6123/after-desktop-1440.png") });

  await resetButton(page, "Mathias Sorensen").click();
  await expect(page.getByTestId("training-today-row").first().getByRole("status")).toContainText("Back on team program");
  await expect(resetButton(page, "Mathias Sorensen")).toHaveCount(0);
  expect(deletes).toEqual([`week:${id("own-both")}`, `plan:${id("own-both")}`]);
});

test("desktop: kun det lag rytteren har, kaldes", async ({ page }) => {
  const deletes = await openTraining(page, 1440, 900);
  await resetButton(page, "Tom Van Aerde").click();
  await expect(resetButton(page, "Tom Van Aerde")).toHaveCount(0);
  expect(deletes).toEqual([`week:${id("own-week")}`]);
  await resetButton(page, "Luca Colombo").click();
  await expect(resetButton(page, "Luca Colombo")).toHaveCount(0);
  expect(deletes).toEqual([`week:${id("own-week")}`, `plan:${id("own-plan")}`]);
});

test("desktop: efter Train now er handlingen slaaet fra", async ({ page }) => {
  await openTraining(page, 1440, 900, trainingMe({ locked: true }));
  await expect(resetButton(page, "Mathias Sorensen")).toBeDisabled();
});

test("desktop: en afvist nulstilling viser fejlen i raekken", async ({ page }) => {
  await openTraining(page, 1440, 900, trainingMe(), true);
  await resetButton(page, "Luca Colombo").click();
  await expect(page.getByTestId("training-reset-error")).toContainText(/locked/i);
  await expect(resetButton(page, "Luca Colombo")).toBeVisible();
});

test("mobil 390: handlingen staar i raekken, uden vandret scroll", async ({ page }) => {
  const deletes = await openTraining(page, 390, 844);
  await expect(resetButton(page, "Mathias Sorensen")).toBeVisible();
  await expect(resetButton(page, "Rafael Duran")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await resetButton(page, "Mathias Sorensen").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6123/after-mobile-390.png") });

  await resetButton(page, "Mathias Sorensen").click();
  await expect(page.getByTestId("training-onetap-row").first().getByRole("status")).toContainText("Back on team program");
  expect(deletes).toEqual([`week:${id("own-both")}`, `plan:${id("own-both")}`]);
});
