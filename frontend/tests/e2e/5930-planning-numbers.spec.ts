import { mkdir } from "node:fs/promises";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, corsHeaders } from "./fixtures.js";

// A locked stage-race row used to omit current form altogether. Exercise the
// real board with API fixtures, including measured zero and unavailable data.
const riders = [
  { id: "unknown", name: "P. Jensen", suitability: null, form: null, fatigue: null, injured: false },
  { id: "zero", name: "L. Andersen", suitability: 0, form: 0, fatigue: 0, injured: false },
  { id: "known", name: "M. Sørensen", suitability: 78, form: 62, fatigue: 10, injured: false },
];
const selection = { rider_ids: riders.map(r => r.id), captain_id: "known", sprint_captain_id: null, hunter_id: null, free_role_ids: [], is_auto_filled: false };
const distribution = {
  enabled: true, race_v3_enabled: false, season: { id: "s1", number: 1 }, currentDay: 1, focusDay: 1,
  timeline: { totalDays: 1, currentDay: 1, days: [{ day: 1, dateText: "30 Sep", terrain: "flat", hasMyRace: true }] },
  columns: [
    { id: "locked-stage", name: "La Course au Soleil", race_class: "OtherWorldTourA", race_type: "stage_race", stages: 8, stages_completed: 1,
      status: "scheduled", lineup_locked: true, window: { start: 1, end: 1 }, bindingWindow: { start: 1, end: 1 }, game_day: 1, game_day_end: 8,
      size: { min: 6, max: 8 }, withdrawn: false, counts: { selected: 3, target: 8 }, riders, selection },
    { id: "editable-one-day", name: "Hamburger Klassiker", race_class: "ProSeries", race_type: "single", stages: 1, stages_completed: 0,
      status: "scheduled", lineup_locked: false, window: { start: 2, end: 2 }, bindingWindow: { start: 2, end: 2 }, game_day: 9, game_day_end: 9,
      size: { min: 6, max: 6 }, withdrawn: false, counts: { selected: 3, target: 6 }, riders, selection },
  ], bindingMap: {},
};

for (const language of ["en", "da"]) {
  test(`planning numbers stay readable in locked and editable rows (${language})`, async ({ page }, testInfo) => {
    await stabilizePage(page);
    await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
    await installNetworkMocks(page);
    await page.route("**/api/races/distribution**", route => {
      const request = route.request();
      return route.fulfill({ status: request.method() === "OPTIONS" ? 204 : 200, contentType: "application/json",
        headers: corsHeaders(request), body: request.method() === "OPTIONS" ? undefined : JSON.stringify(distribution) });
    });
    await login(page);
    await page.goto("/planning?tab=selection&view=day");
    const board = page.getByTestId("race-hub-board");
    await expect(board).toBeVisible();
    if (language === "en") {
      await page.evaluate(async () => {
        const i18n = (window as typeof window & { __i18n: { changeLanguage: (language: string) => Promise<unknown> } }).__i18n;
        await i18n.changeLanguage("en");
      });
    }
    await expect(page.locator("#race-col-locked-stage").getByText(/M\. Sørensen/)).toBeVisible();
    if (process.env.PLANNING_SCREEN_PHASE) {
      await mkdir("pr-screens/5930", { recursive: true });
      await page.screenshot({ path: `pr-screens/5930/${process.env.PLANNING_SCREEN_PHASE}-${language}-${testInfo.project.name}.png`, fullPage: true });
      await page.locator("#race-col-locked-stage").screenshot({
        path: `pr-screens/5930/${process.env.PLANNING_SCREEN_PHASE}-card-${language}-${testInfo.project.name}.png`,
      });
    }
    const labels = language === "da"
      ? { fit: "Rute-match", form: "Form nu", explanation: /gennemsnit.*etaperne/, current: /aktuel form.*ikke en prognose/, unknown: /streg.*ukendt/ }
      : { fit: "Route match", form: "Current form", explanation: /average.*stages/, current: /today's form.*not a forecast/, unknown: /dash.*unavailable/ };
    for (const id of ["locked-stage", "editable-one-day"]) {
      const column = page.locator(`#race-col-${id}`);
      await expect(column.getByTestId("race-number-headings")).toContainText(labels.fit);
      await expect(column.getByTestId("race-number-headings")).toContainText(labels.form);
      await expect(column.getByTestId("race-number-headings")).toContainText(language === "da" ? "Ordre" : "Order");
      await expect(column.getByTestId("race-rider-name")).toHaveText(["P. Jensen", "L. Andersen", "M. Sørensen"]);
      await expect(column.getByTestId("race-rider-order").nth(2)).toContainText(language === "da" ? "Kaptajn" : "Captain");
      await expect(column.getByTestId("race-rider-order").first()).toContainText(language === "da" ? "Hjælper" : "Domestique");
      const names = column.getByTestId("race-rider-name");
      const orders = column.getByTestId("race-rider-order");
      const nameBox = await names.nth(2).boundingBox();
      const orderBox = await orders.nth(2).boundingBox();
      expect(orderBox!.x).toBeGreaterThanOrEqual(nameBox!.x + nameBox!.width);
      expect(Math.abs((orderBox!.y + orderBox!.height / 2) - (nameBox!.y + nameBox!.height / 2))).toBeLessThan(1);
      await expect(column.getByTestId("race-number-explanation")).toBeVisible();
      await expect(column.getByTestId("race-number-explanation")).toContainText(labels.explanation);
      await expect(column.getByTestId("race-number-explanation")).toContainText(labels.current);
      await expect(column.getByTestId("race-number-explanation")).toContainText(labels.unknown);
      const values = column.getByTestId("race-rider-form");
      await expect(values).toHaveText(["—", "0", "62"]);
      const matches = column.getByTestId("race-rider-match");
      await expect(matches).toHaveText(["—", "0", "78"]);
      // Numeric columns retain space even when the first value is unknown.
      const boxes = await values.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().right));
      expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(1);
      const overflow = await column.evaluate(node => node.scrollWidth - node.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
    const editable = page.locator("#race-col-editable-one-day");
    await editable.getByTestId("race-rider-order").nth(2).click();
    await editable.getByRole("button", { name: language === "da" ? /Sprint-kaptajn/ : /Sprint captain/ }).click();
    await expect(editable.getByTestId("race-rider-order").nth(2)).toContainText(language === "da" ? "Sprint-kaptajn" : "Sprint captain");
    await page.setViewportSize({ width: 320, height: 844 });
    const narrowOverflow = await editable.evaluate(node => node.scrollWidth - node.clientWidth);
    expect(narrowOverflow).toBeLessThanOrEqual(1);
    const orderTextFits = await editable.getByTestId("race-rider-order").nth(2).evaluate(node => node.scrollWidth <= node.clientWidth);
    expect(orderTextFits).toBe(true);
  });
}
