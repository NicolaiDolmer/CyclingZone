import type { Page } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { evidenceShotPath, installNetworkMocks, json, login, raceResultsRoute, stabilizePage, TEST_TEAM } from "./fixtures.js";

const RACE_ID = "race-e2e-8409";
const fixedNow = new Date("2026-11-18T16:00:00Z");
const lead = { id: "rider-1", firstname: "Ada", lastname: "Pedersen", nationality_code: "dk", team: TEST_TEAM };
const chase = { id: "rider-2", firstname: "Mikkel", lastname: "Hansen", nationality_code: "dk", team: TEST_TEAM };
const SHOTS = process.env.CZ_8409_SHOTS === "1";
const BEFORE = process.env.CZ_8409_BEFORE === "1";
const PANEL = '[data-race-page-version="v6"] [role="tabpanel"]';

async function openRace(page: Page, { shield, opened = [], oneDay = false, completed = false, tab = "start", roleStagesCompleted }: {
  shield: boolean; opened?: number[]; oneDay?: boolean; completed?: boolean; tab?: string; roleStagesCompleted?: number;
}) {
  const stages = oneDay ? 1 : 3;
  const stage = completed ? stages : 1;
  const race = {
    id: RACE_ID, name: oneDay ? "E2E Classic" : "E2E Tour",
    race_type: oneDay ? "single" : "stage_race", race_class: "Class2",
    stages, stages_completed: stage, edition_year: 2026, status: completed ? "completed" : "scheduled",
    season: { id: "season-e2e", number: 1 }, pool_race: null,
  };
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.clock.setFixedTime(fixedNow);
  await page.route("**/api/feature-flags", route => json(route, { flags: { race_page_v6: true } }));
  await page.route("**/api/me/spoiler-shield?**", route => json(route, {
    enabled: true, settings: { shieldAll: false, openFinishedIn: "results" },
    race: { shield, openedStages: opened },
  }));
  await page.route("**/rest/v1/races**", route => json(route,
    route.request().headers().accept?.includes("vnd.pgrst.object") ? race : [race]));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, Array.from({ length: stages }, (_, i) => ({
    stage_number: i + 1, profile_type: "hilly", distance_km: 160, elevation_gain_m: 900,
  }))));
  await page.route("**/rest/v1/race_stage_schedule**", route => json(route, []));
  await page.route("**/rest/v1/race_entries**", route => json(route, [lead, chase].map(r => ({
    rider_id: r.id, team_id: TEST_TEAM.id, rider: r, team: TEST_TEAM,
  }))));
  await page.route("**/rest/v1/race_results**", raceResultsRoute(
    ["stage", completed ? "gc" : "leader"].flatMap(type => [lead, chase].map((r, i) => ({
      id: type + r.id, stage_number: stage, result_type: type, rank: i + 1, rider: r,
      rider_id: r.id, team_id: TEST_TEAM.id, finish_time: i === 0 ? "4:02:10" : "+0:27",
      points_earned: 0, prize_money: 0,
    }))),
  ));
  await page.route("**/api/races/" + RACE_ID + "/stage-roles", route => json(route, {
    enabled: true, stages_completed: roleStagesCompleted ?? stage, stage_count: stages,
    riders: [{ rider_id: lead.id, name: "Ada Pedersen", race_role: "helper" }, {
      rider_id: chase.id, name: "Mikkel Hansen", race_role: "captain",
      ...(completed ? { abandoned: true, time_limit_out_stage: stage } : {}),
    }],
    overrides: [],
  }));
  if (SHOTS) await page.setViewportSize({ width: (page.viewportSize()?.width ?? 1280) < 768 ? 390 : 1440, height: 900 });
  await login(page);
  await page.goto("/races/" + RACE_ID + "?tab=" + tab + "&stage=" + (tab === "stage" ? 2 : stage));
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator('[data-spoiler-switch="' + (shield ? "on" : "off") + '"]')).toBeVisible();
}

