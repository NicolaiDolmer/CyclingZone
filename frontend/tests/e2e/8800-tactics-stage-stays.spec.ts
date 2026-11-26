// #8800: Taktik-fanen under løbssiden v6 skal blive på den etape manageren valgte.
// Live i en grand tour: etape 16 valgt i etapestriben viste etape 14's rute og
// hoppede tilbage. Specen dækker valget efter indlæsning, efter Gem og efter et
// nyt valg i striben (ændret stage-prop).
import type { Page } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { evidenceShotPath, installNetworkMocks, json, login, raceResultsRoute, stabilizePage } from "./fixtures.js";

const RACE_ID = "00000000-0000-4000-8000-000000008800";
const STAGES = 21;
const RIDDEN = 13;
const shots = process.env.CZ_8800_SHOTS === "1";
const shotTag = process.env.CZ_8800_BEFORE === "1" ? "before" : "after";
const NOW = new Date("2026-11-26T12:00:00Z");
const riders = [
  { rider_id: "r1", name: "Ada Pedersen", race_role: "captain", nationality_code: "dk", rating: 61, form: 82, fatigue: 26 },
  { rider_id: "r2", name: "Mikkel Hansen", race_role: "helper", nationality_code: "nl", rating: 58, form: 77, fatigue: 33 },
  { rider_id: "r3", name: "Pavel Novak", race_role: "hunter", nationality_code: "fr", rating: 56, form: 79, fatigue: 30 },
];
const stageNumbers = Array.from({ length: STAGES }, (_, i) => i + 1);
const scheduledAt = (n: number) => new Date(NOW.getTime() + (n - RIDDEN) * 24 * 3600 * 1000).toISOString();

async function openTactics(page: Page, search: string) {
  const race = {
    id: RACE_ID, name: "E2E Vuelta", race_type: "stage_race", race_class: "GrandTour",
    stages: STAGES, stages_completed: RIDDEN, edition_year: 2026, status: "active",
    engine_rules_revision: "s5_profiles_v3", season: { id: "season-e2e", number: 1 },
  };
  const saved: number[] = [];
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.clock.setFixedTime(NOW);
  await page.route("**/api/feature-flags", (route) => json(route, { flags: { race_page_v6: true } }));
  await page.route("**/rest/v1/races**", (route) => json(route,
    route.request().headers().accept?.includes("vnd.pgrst.object") ? race : [race]));
  await page.route("**/rest/v1/race_results**", raceResultsRoute([]));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, stageNumbers.map((stage_number) => ({
    stage_number, profile_type: stage_number === 16 ? "mountain" : "hilly", distance_km: 160 + stage_number, elevation_gain_m: 900,
    climbs: [], sprints: [], sectors: [],
  }))));
  await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, stageNumbers.map((stage_number) => ({
    race_id: RACE_ID, stage_number, scheduled_at: scheduledAt(stage_number),
  }))));
  await page.route("**/api/races/" + RACE_ID + "/stage-roles", (route) => json(route, {
    enabled: true, intention_enabled: true, stages_completed: RIDDEN, stage_count: STAGES, riders, overrides: [],
  }));
  await page.route("**/api/races/" + RACE_ID + "/team-orders**", (route) => {
    if (route.request().method() === "PUT") {
      saved.push(Number(new URL(route.request().url()).pathname.split("/").pop()));
      return json(route, { ok: true });
    }
    return json(route, {
      stages_completed: RIDDEN, stage_count: STAGES, riders, stage_plan_enabled: true,
      stages: stageNumbers.map((stage_number) => ({ stage_number, locked: stage_number <= RIDDEN, scheduled_at: scheduledAt(stage_number) })),
      orders: [],
    });
  });
  await login(page);
  await page.goto("/races/" + RACE_ID + search);
  const root = page.locator('[data-race-page-version="v6"]');
  const panel = root.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return { root, panel, saved };
}

const saveButton = (panel: import("@playwright/test").Locator, n: number) =>
  panel.getByRole("button", { name: "Gem etape " + n, exact: true }).filter({ visible: true });

test("#8800: etape 16 valgt i striben bliver valgt efter indlæsning, Gem og et nyt valg", async ({ page }) => {
  const { root, panel, saved } = await openTactics(page, "?stage=16&tab=tactics");
  const strip = root.locator("[data-race-strip]");
  await strip.locator('[data-stage="16"]').click();
  await expect(strip.locator('[data-stage="16"]')).toHaveAttribute("aria-current", "true");
  await expect(saveButton(panel, 16)).toBeVisible();
  // Lad alle forsinkede hentninger (flag, revision, gemte planer) lande: valget står stadig.
  await page.waitForLoadState("networkidle");
  await expect(saveButton(panel, 16)).toBeVisible();
  await expect(strip.locator('[data-stage="16"]')).toHaveAttribute("aria-current", "true");
  if (shots) await page.screenshot({ path: evidenceShotPath(`pr-screens/8800/${shotTag}-${page.viewportSize()?.width}.png`), scale: "css" });

  await saveButton(panel, 16).click();
  await expect.poll(() => saved.at(-1)).toBe(16);
  await page.waitForLoadState("networkidle");
  await expect(saveButton(panel, 16)).toBeVisible();
  await expect(strip.locator('[data-stage="16"]')).toHaveAttribute("aria-current", "true");

  await strip.locator('[data-stage="17"]').click();
  await expect(saveButton(panel, 17)).toBeVisible();
  await strip.locator('[data-stage="16"]').click();
  await expect(saveButton(panel, 16)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(saveButton(panel, 16)).toBeVisible();
});

test("#8800: Taktik åbnet fra etape 16 viser etape 16 (ikke næste åbne etape)", async ({ page }) => {
  const { root, panel } = await openTactics(page, "?stage=16&tab=tactics");
  await page.waitForLoadState("networkidle");
  await expect(saveButton(panel, 16)).toBeVisible();
  await expect(root.locator('[data-race-strip] [data-stage="16"]')).toHaveAttribute("aria-current", "true");
});
