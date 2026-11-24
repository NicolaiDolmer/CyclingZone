import type { Route } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { corsHeaders, evidenceShotPath, installNetworkMocks, json, login, RIDERS, stabilizePage, TEST_TEAM } from "./fixtures.js";

const rider = RIDERS[0];
const date = "2026-11-23";
const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const plan = Object.fromEntries(weekdays.map((day) => [day, {
  session: "tempo", intensity: "normal", slots: ["sprint", "threshold", "endurance", "tempo", "sprint"], lockSlot: 4,
}]));

function mock(route: Route, data: unknown) {
  return route.request().method() === "OPTIONS"
    ? route.fulfill({ status: 204, headers: corsHeaders(route.request()) })
    : json(route, data);
}

test("an overdue stage shows awaiting settlement in the week-block forecast", async ({ page, isMobile }, testInfo) => {
  const width = isMobile ? 390 : 1440;
  await page.setViewportSize({ width, height: isMobile ? 844 : 950 });
  await page.clock.setFixedTime(new Date(date + "T14:59:59Z"));
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/riders**", (route) => mock(route, [rider]));
  await page.route("**/api/feature-flags**", (route) => mock(route, { flags: { training_page_r5: true } }));
  await page.route("**/api/training/me**", (route) => mock(route, {
    enabled: true, betaTester: true, teamId: TEST_TEAM.id, plans: {}, condition: {}, progress: {},
    slots: { used: 1 }, weekPlan: null, riderWeekPlans: { [rider.id]: plan }, racingToday: {},
  }));
  await page.route("**/api/training/programs", (route) => mock(route, {
    enabled: true, cellsEnabled: true, weekPriorityEnabled: true, weekPriorityPlans: [rider.id],
    assigned: { [rider.id]: "fixture" },
    catalog: [{ key: "fixture", name: { en: "Road base", da: "Landevej" },
      tagline: { en: "Road training", da: "Landevejstræning" }, targetTypes: [], audience: null,
      days: Object.fromEntries(weekdays.map((day) => [day, "tempo"])) }],
  }));
  let overdue = false;
  const forecast = () => ({
    available: true, tickDate: date, riders: {
      [rider.id]: { fatigue: 35, band: "ok", lockMovedFrom: null,
        ...(overdue ? { fieldSource: [0, 1, 2, 3, null], raceSlots: [4], pendingSlots: [4], taken: [4] }
          : { fieldSource: [0, 1, 2, 3, 4], raceSlots: [], taken: [] }) },
    },
  });
  await page.route("**/api/training/programs/forecast", (route) => mock(route, forecast()));
  await page.route("**/api/training/programs/forecast/week", (route) => mock(route, {
    available: true, days: [{ date, weekday: "mon", available: true, races: [], today: forecast() }],
  }));
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));

  const openProgram = async () => {
    await page.goto("/training");
    await page.getByRole("tab", { name: "Program", exact: true }).click();
    await expect(page.getByTestId("program-r5")).toBeVisible();
    if (isMobile) await page.getByTestId("program-r5-change").click();
    await page.getByTestId("program-r5-catalog").getByText("Road base", { exact: true }).click();
    await expect(page.getByTestId("program-r5-week-priority")).toBeVisible();
  };
  const capture = async (state: "before" | "after") => {
    if (process.env.CZ_8646_SHOTS !== "1" || testInfo.project.name === "mobile-webkit") return;
    await page.screenshot({ path: evidenceShotPath("pr-screens/8646/" + width + "-" + state + "-raw.png"),
      animations: "disabled", fullPage: true, scale: "css" });
  };

  await openProgram();
  const pending = page.getByTestId("program-r5-pending");
  await expect(pending).toHaveCount(0);
  await capture("before");
  overdue = true;
  await page.clock.setFixedTime(new Date(date + "T15:00:01Z"));
  await openProgram();
  await expect(pending).toHaveText(/Awaiting settlement/);
  await expect(pending.getByRole("combobox")).toHaveCount(0);
  await capture("after");

  await page.getByRole("tab", { name: /^Today/ }).click();
  await page.getByRole("button", { name: "Sessions and details for " + rider.firstname + " " + rider.lastname }).click();
  await expect(page.getByTestId("r5-session-pending")).toHaveText("Awaiting settlement");
});
