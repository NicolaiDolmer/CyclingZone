import type { Page, Route } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { corsHeaders, evidenceShotPath, installNetworkMocks, json, login, RIDERS, stabilizePage, TEST_TEAM } from "./fixtures.js";

const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const riders = RIDERS.slice(0, 2);
const [first, second] = riders;
const passes = ["sprint", "threshold", "endurance", "tempo", "sprint", "threshold", "endurance", "tempo", "sprint", "threshold"]
  .map((session) => ({ session }));
const days = Object.fromEntries(weekdays.map((weekday) => [weekday, {
  session: "tempo", intensity: "normal", slots: ["sprint", "threshold", "endurance", "tempo", "sprint"], lockSlot: 4,
}]));

async function annotatedShot(page: Page, caption: string, path: string) {
  await page.evaluate((text) => {
    const badge = document.createElement("aside");
    badge.dataset.rotationEvidence = "true";
    window.scrollTo(0, 0);
    const top = window.innerWidth < 640 ? 118 : 88;
    badge.setAttribute("style", `position:absolute;right:10px;top:${top}px;z-index:1000;background:#18273b;color:#fff;border:1px solid #71839b;border-radius:5px;padding:6px 10px;font-family:system-ui,sans-serif;font-size:12px;font-weight:600;pointer-events:none`);
    badge.textContent = text;
    document.body.append(badge);
  }, caption);
  await page.screenshot({ path: evidenceShotPath(path), animations: "disabled", fullPage: true, scale: "css" });
  await page.locator("[data-rotation-evidence]").evaluate((badge) => badge.remove());
}

function mock(route: Route, data: unknown) {
  return route.request().method() === "OPTIONS"
    ? route.fulfill({ status: 204, headers: corsHeaders(route.request()) })
    : json(route, data);
}

