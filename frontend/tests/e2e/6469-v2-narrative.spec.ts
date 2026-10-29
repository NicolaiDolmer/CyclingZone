import { simulateStageV4 } from "../../../backend/lib/engine/v4/index.ts";
// #6469: exercise the real v2 Stage consumer with a synthetic recorded-event fixture.
// Baseline screenshots use the earlier build with CZ_7275_SHOT_BEFORE=1; CI always asserts the new behavior.
import { readFileSync } from "node:fs";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, raceResultsRoute, TEST_TEAM } from "./fixtures.js";
import { buildRaceStory } from "../../../backend/lib/raceStory.js";

const COPY = JSON.parse(readFileSync(new URL("../../public/locales/da/races.json", import.meta.url), "utf8")).detail.film.event;
const RACES_DA = JSON.parse(readFileSync(new URL("../../public/locales/da/races.json", import.meta.url), "utf8"));
test.beforeEach(async ({ page }) => { await page.clock.install({ time: new Date("2026-10-26T12:00:00.000Z") }); });
const RACE = { id: "race-6469-v2", name: "Hilly mass-start fixture", race_type: "stage_race", race_class: "TourFrance", stages: 1, stages_completed: 1, edition_year: 2026, status: "completed", season: { id: "season-e2e", number: 1 }, pool_race: null };
const RIDERS = [
  { id: "n1", firstname: "Ada", lastname: "Pedersen", nationality_code: "dk", team: { id: TEST_TEAM.id, name: TEST_TEAM.name } },
  { id: "n2", firstname: "Mikkel", lastname: "Hansen", nationality_code: "dk", team: { id: "other-team", name: "Other team" } },
  { id: "n3", firstname: "Sofie", lastname: "Lund", nationality_code: "dk", team: { id: "other-team", name: "Other team" } },
];
const RESULTS = RIDERS.map((rider, index) => ({ id: "result-" + rider.id, stage_number: 1, result_type: "stage", rank: index + 1, rider_id: rider.id, rider_name: rider.firstname + " " + rider.lastname, team_id: rider.team.id, team_name: rider.team.name, finish_time: index ? "+0:" + index * 20 : "1:00:00", points_earned: 0, prize_money: 0, rider }));
const EVENTS = [
  { type: "stage_start", km: 0, params: { exact_km: 0, exact_time: 0, distance_km: 100, field_count: 3, profile_type: "hilly" } },
  { type: "breakaway_formed", km: 10, params: { group_id: "breakaway-0", rider_ids: ["n1"], exact_km: 10, exact_time: 300 } },
  { type: "breakaway_unchased", km: 30, params: { group_id: "breakaway-0" } },
  { type: "gap_update", km: 50, params: { group_id: "peloton-0", gap_seconds: 120, exact_km: 50, exact_time: 1920 } },
  { type: "breakaway_survived", km: 100, params: { group_id: "breakaway-0", rider_ids: ["n1"], exact_km: 100, exact_time: 3600 } },
  { type: "finish", km: 100, params: { exact_km: 100, exact_time: 3600, win_type: "solo_win", top: RIDERS.map((r, i) => ({ rider_id: r.id, rank: i + 1, gap: i * 20 })) } },
];
const STORY = buildRaceStory({ events: EVENTS, timelineVersion: 2, results: RESULTS.map(r => ({ rider_id: r.rider_id, rank: r.rank })), startlist: RIDERS.map(r => r.id) });

