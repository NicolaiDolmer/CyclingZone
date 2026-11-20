import type { Page } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { evidenceShotPath, installNetworkMocks, json, login, raceResultsRoute, stabilizePage } from "./fixtures.js";
import type { StagePlanLeg } from "../../src/components/race/StagePlanModel.ts";

const RACE_ID = "00000000-0000-4000-8000-000000008356";
const before = process.env.CZ_8356_BEFORE === "1";
const shots = process.env.CZ_8356_SHOTS === "1";
const riders = [
  { rider_id: "r1", name: "Ada Pedersen", race_role: "captain", nationality_code: "dk", rating: 61, form: 82, fatigue: 26 },
  { rider_id: "r2", name: "Mikkel Hansen", race_role: "helper", nationality_code: "nl", rating: 58, form: 77, fatigue: 33 },
  { rider_id: "r3", name: "Pavel Novak", race_role: "hunter", nationality_code: "fr", rating: 56, form: 79, fatigue: 30 },
];
const initialPlans: StagePlanLeg[][] = [
  [{ task: "stay_sheltered" }, { task: "ride_in", from: { at: "final_km" } }],
  [{ task: "shelter_leader" }, { task: "grupetto", from: { at: "dropped" } }],
  [{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }],
];
const hardTasks = ["follow_moves", "tempo", "attack"];
const hardLabels = ["Følg angrebene", "Kør tempo", "Angrib"];

async function openRoadTactics(page: Page, plans = initialPlans) {
  const race = {
    id: RACE_ID, name: "E2E Tour", race_type: "stage_race", race_class: "Class2",
    stages: 2, stages_completed: 1, edition_year: 2026, status: "scheduled",
    engine_rules_revision: "s5_profiles_v3", season: { id: "season-e2e", number: 1 },
  };
  const saved: { stage: number; riders: { rider_id: string; plan: StagePlanLeg[] }[] }[] = [];
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.clock.setFixedTime(new Date("2026-11-18T16:00:00Z"));
  await page.route("**/api/feature-flags", route => json(route, { flags: { race_page_v6: true } }));
  await page.route("**/rest/v1/races**", route => json(route,
    route.request().headers().accept?.includes("vnd.pgrst.object") ? race : [race]));
  await page.route("**/rest/v1/race_results**", raceResultsRoute([]));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, [1, 2].map(stage_number => ({
    stage_number, profile_type: "hilly", distance_km: 165, elevation_gain_m: 920, climbs: [], sprints: [], sectors: [],
  }))));
  await page.route("**/rest/v1/race_stage_schedule**", route => json(route, []));
  await page.route("**/api/races/" + RACE_ID + "/stage-roles", route => json(route, {
    enabled: true, intention_enabled: true, stages_completed: 1, stage_count: 2, riders, overrides: [],
  }));
  await page.route("**/api/races/" + RACE_ID + "/team-orders**", route => {
    if (route.request().method() === "PUT") {
      const stage = Number(new URL(route.request().url()).pathname.split("/").pop());
      saved.push({ stage, riders: route.request().postDataJSON()?.riders ?? [] });
      return json(route, { ok: true });
    }
    return json(route, {
      stages_completed: 1, stage_count: 2, riders, stage_plan_enabled: true,
      stages: [{ stage_number: 1, locked: true }, { stage_number: 2, locked: false }],
      orders: [{ stage_number: 2, breakaway_stance: "neutral", riders: riders.map((r, i) => ({
        rider_id: r.rider_id, effort: "normal", try_break: i === 2, leadout: false, plan: plans[i],
      })) }],
    });
  });
  const width = (page.viewportSize()?.width ?? 1280) < 768 ? 390 : 1440;
  if (shots) await page.setViewportSize({ width, height: 900 });
  await login(page);
  await page.goto("/races/" + RACE_ID + "?stage=2&tab=tactics");
  const panel = page.locator('[data-race-page-version="v6"]').getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return { panel, saved, width };
}

