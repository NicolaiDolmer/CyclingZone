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

async function prepareRace(page: Page, { withTimeline, rows = results }: { withTimeline: boolean; rows?: typeof results }) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/races**", route => {
    const race = { id: "race-6185", name: "Testetape · sat af fra udbruddet", race_type: "stage_race", race_class: "TourFrance", stages: 1, stages_completed: 1, edition_year: 2026, status: "completed", season: { id: "season-6185", number: 1 }, pool_race: null };
    return json(route, (route.request().headers().accept || "").includes("vnd.pgrst.object") ? race : [race]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute(rows));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, [{ ...MOUNTAIN_STAGE_PROFILE, stage_number: 1 }]));
  await page.route("**/rest/v1/race_stage_passages**", route => json(route, []));
  await page.route("**/api/races/*/timeline**", route => withTimeline ? json(route, timeline) : route.fulfill({ status: 404, body: "{}" }));
  await login(page);
  await page.goto("/races/race-6185?stage=1");
  await expect(page.getByRole("heading", { name: "Etape 1 · målrækkefølge", exact: true })).toBeVisible();
  const showAll = page.getByRole("button", { name: /^Vis alle/ });
  if (await showAll.count()) await showAll.click();
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

// Held home / caught / dropped, side by side from stored rows (no timeline): one
// escapee wins, one is caught, one is dropped. Tail rows are plain riders.
const stateRows = [
  ["held", 1, { in_breakaway: true, breakaway_caught: false, breakaway_dropped: false }],
  ["p1", 2, {}], ["p2", 3, {}],
  ["caught", 4, { in_breakaway: true, breakaway_caught: true }],
  ["p3", 5, {}], ["p4", 6, {}], ["p5", 7, {}],
  ["dropped", 8, { in_breakaway: true, breakaway_caught: false, breakaway_dropped: true }],
  ["p6", 9, {}],
].map(([id, rank, flags]) => ({
  id: `s-${id}`, stage_number: 1, result_type: "stage", rank, rider_id: id, rider_name: `Rytter ${String(id).toUpperCase()}`,
  team_id: "team-x", team_name: "Testhold", finish_time: `+${Number(rank) - 1}:00`, points_earned: 0, prize_money: 0,
  rider: { id, firstname: "Rytter", lastname: String(id).toUpperCase(), nationality_code: "dk", team: { id: "team-x", name: "Testhold" } },
  in_breakaway: false, breakaway_caught: false, ...(flags as object),
})) as typeof results;

test("#6185 held home, caught and dropped differ in icon shape and tone (no hover needed)", async ({ page }, testInfo) => {
  await prepareRace(page, { withTimeline: false, rows: stateRows });
  const held = page.locator('[aria-label="Udbrud: holdt hjem til mål"]');
  const caught = page.locator('[aria-label="Udbrud: indhentet"]');
  const dropped = page.locator('[aria-label="Udbrud: sat af fra udbruddet"]');
  await expect(held).toHaveCount(1);
  await expect(caught).toHaveCount(1);
  await expect(dropped).toHaveCount(1);
  const look = (marker: typeof held) => marker.evaluate((el) => ({ color: getComputedStyle(el).color, shape: el.querySelector("svg path")!.getAttribute("d") }));
  const [h, c, d] = [await look(held), await look(caught), await look(dropped)];
  // Dropped leaves the flag SHAPE (not only the colour); the three tones are all distinct.
  expect(d.shape).not.toBe(h.shape);
  expect(d.shape).not.toBe(c.shape);
  expect(new Set([h.color, c.color, d.color]).size).toBe(3);
  if (process.env.CZ_REVIEW_SCREENS === "1") {
    // Zoomed crop of the three rows for the PR before/after image.
    await page.setViewportSize({ width: 2560, height: 2000 });
    await page.evaluate(() => { document.body.style.zoom = "2"; });
    const first = (await page.getByText("Rytter HELD", { exact: true }).boundingBox())!;
    const last = (await page.getByText("Rytter DROPPED", { exact: true }).boundingBox())!;
    const docY = await page.evaluate(() => window.scrollY);
    await page.screenshot({ path: testInfo.outputPath("6185-three-states.png"), fullPage: true, clip: { x: Math.max(0, first.x - 220), y: docY + first.y - 30, width: 1380, height: last.y + last.height - first.y + 60 } });
  }
});

test("#6185 a tap on the dropped marker shows its text and does not open the rider", async ({ page }, testInfo) => {
  await prepareRace(page, { withTimeline: false, rows: stateRows });
  // Review: the mobile projects (hasTouch) really tap, so touch is proven, not a mouse click.
  const touch = Boolean(testInfo.project.use.hasTouch);
  const press = (locator: ReturnType<Page["locator"]>) => touch ? locator.tap() : locator.click();
  const url = page.url();
  const marker = page.locator('[aria-label="Udbrud: sat af fra udbruddet"]');
  const bubble = page.getByRole("tooltip");
  await expect(bubble).toHaveCount(0);
  // Review: the marker sits inside the rider link, so it is not focusable itself
  // (no nested-interactive), and its tap target is at least 24 px.
  expect(await marker.evaluate((el) => (el as HTMLElement).tabIndex)).toBe(-1);
  const target = (await marker.boundingBox())!;
  expect(target.width).toBeGreaterThanOrEqual(24);
  expect(target.height).toBeGreaterThanOrEqual(24);
  await press(marker);
  await expect(bubble).toHaveText("Udbrud: sat af fra udbruddet");
  await expect(bubble).toHaveCSS("opacity", "1");
  // The bubble is never clipped by the result table: fully inside the viewport.
  const box = (await bubble.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(page.url()).toBe(url);
  if (process.env.CZ_REVIEW_SCREENS === "1") await page.screenshot({ path: testInfo.outputPath("6185-tap.png") });
  if (touch) {
    // A second tap on the same marker closes it, and still does not open the rider.
    await press(marker);
    await expect(bubble).toHaveCount(0);
    expect(page.url()).toBe(url);
    await press(marker);
    await expect(bubble).toHaveText("Udbrud: sat af fra udbruddet");
  }
  // Tapping elsewhere closes it again.
  await press(page.getByRole("heading", { name: "Etape 1 · målrækkefølge", exact: true }));
  await expect(bubble).toHaveCount(0);
});