for (const order of ["all_out", "save", "failed"] as const) {
  test("#6469 v2: recorded explanation, authoritative own order " + order, async ({ page }, testInfo) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
    if (testInfo.project.name === "desktop-chromium") await page.setViewportSize({ width: 1440, height: 1000 });
    let orderReads = 0;
    await page.route("**/api/races/stage-page-v2**", route => json(route, { enabled: true }));
    await page.route("**/rest/v1/races**", route => json(route, (route.request().headers().accept || "").includes("vnd.pgrst.object") ? RACE : [RACE]));
    await page.route("**/rest/v1/race_results**", raceResultsRoute(RESULTS));
    await page.route("**/rest/v1/race_stage_profiles**", route => json(route, [{ stage_number: 1, profile_type: "hilly", distance_km: 100, elevation_gain_m: 300, elevation_profile: { v: 1, step_km: 50, h: [20, 150, 30] }, climbs: [] }]));
    await page.route("**/rest/v1/race_stage_passages**", route => json(route, []));
    await page.route("**/api/races/*/timeline**", route => json(route, { events: EVENTS, timeline_version: 2, created_at: "2026-10-26T10:00:00Z", story: STORY }));
    await page.route("**/api/races/*/stage-roles**", route => json(route, { riders: [{ rider_id: "n1", name: "Ada Pedersen", race_role: "captain" }], overrides: [{ stage_number: 1, rider_id: "n1", effort: "all_out" }] }));
    await page.route("**/api/races/*/team-orders**", route => {
      if (route.request().method() === "OPTIONS") return route.fallback();
      orderReads++;
      return order === "failed" ? json(route, { error: "fixture_unavailable" }, 503) : json(route, { stages: [1], stage_count: 1, stages_completed: 1, race_completed: true, riders: [{ rider_id: "n1", race_role: "captain" }], orders: [{ stage_number: 1, locked_at: "2026-10-26T09:00:00Z", riders: [{ rider_id: "n1", effort: order }] }] });
    });
    await login(page);
    await page.goto("/races/race-6469-v2?stage=1&tab=stage");
    const card = page.locator('[aria-label="Sådan blev etape 1 kørt"]');
    await expect(card).toBeVisible();
    const before = process.env.CZ_7275_SHOT_BEFORE === "1";
    const cause = card.getByText(COPY.cause.unchased, { exact: true });
    const ownOrder = card.getByText(COPY.order.all_out_stayed_away.replace("{rider}", "Pedersen"), { exact: true });
    if (before) await expect(cause).toHaveCount(0);
    else await expect(cause).toBeVisible();
    if (!before && order === "all_out") await expect(ownOrder).toBeVisible();
    else await expect(ownOrder).toHaveCount(0);
    await expect.poll(() => orderReads).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (order === "all_out" && testInfo.project.name !== "mobile-webkit") {
      await card.screenshot({ path: testInfo.outputPath("7275-v2-" + (before ? "before-" : "after-") + testInfo.project.name + ".png") });
      await page.evaluate(() => window.scrollTo(0, 0));
      await card.getByRole("button", { name: "Ruten", exact: true }).click();
      await expect(card.getByText(RACES_DA.detail.profileType.hilly, { exact: true })).toBeVisible();
      await card.screenshot({ path: testInfo.outputPath("7275-hilly-context-" + testInfo.project.name + ".png") });
    }
  });
}

const ITT_INPUT = JSON.parse(readFileSync(new URL("../../../backend/lib/engine/v4/fixtures/itt-solo/input.json", import.meta.url), "utf8"));
const ITT_OUTPUT = simulateStageV4({ ...ITT_INPUT, startlist: ITT_INPUT.startlist.map(r => ({ ...r, effort: "all_out" })), rules_revision: "s5_profiles_v3" });
const ITT_RESULTS = [...ITT_OUTPUT.results].sort((a, b) => a.rank - b.rank).map((result, index) => {
  const rider = { id: result.rider_id, firstname: "Fixture", lastname: "Trial " + String.fromCharCode(65 + index), nationality_code: "dk", team: { id: index === 0 ? TEST_TEAM.id : "other-team", name: index === 0 ? TEST_TEAM.name : "Other team" } };
  const seconds = Math.round(index === 0 ? result.time_seconds : result.time_seconds - ITT_OUTPUT.results.find(row => row.rank === 1)!.time_seconds);
  const clock = Math.floor(seconds / 3600) + ":" + String(Math.floor(seconds / 60) % 60).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  return { id: "itt-result-" + rider.id, stage_number: 1, result_type: "stage", rank: result.rank, rider_id: rider.id, rider_name: rider.firstname + " " + rider.lastname, team_id: rider.team.id, team_name: rider.team.name, finish_time: (index ? "+" : "") + clock, rider, points_earned: 0, prize_money: 0 };
});
const ITT_STORY = buildRaceStory({ events: ITT_OUTPUT.timeline.events, timelineVersion: 2, results: ITT_RESULTS.map(r => ({ rider_id: r.rider_id, rank: r.rank })), startlist: ITT_RESULTS.map(r => r.rider_id) });
const LEGACY_ITT_EVENTS = ITT_OUTPUT.timeline.events.map(event => event.type === "stage_start" ? { ...event, params: { ...event.params, profile_type: undefined } } : event.type === "finish" ? { ...event, params: { ...event.params, win_type: undefined } } : event);
const TT_COPY = JSON.parse(readFileSync(new URL("../../public/locales/da/races.json", import.meta.url), "utf8")).stagePageV2.story.timeTrial;