async function takeShot(page: Page, name: string, anchor: string) {
  if (!SHOTS || (BEFORE && name.endsWith("-off"))) return;
  await page.locator(PANEL + " " + anchor).first().evaluate(el => el.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: evidenceShotPath("pr-screens/8409/" + (BEFORE ? "before-" : "") + name + "-" + page.viewportSize()?.width + ".png") });
}

for (const shield of [true, false]) {
  test("Startliste and Etape respect the stage result shield: " + shield, async ({ page }) => {
    await openRace(page, { shield });
    const favourites = page.locator("[data-start-favourites]");
    if (shield && !BEFORE) {
      await expect(favourites).toHaveCount(0);
      await expect(page.locator(PANEL + " [data-spoiler-section='results-hidden']")).toBeVisible();
    } else {
      await expect(favourites).toContainText("+0:27");
    }
    await expect(page.locator("[data-start-team]").first()).toBeVisible();
    await takeShot(page, shield ? "start-on" : "start-off", shield && !BEFORE ? "[data-spoiler-section]" : "[data-start-favourites]");

    await page.goto("/races/" + RACE_ID + "?tab=stage&stage=2");
    await expect(page.locator(PANEL + " [data-race-section='lineup']")).toBeVisible();
    await expect(page.locator('[data-spoiler-switch="' + (shield ? "on" : "off") + '"]')).toBeVisible();
    const stageFav = page.locator(PANEL + " [data-race-section='favourites']");
    if (shield && !BEFORE) {
      await expect(stageFav).toHaveCount(0);
    } else {
      await expect(stageFav).toContainText("Fører samlet");
      await expect(stageFav).toContainText("Vandt etape 1");
    }
    await takeShot(page, shield ? "stage-on" : "stage-off", shield && !BEFORE ? "[data-race-section=\x27lineup\x27]" : "[data-race-section=\x27favourites\x27]");

    await page.getByRole("tab", { name: "Hold", exact: true }).click();
    const team = page.locator(PANEL + " [data-race-section='team']");
    await expect(team).toContainText("Ada Pedersen");
    const shortcut = team.getByTestId("jersey-captain-shortcut");
    if (shield && !BEFORE) await expect(shortcut).toHaveCount(0);
    else await expect(shortcut).toBeVisible();
    await takeShot(page, shield ? "team-on" : "team-off", "[data-race-section=\x27team\x27]");
  });
}

test("Startliste protects a finished one-day race until stage 1 is opened", async ({ page }) => {
  await openRace(page, { shield: true, oneDay: true, completed: true });
  const favourites = page.locator("[data-start-favourites]");
  if (BEFORE) {
    await expect(favourites).toContainText("+0:27");
    return;
  }
  await expect(favourites).toHaveCount(0);
  await page.route("**/api/me/spoiler-shield/races/" + RACE_ID + "/opened", route => json(route, { ok: true }));
  await page.locator(PANEL).getByRole("button", { name: "Vis resultater" }).click();
  await expect(favourites).toContainText("+0:27");
});

test("Hold hides a finished race's classification and result-derived departure", async ({ page }) => {
  await openRace(page, { shield: true, completed: true, tab: "team" });
  const team = page.locator(PANEL + " [data-race-section='team']");
  await expect(team).toContainText("Ada Pedersen");
  if (BEFORE) await expect(team.getByTestId("time-limit-out")).toBeVisible();
  else {
    await expect(team.getByTestId("time-limit-out")).toHaveCount(0);
    await expect(team.getByText("DNF", { exact: true })).toHaveCount(0);
    await expect(team.getByRole("columnheader", { name: "Samlet", exact: true })).toHaveCount(0);
  }
});

test("Hold uses the shield even when the roster stage counter is stale", async ({ page }) => {
  test.skip(BEFORE, "This test exercises the fixed behaviour");
  await openRace(page, { shield: true, tab: "team", roleStagesCompleted: 0 });
  const team = page.locator(PANEL + " [data-race-section=\x27team\x27]");
  await expect(team).toContainText("Ada Pedersen");
  await expect(team.getByTestId("jersey-captain-shortcut")).toHaveCount(0);
});
