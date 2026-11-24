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

test("a saved selection stays a race, and overnight numbers follow completed motor updates", async ({ page, isMobile }, testInfo) => {
  const width = isMobile ? 390 : 1440;
  await page.setViewportSize({ width, height: isMobile ? 844 : 950 });
  await page.clock.setFixedTime(new Date(date + "T15:00:01Z"));
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
  let published = false;
  let forecastDate = date;
  const forecast = () => ({
    available: true, tickDate: forecastDate, riders: {
      [rider.id]: { fatigue: published ? 41 : 35, fatigueIsActual: true, band: "ok", lockMovedFrom: null,
        ...(forecastDate === date ? { fieldSource: [0, 1, 2, 3, null], raceSlots: [4], pendingSlots: [4], taken: [4] }
          : { fieldSource: [0, 1, 2, 3, 4], raceSlots: [], taken: [] }) },
    },
  });
  await page.route("**/api/training/programs/forecast", (route) => mock(route, forecast()));
  await page.route("**/api/training/programs/forecast/week", (route) => mock(route, {
    available: true, tickDate: forecastDate,
    days: [{ date: forecastDate, weekday: forecastDate === date ? "mon" : "tue", available: true, races: [], today: forecast() }],
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
  const capture = async () => {
    if (process.env.CZ_8666_SHOTS !== "1" || testInfo.project.name === "mobile-webkit") return;
    await page.screenshot({ path: evidenceShotPath("pr-screens/8666/" + width + "-after-raw.png"),
      animations: "disabled", fullPage: true, scale: "css" });
  };

  const raceField = page.getByTestId("program-r5-race").filter({ visible: true });
  await openProgram();
  await expect(raceField).toContainText("Race");
  await expect(raceField.getByRole("combobox")).toHaveCount(0);
  const stableNumber = page.getByTestId("fatigue-forecast").filter({ visible: true }).first();
  await expect(stableNumber).toContainText("35");
  await expect(page.getByText("Awaiting settlement", { exact: true })).toHaveCount(0);
  await capture();

  await page.getByRole("tab", { name: /^Today/ }).click();
  await page.getByRole("button", { name: "Sessions and details for " + rider.firstname + " " + rider.lastname }).click();
  await expect(page.getByTestId("r5-sessions").filter({ visible: true }).getByText("Race", { exact: true })).toBeVisible();
  await expect(page.getByText("Awaiting settlement", { exact: true })).toHaveCount(0);

  if (isMobile) return; // The engine regression covers the same timestamps for every screen.
  forecastDate = "2026-11-24";
  for (const at of ["2026-11-23T23:00:00Z", "2026-11-24T01:00:00Z"]) {
    await page.clock.setFixedTime(new Date(at));
    await openProgram();
    await expect(raceField).toHaveCount(0);
    await expect(stableNumber).toContainText("35");
    await expect(page.getByText("Awaiting settlement", { exact: true })).toHaveCount(0);
  }
  published = true;
  await openProgram();
  await expect(stableNumber).toContainText("41");
});
