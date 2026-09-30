import type { Page } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, raceResultsRoute } from "./fixtures.js";
import { MOUNTAIN_STAGE_PROFILE } from "../../src/lib/stageTimelineFixtures.js";

// Synthetic history: broad legacy flags must not turn later attackers into morning escapees.
const results = Array.from({ length: 20 }, (_, index) => {
  const id = `history-rider-${index + 1}`;
  const rider = { id, firstname: "Rytter", lastname: String(index + 1), nationality_code: "dk", team: { id: "team-x", name: "Testhold" } };
  return { id: `history-result-${index}`, stage_number: 1, result_type: "stage", rank: index + 1, rider_id: id, rider_name: `Rytter ${index + 1}`, team_id: "team-x", team_name: "Testhold", finish_time: index ? "+0:20" : "+0:00", points_earned: 0, prize_money: 0, rider, in_breakaway: true, breakaway_caught: true };
});
const morning = results.slice(0, 8).map(row => row.rider_id);
const later = results.slice(8).map(row => row.rider_id);
const timeline = { timeline_version: 2, stage_number: 1, events: [
  { km: 0, type: "stage_start", params: { field_count: 20, distance_km: 168 } },
  { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: morning } },
  { km: 75.9, type: "finale_attack", params: { direction: "descent", group_id: "attack-1", rider_ids: later } },
  { km: 120, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: morning } },
  { km: 168, type: "finale_attack", params: { kind: "stage_decided", rider_ids: morning } },
  { km: 168, type: "finish", params: { win_type: "close_win", top: [{ rider_id: morning[0], rank: 1, gap: "+0:00" }] } },
] };

async function prepareRace(page: Page, raceType: "stage_race" | "single" = "stage_race") {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/races**", route => {
    const race = { id: "history-race", name: "Testetape · udbrud og angreb", race_type: raceType, race_class: "TourFrance", stages: 1, stages_completed: 1, edition_year: 2026, status: "completed", season: { id: "history-season", number: 1 }, pool_race: null };
    return json(route, (route.request().headers().accept || "").includes("vnd.pgrst.object") ? race : [race]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute(results));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, [{ ...MOUNTAIN_STAGE_PROFILE, stage_number: 1 }]));
  await page.route("**/rest/v1/race_stage_passages**", route => json(route, []));
  await page.route("**/api/races/*/timeline**", route => json(route, timeline));
  await login(page);
  await page.goto("/races/history-race?stage=1");
}

test("recorded stage history replaces twenty legacy flags with eight morning flags and twelve attack markers", async ({ page }, testInfo) => {
  await prepareRace(page);
  await expect(page.getByRole("heading", { name: "Etape 1 · målrækkefølge", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Vis alle 20" }).click();
  await expect(page.locator('[aria-label^="Morgenudbrud:"]')).toHaveCount(8);
  await expect(page.locator('[aria-label="Senere angreb"]')).toHaveCount(12);
  await expect(page.getByText("Udbruddet (8 ryttere) blev hentet før stregen.")).toBeVisible();
  if (process.env.CZ_REVIEW_SCREENS === "1") await page.screenshot({ path: testInfo.outputPath("race-history-results.png"), fullPage: true });
  await page.getByRole("button", { name: "Se løbsfilmen" }).click();
  const film = page.getByRole("dialog");
  await film.getByRole("slider", { name: "Scrub gennem etapen" }).fill("168");
  await expect(film.getByText(/angriber på nedkørslen/)).toBeVisible();
  await expect(film.getByText(/angriber i finalen/)).toHaveCount(0);
  if (process.env.CZ_REVIEW_SCREENS === "1") {
    await page.screenshot({ path: testInfo.outputPath("race-history-film.png"), fullPage: false });
  }
});

test("one-day results use the same complete native participation history", async ({ page }) => {
  await prepareRace(page, "single");
  await page.getByRole("tab", { name: "Resultater", exact: true }).click();
  await page.getByRole("button", { name: "Vis alle 20" }).click();
  await expect(page.locator('[aria-label^="Morgenudbrud:"]')).toHaveCount(8);
  await expect(page.locator('[aria-label="Senere angreb"]')).toHaveCount(12);
  await expect(page.getByText("Udbruddet (8 ryttere) blev hentet før stregen.")).toBeVisible();
});
