// #8800: Taktik-fanen under løbssiden v6 skal blive på den etape manageren valgte.
// Live i en grand tour: Taktik åbnet for etape 16 viste først etape 16 og sprang så
// tilbage til løbets næste åbne etape (14), da holdets roller var hentet. Specen
// dækker valget efter indlæsning, efter Gem og efter et nyt valg i striben.
import type { Locator, Page } from "@playwright/test";
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

async function openRace(page: Page, search: string, { slowRoles = false } = {}) {
  const race = {
    id: RACE_ID, name: "E2E Vuelta", race_type: "stage_race", race_class: "GrandTour",
    stages: STAGES, stages_completed: RIDDEN, edition_year: 2026, status: "active",
    engine_rules_revision: "s5_profiles_v3", season: { id: "season-e2e", number: 1 },
  };
  const saved: number[] = [];
  let releaseRoles = () => {};
  const rolesGate = slowRoles ? new Promise<void>((resolve) => { releaseRoles = resolve; }) : Promise.resolve();
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
  await page.route("**/api/races/" + RACE_ID + "/stage-roles", async (route) => {
    // Rollerne lander efter første tegning, som i prod: det var dér etapen sprang.
    await rolesGate;
    return json(route, { enabled: true, intention_enabled: true, stages_completed: RIDDEN, stage_count: STAGES, riders, overrides: [] });
  });
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
  const width = (page.viewportSize()?.width ?? 1280) < 768 ? 390 : 1440;
  if (shots) await page.setViewportSize({ width, height: 900 });
  await login(page);
  await page.goto("/races/" + RACE_ID + search);
  const root = page.locator('[data-race-page-version="v6"]');
  return { root, panel: root.getByTestId("race-tactics-tab"), strip: root.locator("[data-race-strip]"), saved, width, releaseRoles };
}

const saveButton = (panel: Locator, n: number) =>
  panel.getByRole("button", { name: "Gem etape " + n, exact: true }).filter({ visible: true });

async function expectOnStage(page: Page, panel: Locator, strip: Locator, n: number) {
  await expect(saveButton(panel, n)).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  await expect(saveButton(panel, n)).toBeVisible();
  await expect(strip.locator(`[data-stage="${n}"]`)).toHaveAttribute("aria-current", "true");
}

// Paa telefonen ligger indsatsen i rytterens ark (#8386); paa computeren i raekken.
async function makeDraftDirty(page: Page, panel: Locator, width: number) {
  if (width === 390) {
    await panel.locator("[data-tactics-phone-rider=r1] button[aria-haspopup=dialog]").click();
    const sheet = page.getByTestId("tactics-phone-rider-sheet");
    await sheet.getByRole("group", { name: /Indsats for/ }).getByRole("button", { name: /^Hård/ }).click();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    return;
  }
  const row = panel.locator("[data-tactics-rider=r1]").filter({ visible: true });
  await row.getByRole("group", { name: /Indsats for/ }).getByRole("button", { name: /^Hård/ }).click();
}

test("#8800: Taktik åbnet for etape 16 bliver på 16, også når holdets roller lander bagefter", async ({ page }) => {
  const { panel, strip, releaseRoles } = await openRace(page, "?stage=16&tab=tactics", { slowRoles: true });
  await expect(strip.locator('[data-stage="16"]')).toHaveAttribute("aria-current", "true", { timeout: 15_000 });
  releaseRoles();
  if (shots) {
    await expect(panel.getByRole("button", { name: /^Gem etape \d+$/ }).filter({ visible: true })).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: evidenceShotPath(`pr-screens/8800/${shotTag}-${page.viewportSize()?.width}.png`), scale: "css" });
  }
  await expectOnStage(page, panel, strip, 16);
});

test("#8800: fra Etape-fanen for etape 16 åbner Taktik-fanen etape 16", async ({ page }) => {
  const { root, panel, strip } = await openRace(page, "?stage=16&tab=stage");
  await root.getByRole("tab", { name: "Taktik" }).click();
  await expectOnStage(page, panel, strip, 16);
});

test("#8800: etape 16 valgt i striben holder efter Gem og efter et nyt valg", async ({ page }) => {
  const { panel, strip, saved, width } = await openRace(page, "?tab=tactics");
  await strip.locator('[data-stage="16"]').click();
  await expectOnStage(page, panel, strip, 16);

  await makeDraftDirty(page, panel, width);
  await saveButton(panel, 16).click();
  await expect.poll(() => saved.at(-1)).toBe(16);
  await expectOnStage(page, panel, strip, 16);

  await strip.locator('[data-stage="17"]').click();
  await expectOnStage(page, panel, strip, 17);
  await strip.locator('[data-stage="16"]').click();
  await expectOnStage(page, panel, strip, 16);
});

test("#8800: uden valgt etape åbner Taktik stadig løbets næste åbne etape", async ({ page }) => {
  const { panel, strip } = await openRace(page, "?tab=tactics");
  await expectOnStage(page, panel, strip, RIDDEN + 1);
});