test("R5 switches between week blocks and rotation and sends edits, jumps and copies", async ({ page, isMobile }, testInfo) => {
  test.setTimeout(90_000);
  const width = isMobile ? 390 : 1440;
  let on = false;
  let mode = "rotation";
  const writes: Record<string, unknown>[] = [];
  const current = { v: 1, rev: 7, passes };
  await page.setViewportSize({ width, height: isMobile ? 844 : 950 });
  await page.clock.setFixedTime(new Date("2026-11-23T10:00:00Z"));
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/riders**", (route) => mock(route, riders));
  await page.route("**/api/feature-flags**", (route) => mock(route, { flags: { training_page_r5: true }, training_page_r5: true }));
  await page.route("**/api/training/me**", (route) => mock(route, {
    enabled: true, betaTester: true, teamId: TEST_TEAM.id, effortLevels: true,
    focuses: ["sprint", "threshold", "endurance", "tempo"], intensities: ["easy", "normal", "hard", "rest"],
    plans: {}, condition: {}, progress: {}, slots: { used: 2 }, weekPlan: null,
    riderWeekPlans: { [first.id]: days, [second.id]: days }, racingToday: {},
  }));
  await page.route("**/api/training/programs", (route) => mock(route, {
    enabled: true, cellsEnabled: true,
    ...(on ? { rotationEnabled: true, weekPriorityEnabled: true, weekPriorityPlans: mode === "week" ? [first.id] : [],
      rotations: { [first.id]: { planKind: mode, rotation: current } } } : {}),
    catalog: [{ key: "fixture", name: { en: "Road base", da: "Landevej" }, tagline: { en: "Road training", da: "Landevejstræning" },
      targetTypes: [], audience: null, days: Object.fromEntries(weekdays.map((day) => [day, "tempo"])) }],
    assigned: { [first.id]: "fixture" },
  }));
  const baseForecast = { fatigue: 35, band: "ok", raceSlots: [4] };
  const forecast = {
    ...baseForecast,
    rotationSlots: [{ index: 6, length: 10, session: "endurance" }, null, { index: 7, length: 10, session: "tempo" }],
    restSlots: [], nextRotationIndex: 8,
  };
  await page.route("**/api/training/programs/forecast", (route) => mock(route, {
    available: true, tickDate: "2026-11-23", riders: {
      [first.id]: on && mode === "week"
        ? { ...baseForecast, fieldSource: [0, 1, null, 4, null], taken: [3], lockMovedFrom: 4, restSlots: [2] }
        : on ? forecast : baseForecast,
      [second.id]: baseForecast,
    },
  }));
  await page.route("**/api/training/programs/forecast/week", (route) => mock(route, {
    available: true, days: weekdays.map((weekday, index) => ({
      date: `2026-11-${23 + index}`, weekday, available: true, races: [],
      riders: { [first.id]: on && mode === "rotation" ? forecast : baseForecast, [second.id]: baseForecast },
    })),
  }));
  await page.route("**/api/training/programs/rotation", (route) => {
    if (route.request().method() === "PUT") {
      const write = route.request().postDataJSON();
      if (write.riderId === first.id) mode = write.planKind;
      writes.push(write);
    }
    return mock(route, { ok: true });
  });
  await page.route("**/api/training/programs/cell", (route) => {
    if (route.request().method() === "PUT") {
      const write = route.request().postDataJSON();
      if (write.riderId === first.id) mode = write.planKind;
      writes.push(write);
    }
    return mock(route, { ok: true });
  });
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  const screenshot = testInfo.project.name !== "mobile-chromium";
  if (screenshot) {
    await page.goto("/training");
    await expect(page.getByTestId("r5-row").first()).toBeVisible();
    await annotatedShot(page, "Before · Today: regular schedule", `pr-screens/8548/${width}-today-before.png`);
  }
  const open = async () => {
    await page.goto("/training");
    await page.getByRole("tab", { name: "Program", exact: true }).click();
    await expect(page.getByTestId("program-r5")).toBeVisible();
    if (isMobile) await page.getByTestId("program-r5-change").click();
    await page.getByTestId("program-r5-catalog").getByText("Road base", { exact: true }).click();
  };
  await open();
  expect(writes).toEqual([]);
  await expect(page.getByRole("button", { name: "Rotation", exact: true })).toHaveCount(0);
  if (screenshot) await annotatedShot(page, "Before · Week blocks", `pr-screens/8548/${width}-before.png`);

  on = true;
  await open();
  await expect(page.getByTestId("program-r5-week-priority")).toBeVisible();
  await expect(page.getByTestId("program-r5-races-took")).toContainText("Races took");
  await page.getByTestId("program-r5-week-priority").getByRole("button", { name: "Raise priority of field 2" }).click();
  const copyDay = page.getByTestId("program-r5-copy-day").first();
  if (isMobile) await copyDay.selectOption("tue");
  else {
    await copyDay.click();
    await page.getByRole("menuitem", { name: /^Tue/ }).click();
  }
  await page.getByRole("button", { name: "Lock field 5" }).click();
  await page.getByTestId("program-r5-save").click();
  await expect.poll(() => writes.some((write) => write.planKind === "week" && !!write.weekBlock)).toBe(true);
  await expect.poll(() => writes.some((write) => write.weekday === "tue" && write.slotIndex === 0 && write.session === "threshold")).toBe(true);
  await expect(page.getByTestId("program-r5-save")).toBeDisabled();
  await expect(page.getByTestId("program-r5-races-took")).toContainText("Tempo");
  await expect(page.getByTestId("program-r5-lock-moved")).toContainText("RD 5");
  await expect(page.getByTestId("program-r5-week-rest")).toContainText("Rest");
  if (screenshot) await annotatedShot(page, "After · Week blocks: priority and locked pass", `pr-screens/8548/${width}-week-blocks.png`);

  await page.getByRole("button", { name: "Rotation", exact: true }).click();
  await expect(page.getByTestId("program-r5-rotation")).toBeVisible();
  await page.getByTestId("program-r5-save").click();
  await expect(page.getByTestId("program-r5-save")).toBeDisabled();
  await expect(page.getByTestId("program-r5-rotation-index").filter({ hasText: "7/10" }).first()).toBeVisible();
  if (screenshot) await annotatedShot(page, "After · Rotation: pass order and weekly position", `pr-screens/8548/${width}-rotation.png`);
  await expect(page.getByTestId("program-r5-rotation").locator('option[value="rest"]').first()).toBeAttached();
  await page.getByRole("button", { name: "Move pass 2 up" }).click();
  await expect(page.getByTestId("program-r5-discard")).toBeVisible();
  if (screenshot) await annotatedShot(page, "After · Rotation: discard a draft", `pr-screens/8548/${width}-rotation-discard.png`);
  await page.getByTestId("program-r5-discard").click();
  await page.getByTestId("program-r5-discard-go").click();
  await expect(page.getByTestId("program-r5-save")).toBeDisabled();
  await page.getByRole("button", { name: "Move pass 2 up" }).click();
  await page.getByRole("button", { name: "Add pass", exact: true }).click();
  await page.getByRole("button", { name: "Remove pass 11" }).click();
  await page.getByRole("combobox", { name: "Jump to pass" }).selectOption("2");
  await page.getByTestId("program-r5-save").click();
  await expect.poll(() => writes.some((write) => write.startIndex === 2 && write.planKind === "rotation")).toBe(true);

  await page.getByTestId("program-r5-copy").click();
  await page.getByRole("checkbox", { name: "Start from pass 1" }).check();
  await page.getByRole("checkbox", { name: `${second.firstname} ${second.lastname}` }).check();
  await page.getByTestId("program-r5-copy-go").click();
  expect(writes.some((write) => write.riderId === second.id && write.keepPlace === false)).toBe(false);
  await page.getByTestId("program-r5-copy-confirm").click();
  await expect.poll(() => writes.some((write) => write.riderId === second.id && write.keepPlace === false)).toBe(true);

  await page.getByRole("tab", { name: /^Today/ }).click();
  const rotationRow = page.getByTestId("r5-row").filter({ hasText: first.lastname }).first();
  await expect(rotationRow.getByTestId("r5-row-training").locator("option:checked")).toHaveText("Long ride");
  await expect(rotationRow).not.toContainText("7/10");
  if (screenshot) await annotatedShot(page, "After · Today: rotation session", `pr-screens/8548/${width}-today-rotation.png`);
});