test("v6c road shortcuts apply the stated role tasks and save through team-orders", async ({ page }) => {
  const { panel, saved, width } = await openRoadTactics(page);
  for (const [i, rider] of riders.entries()) {
    const row = panel.locator('[data-tactics-rider="' + rider.rider_id + '"]').filter({ visible: true });
    if (width === 390) await row.locator("button[aria-expanded]").first().click();
    const group = row.getByRole("group", { name: /Indsats for/ });
    await expect(group).toBeVisible();
    if (shots && before) {
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: evidenceShotPath("pr-screens/8356/before-" + rider.race_role + "-" + width + ".png"), scale: "css" });
    }
    if (before) continue;


    const hard = group.getByRole("button", { name: new RegExp("^Hård.*" + hardLabels[i]) });
    await expect(hard).toBeEnabled();
    await expect(group.getByRole("button", { name: /^Normal\b/ })).toBeVisible();
    await hard.click();
    await expect(hard).toHaveAttribute("aria-pressed", "true");
    expect(saved).toHaveLength(0);
    if (shots) {
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: evidenceShotPath("pr-screens/8356/after-" + rider.race_role + "-" + width + ".png"), scale: "css" });
    }
  }
  if (before) return;
  await panel.getByRole("button", { name: "Gem etape 2", exact: true }).filter({ visible: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].stage).toBe(2);
  for (const [i, rider] of riders.entries()) {
    expect(saved[0].riders.find((r) => r.rider_id === rider.rider_id)?.plan).toEqual([
      { task: hardTasks[i] }, initialPlans[i][1],
    ]);
  }
});


test("the road shortcuts merge redundant legs, leave mixed plans unselected and explain invalid choices", async ({ page }) => {
  test.skip(before);
  const mixed: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }];
  const helpers: StagePlanLeg[] = [
    { task: "shelter_leader" },
    { task: "tempo", from: { at: "final_km" } },
    { task: "grupetto", from: { at: "dropped" } },
  ];
  const train: StagePlanLeg[] = [{ task: "shelter_leader" }, { task: "sprint_train", from: { at: "final_km" } }];
  const { panel, saved, width } = await openRoadTactics(page, [mixed, helpers, train]);
  const groupFor = async (id: string) => {
    const row = panel.locator("[data-tactics-rider=" + id + "]").filter({ visible: true });
    if (width === 390) await row.locator("button[aria-expanded]").first().click();
    return row.getByRole("group", { name: /Indsats for/ });
  };
  const captain = await groupFor("r1");
  await expect(captain.getByRole("button", { pressed: true })).toHaveCount(0);
  const helper = await groupFor("r2");
  await helper.getByRole("button", { name: /^Hård.*Kør tempo/ }).click();
  const hunter = await groupFor("r3");
  const invalid = hunter.getByRole("button", { name: /^Normal.*Gå i udbrud/ });
  await expect(invalid).toBeDisabled();
  await expect(invalid).toHaveAttribute("title", /kan ikke trække spurten/);
  await panel.getByRole("button", { name: "Gem etape 2", exact: true }).filter({ visible: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].riders.find(r => r.rider_id === "r2")?.plan).toEqual([{ task: "tempo" }, helpers[2]]);
});

test.describe("captain's day", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("shows the opening and finale after picking Hard", async ({ page, isMobile }) => {
    if (isMobile) await page.setViewportSize({ width: 390, height: 900 });
    const { panel, width } = await openRoadTactics(page);
    const captain = panel.locator('[data-tactics-rider="r1"]').filter({ visible: true });
    if (width === 390) await captain.locator("button[aria-expanded]").first().click();
    const group = captain.getByRole("group", { name: /Indsats for/ });
    await group.getByRole("button", { name: /^Hård.*Følg angrebene/ }).click();

    if (shots && page.context().browser()?.browserType().name() === "chromium") {
      await captain.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.screenshot({
        path: evidenceShotPath(`pr-screens/8415/${before ? "before" : "after"}-${width}.png`),
        scale: "css",
      });
    }

    if (width === 1440) {
      const shelter = group.getByText("Bliv i læ", { exact: true });
      const lineCount = await shelter.evaluate(label => {
        const range = document.createRange();
        range.selectNodeContents(label);
        return range.getClientRects().length;
      });
      expect.soft(lineCount).toBe(1);
      await expect(captain.getByRole("cell", { name: "Følger de bedste · Kører roligt i mål" })).toBeVisible();
    } else {
      await expect(captain.locator("button[aria-expanded]").first()).toContainText("Følg");
      await expect(captain.locator("button[aria-expanded]").first()).toContainText("Kør ind");
    }
  });
});
