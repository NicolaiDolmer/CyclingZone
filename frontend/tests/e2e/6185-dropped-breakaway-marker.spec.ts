import type { Page } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, raceResultsRoute } from "./fixtures.js";
import { MOUNTAIN_STAGE_PROFILE } from "../../src/lib/stageTimelineFixtures.js";
import { PENISOLA_STAGE3_EVENTS, PENISOLA_STAGE3_RANKS } from "../../../backend/lib/raceParticipationHistory.fixtures.ts";

// #6185 anchor (Penisola stage 3, aliased): four morning escapees dropped from
// the break at km 162 finish near the back. Stored rows say "not caught", which
// the page used to read as "held home".
const riders = Object.entries(PENISOLA_STAGE3_RANKS).sort((a, b) => a[1] - b[1]);
const results = riders.map(([id, rank], index) => {
  const escapee = id.startsWith("e");
  const rider = { id, firstname: "Rytter", lastname: id.toUpperCase(), nationality_code: "dk", team: { id: "team-x", name: "Testhold" } };
  return {
    id: `r-${id}`, stage_number: 1, result_type: "stage", rank: index + 1, rider_id: id, rider_name: `Rytter ${id.toUpperCase()}`,
    team_id: "team-x", team_name: "Testhold", finish_time: index ? `+${index}:00` : "+0:00", points_earned: 0, prize_money: 0, rider,
    in_breakaway: escapee, breakaway_caught: id === "e3" || id === "e6",
  };
});
const timeline = { timeline_version: 2, stage_number: 1, events: PENISOLA_STAGE3_EVENTS };

async function prepareRace(page: Page, { withTimeline }: { withTimeline: boolean }) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/races**", route => {
    const race = { id: "race-6185", name: "Testetape · sat af fra udbruddet", race_type: "stage_race", race_class: "TourFrance", stages: 1, stages_completed: 1, edition_year: 2026, status: "completed", season: { id: "season-6185", number: 1 }, pool_race: null };
    return json(route, (route.request().headers().accept || "").includes("vnd.pgrst.object") ? race : [race]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute(results));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, [{ ...MOUNTAIN_STAGE_PROFILE, stage_number: 1 }]));
  await page.route("**/rest/v1/race_stage_passages**", route => json(route, []));
  await page.route("**/api/races/*/timeline**", route => withTimeline ? json(route, timeline) : route.fulfill({ status: 404, body: "{}" }));
  await login(page);
  await page.goto("/races/race-6185?stage=1");
  await expect(page.getByRole("heading", { name: "Etape 1 · målrækkefølge", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Vis alle/ }).click();
}

test("#6185 dropped escapees get their own marker, never 'held home'", async ({ page }, testInfo) => {
  await prepareRace(page, { withTimeline: true });
  await expect(page.locator('[aria-label="Morgenudbrud: sat af fra udbruddet"]')).toHaveCount(4);
  await expect(page.locator('[aria-label="Morgenudbrud: indhentet"]')).toHaveCount(2);
  await expect(page.locator('[aria-label="Morgenudbrud: holdt hjem til mål"]')).toHaveCount(0);
  if (process.env.CZ_REVIEW_SCREENS === "1") await page.screenshot({ path: testInfo.outputPath("6185-after.png"), fullPage: true });
});

test("#6185 without a timeline the stored rows still never read as 'held home'", async ({ page }) => {
  await prepareRace(page, { withTimeline: false });
  await expect(page.locator('[aria-label="Udbrud: sat af fra udbruddet"]')).toHaveCount(4);
  await expect(page.locator('[aria-label="Udbrud: indhentet"]')).toHaveCount(2);
  await expect(page.locator('[aria-label="Udbrud: holdt hjem til mål"]')).toHaveCount(0);
});
