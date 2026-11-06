// #7715 (ejer 5/11): varslet som lille mærke på taktik og udtagelse, ingen indbakke. Serveren
// sender kun et ja. Mærket forsvinder med spillerens udvej, og efter etapen står forklaringen
// samme sted. Billederne går til PR-review.
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, evidenceShotPath, json, corsHeaders, raceResultsRoute } from "./fixtures.js";

const RACE_ID = "00000000-0000-4000-8000-000000007715";
const FIVE_STEPS = ["grupetto", "save", "normal", "protect", "all_out"];
const visible = (locator: Locator) => locator.filter({ visible: true }).first();

const race = (stagesCompleted: number) => ({
  id: RACE_ID, name: "E2E Mountain Tour", race_type: "stage_race", race_class: "OtherWorldTourA", stages: 3,
  stages_completed: stagesCompleted, edition_year: 2026, status: "scheduled", season: { id: "season-e2e", number: 1 }, pool_race: null,
});

const RIDERS = [
  { rider_id: "r1", name: "Rider One", race_role: "captain", abandoned: false, stage_fit: { 1: 70, 2: 72, 3: 74 } },
  { rider_id: "r2", name: "Rider Two", race_role: "helper", abandoned: false, stage_fit: { 1: 60, 2: 31, 3: 33 }, fatigue: 78, time_limit_risk: { 2: true } },
  { rider_id: "r3", name: "Rider Three", race_role: "helper", abandoned: true, stage_fit: { 1: 28, 2: 30, 3: 32 }, time_limit_out_stage: 1 },
];

async function mockRace(page: Page, currentRace: ReturnType<typeof race>) {
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? currentRace : [currentRace]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute([]));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, []));
}

test("taktik: mærket før etapen, væk med Grupetto, og forklaringen efter etapen", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockRace(page, race(1));
  await page.route(`**/api/races/${RACE_ID}/stage-roles`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({
      status: 200, contentType: "application/json", headers: corsHeaders(request),
      body: JSON.stringify({ enabled: true, intention_enabled: true, valid_efforts: FIVE_STEPS, stages_completed: 1, stage_count: 3, riders: RIDERS, overrides: [] }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);
  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();

  const mark = visible(panel.getByTestId("time-limit-risk"));
  await expect(mark).toBeVisible();
  await expect(mark).toContainText("Tidsgrænse i fare");
  await expect(panel.getByTestId("time-limit-risk").filter({ visible: true })).toHaveCount(1);

  await mark.getByRole("button").click();
  await expect(mark).toContainText("Meget træt, og etapen passer ham dårligt.");
  await expect(mark).not.toContainText(/\d/);
  await panel.screenshot({ path: evidenceShotPath(`pr-screens/7715-tactics-mark-${testInfo.project.name}.png`) });

  const row = visible(panel.locator("tr, li").filter({ hasText: "Rider Two" }));
  await row.getByRole("button", { name: "Sæt intention" }).click();
  await visible(panel.getByRole("button", { name: /^Grupetto/ })).click();
  await expect(panel.getByTestId("time-limit-risk").filter({ visible: true })).toHaveCount(0);

  await visible(panel.getByRole("button", { name: "Intentioner for etape 1", exact: true })).click();
  const out = visible(panel.getByTestId("time-limit-out"));
  await expect(out).toContainText("For træt");
  await out.getByRole("button").click();
  await expect(out).toContainText("Uden for tidsgrænsen.");
  await panel.screenshot({ path: evidenceShotPath(`pr-screens/7715-tactics-out-${testInfo.project.name}.png`) });
});

test("taktik: uden felterne fra serveren (kontakten slukket) er der intet mærke", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockRace(page, race(1));
  const plain = RIDERS.map(({ time_limit_risk: _risk, time_limit_out_stage: _out, ...rest }) => rest);
  await page.route(`**/api/races/${RACE_ID}/stage-roles`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({
      status: 200, contentType: "application/json", headers: corsHeaders(request),
      body: JSON.stringify({ enabled: true, intention_enabled: true, valid_efforts: FIVE_STEPS, stages_completed: 1, stage_count: 3, riders: plain, overrides: [] }),
    });
  });
  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);
  await expect(page.getByTestId("race-tactics-tab")).toBeVisible();
  await expect(page.getByTestId("time-limit-risk")).toHaveCount(0);
});

test("udtagelsen: mærket står på rytteren", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const scheduled = race(0);
  await mockRace(page, scheduled);
  const riders = Array.from({ length: 8 }, (_, i) => ({
    id: `sel-r${i}`, name: `Rider ${i}`, suitability: 70 - i, form: 55, fatigue: i === 2 ? 78 : 10, injured: false,
    ...(i === 2 ? { stageTimeLimitRisk: [true, false, false] } : {}),
  }));
  await page.route(`**/api/races/${RACE_ID}/selection`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({
      status: 200, contentType: "application/json", headers: corsHeaders(request),
      body: JSON.stringify({ enabled: true, race: scheduled, size: { min: 6, max: 8 }, selection: null, riders, availableCount: 8 }),
    });
  });
  await login(page);
  await page.goto(`/races/${RACE_ID}`);
  await page.getByRole("tab", { name: "Hold" }).click();
  const panel = page.getByTestId("race-selection-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("time-limit-risk").filter({ visible: true })).toHaveCount(1);
  await panel.screenshot({ path: evidenceShotPath(`pr-screens/7715-selection-mark-${testInfo.project.name}.png`) });
});
