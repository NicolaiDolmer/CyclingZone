import type { Locator, Page, Route } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { corsHeaders, evidenceShotPath, installNetworkMocks, json, login, RIDERS, stabilizePage, TEST_TEAM } from "./fixtures.js";

const ruler = process.env.CZ_8714_PHASE ?? "after";
const rider = RIDERS[0];
const settled = (route: Route, data: unknown) => route.request().method() === "OPTIONS"
  ? route.fulfill({ status: 204, headers: corsHeaders(route.request()) })
  : json(route, data);

async function arm(target: Locator, event: "click" | "change") {
  await target.evaluate((element, type) => {
    element.addEventListener(type, () => performance.mark("action"), { once: true });
  }, event);
}

async function elapsed(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(() => {
    const start = performance.getEntriesByName("action").at(-1)?.startTime;
    if (start == null) throw new Error("Missing initial interaction event");
    resolve(Math.round(performance.now() - start));
  })));
}

async function boot(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-25T10:00:00Z"));
  await stabilizePage(page);
  await installNetworkMocks(page);
}

async function navigate(page: Page, route: string) {
  await login(page);
  await page.addInitScript(() => localStorage.setItem("cz_lang", "en"));
  await page.goto(route);
}

test("training choice paints before acknowledgement and survives the server round trip", async ({ page, isMobile }, info) => {
  const width = isMobile ? 390 : 1440;
  await page.setViewportSize({ width, height: isMobile ? 844 : 950 });
  await boot(page);
  await page.route("**/rest/v1/riders**", (route) => settled(route, [rider]));
  await page.route("**/api/feature-flags**", (route) => settled(route, { flags: { training_page_r5: true } }));
  await page.route("**/api/training/me**", (route) => settled(route, {
    enabled: true, betaTester: true, teamId: TEST_TEAM.id, plans: {}, condition: {}, progress: {},
    slots: { used: 1 }, weekPlan: null, riderWeekPlans: {}, racingToday: {},
  }));
  await page.route("**/api/training/programs**", (route) => settled(route, { enabled: false }));
  await page.route(`**/api/training/${rider.id}`, async (route) => {
    if (route.request().method() === "OPTIONS") return settled(route, null);
    const session = route.request().postDataJSON().session;
    // Controlled transport delay, independent of the fixed in-game time.
    await new Promise((resolve) => setTimeout(resolve, 900));
    await settled(route, { plan: { focus: session, intensity: session === "endurance" ? "easy" : "hard" } });
  });
  await navigate(page, "/training");
  const picker = page.getByTestId("r5-row-training").filter({ visible: true }).locator("select").first();
  const samples = [];
  for (const choice of ["sprint", "endurance", "sprint", "endurance", "sprint"]) {
    await expect(picker).toBeEnabled();
    await arm(picker, "change");
    await picker.selectOption(choice);
    await expect(picker).toHaveValue(choice);
    samples.push(await elapsed(page));
    if (ruler === "after") await expect(picker).toBeDisabled();
    if (samples.length === 1 && process.env.CZ_8714_PHASE && info.project.name !== "mobile-webkit") {
      await picker.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: evidenceShotPath("pr-screens/8714/" + width + "-training-" + ruler + ".png"), scale: "css", animations: "disabled" });
    }
    await expect(picker).toBeEnabled();
    await expect(picker).toHaveValue(choice);
  }
  console.log("8714 " + JSON.stringify({ phase: ruler, width, action: "training", samples }));
});

test("inbox read changes are optimistic and a failed change preserves another success", async ({ page, isMobile }) => {
  const width = isMobile ? 390 : 1440;
  await page.setViewportSize({ width, height: isMobile ? 844 : 950 });
  await boot(page);
  const rows = Array.from({ length: 8 }, (_, i) => ({
    id: "note-" + i, type: "fixture", title: "Fixture note " + i, message: "", metadata: {},
    is_read: i === 7, user_id: TEST_TEAM.id, created_at: "2026-11-25T09:00:0" + i + "Z",
  }));
  let failed = false;
  await page.route("**/rest/v1/notifications**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return settled(route, null);
    if (request.method() !== "PATCH") return settled(route, rows);
    const id = new URL(request.url()).searchParams.get("id")?.replace("eq.", "");
    if (id === "note-5") {
      await new Promise((resolve) => setTimeout(resolve, 900));
      failed = true;
      return route.fulfill({ status: 400, headers: { ...corsHeaders(request), "content-type": "application/json" }, body: '{"message":"Fixture failure"}' });
    }
    const row = rows.find((item) => item.id === id);
    if (row) row.is_read = true;
    return settled(route, null);
  });
  await navigate(page, "/notifications?tab=mine&mineFilter=unread");
  const note = (i: number) => page.getByText("Fixture note " + i, { exact: true });
  const select = page.getByRole("combobox", { name: "Filter notifications" });
  const mark = [], filter = [], tab = [];
  for (let i = 0; i < 5; i++) {
    const chosen = note(i);
    await expect(chosen).toBeVisible();
    await arm(chosen, "click");
    await chosen.click();
    await expect(chosen).toHaveCount(0);
    mark.push(await elapsed(page));
  }
  await note(5).click();
  await note(6).click();
  await expect(note(6)).toHaveCount(0);
  await expect.poll(() => failed).toBe(true);
  await expect(note(5)).toBeVisible();
  if (ruler === "after") await expect(note(6)).toHaveCount(0);
  for (let i = 0; i < 5; i++) {
    const all = i % 2 === 0;
    await arm(select, "change");
    await select.selectOption(all ? "all" : "unread");
    await expect(note(7)).toHaveCount(all ? 1 : 0);
    filter.push(await elapsed(page));
  }
  for (let i = 0; i < 5; i++) {
    const next = page.getByRole("tab", { name: i % 2 === 0 ? /^To handle/ : /^Mine/ });
    await arm(next, "click");
    await next.click();
    await expect(next).toHaveAttribute("aria-selected", "true");
    tab.push(await elapsed(page));
  }
  for (const [action, samples] of [["mark-read", mark], ["filter", filter], ["tab", tab]]) {
    console.log("8714 " + JSON.stringify({ phase: ruler, width, action, samples }));
  }
});