for (const scenario of ["native", "legacy-story-flag", "classic"] as const) {
  test("#6469 actual time trial profile has no breakaway story: " + scenario, async ({ page }, info) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
    if (info.project.name === "desktop-chromium") await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/api/races/stage-page-v2**", route => json(route, { enabled: scenario !== "classic" }));
    await page.route("**/rest/v1/races**", route => json(route, (route.request().headers().accept || "").includes("vnd.pgrst.object") ? { ...RACE, name: "ITT context fixture" } : [{ ...RACE, name: "ITT context fixture" }]));
    await page.route("**/rest/v1/race_results**", raceResultsRoute(ITT_RESULTS));
    await page.route("**/rest/v1/race_stage_profiles**", route => json(route, [{ stage_number: 1, profile_type: "itt", distance_km: ITT_INPUT.route.distance_km, elevation_gain_m: 0, climbs: [] }]));
    await page.route("**/rest/v1/race_stage_passages**", route => json(route, []));
    await page.route("**/api/races/*/timeline**", route => json(route, { events: scenario === "legacy-story-flag" ? LEGACY_ITT_EVENTS : ITT_OUTPUT.timeline.events, timeline_version: 2, created_at: "2026-10-26T10:00:00Z", story: scenario === "legacy-story-flag" ? { ...ITT_STORY, time_trial: false } : ITT_STORY }));
    const own = ITT_RESULTS[0];
    await page.route("**/api/races/*/stage-roles**", route => json(route, { riders: [{ rider_id: own.rider_id, name: own.rider_name, race_role: "captain" }], overrides: [{ stage_number: 1, rider_id: own.rider_id, effort: "all_out" }] }));
    await page.route("**/api/races/*/team-orders**", route => json(route, { stages: [1], riders: [{ rider_id: own.rider_id, race_role: "captain" }], orders: [{ stage_number: 1, locked_at: "2026-10-26T09:00:00Z", riders: [{ rider_id: own.rider_id, effort: "all_out" }] }] }));
    await login(page);
    await page.goto(scenario === "classic" ? "/races/race-6469-v2?stage=1&v2=off" : "/races/race-6469-v2?stage=1&tab=stage");
    if (scenario === "classic") {
      await page.getByRole("button", { name: "Se løbsfilmen", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("slider", { name: "Scrub gennem etapen" }).press("End");
      await expect(dialog).toContainText(/én ad gangen/i);
      if (process.env.CZ_ITT_SHOT_BEFORE === "1") await expect(dialog).toContainText(/forreste gruppe/i);
      else await expect(dialog).not.toContainText(/udbrud|forreste gruppe|holdt hjul/i);
      if (info.project.name !== "mobile-webkit") await dialog.screenshot({ path: info.outputPath("7275-itt-film-" + (process.env.CZ_ITT_SHOT_BEFORE === "1" ? "before-" : "after-") + info.project.name + ".png") });
      return;
    }
    const card = page.locator('[aria-label="Sådan blev etape 1 kørt"]');
    await expect(page.getByText(RACES_DA.detail.profileType.itt, { exact: true }).first()).toBeVisible();
    await expect(card.getByText(TT_COPY, { exact: true })).toBeVisible();
    await expect(card).not.toContainText(/udbrud|forreste gruppe|holdt hjul/i);
    const recap = page.locator('[aria-label="' + RACES_DA.stageOrders.title + '"]');
    await expect(recap).toBeVisible();
    await expect(recap).not.toContainText(/udbrud|sprinttog/i);
    if (scenario === "native" && info.project.name !== "mobile-webkit") {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath("7275-itt-context-" + info.project.name + ".png"), fullPage: false });
      await card.getByText(TT_COPY, { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("7275-itt-story-" + info.project.name + ".png"), fullPage: false });
    }
  });
}
