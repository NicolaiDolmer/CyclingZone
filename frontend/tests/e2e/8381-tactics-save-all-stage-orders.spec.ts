// #8381: Taktik-fanens kladde for ordrer ligger pr. etape og overlever et
// etapeskift. Gem skal derfor sende ordrer for ALLE etaper med aendrede ordrer,
// ikke kun den aabne, og "Gemt" maa foerst staa, naar alle er bekraeftet.
// Foer rettelsen: ordrer aendret paa etape 2, skift til etape 3, Gem -> kun
// etape 3 blev sendt, og fanen sagde "Intentionerne er gemt."
//
// Moenster som race-tactics-tab.spec.js: stabilizePage -> installNetworkMocks ->
// spec-specifikke routes (LIFO) -> login -> goto.
import { test, expect } from "./e2e-base.js";
import type { Locator, Page } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, raceResultsRoute } from "./fixtures.js";

type Override = { stage_number: number; rider_id: string; race_role: string; effort: string };
type OrderRider = { rider_id: string; try_break?: boolean; effort?: string };
type OrderPut = { stage: number; body: { riders: OrderRider[] } };

const RACE_ID = "00000000-0000-4000-8000-000000008381";
const FIVE_STEPS = ["grupetto", "save", "normal", "protect", "all_out"];
const RIDERS = [
  { rider_id: "r1", name: "Rider One", race_role: "captain", abandoned: false },
  { rider_id: "r2", name: "Rider Two", race_role: "helper", abandoned: false },
];
const STAGES = 4;
const visible = (locator: Locator) => locator.filter({ visible: true }).first();

const RACE = {
  id: RACE_ID,
  name: "E2E Tactics Race",
  race_type: "stage_race",
  race_class: "OtherWorldTourA",
  stages: STAGES,
  stages_completed: 1,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
  engine_rules_revision: "orders_gc_v1",
};

const LIVE_RESULTS = [
  { id: "res-1", stage_number: 1, result_type: "leader", rank: 1, rider_id: "r1", rider_name: "Rider One", team_id: "team-e2e", team_name: "E2E Team", finish_time: "+0:00" },
  { id: "res-2", stage_number: 1, result_type: "leader", rank: 2, rider_id: "r2", rider_name: "Rider Two", team_id: "team-e2e", team_name: "E2E Team", finish_time: "+0:12" },
];

const flatProfile = (stageNumber: number) => ({
  race_id: RACE_ID, stage_number: stageNumber, profile_type: "flat", finale_type: null,
  distance_km: 180, elevation_gain_m: 300, climbs: [], sprints: [], sectors: [], weather: null,
});

/** Mocker loebet, stage-roles (som den rigtige server) og team-orders. Returnerer ordre-PUT'erne. */
async function mockRace(page: Page, { failOrderStage = null as number | null } = {}): Promise<OrderPut[]> {
  let served: Override[] = [];
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute(LIVE_RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, Array.from({ length: STAGES }, (_, i) => flatProfile(i + 1))));
  await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, []));
  await page.route(`**/api/races/${RACE_ID}/stage-roles`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() === "PUT") {
      const body = JSON.parse(request.postData() || "{}") as { stages?: number[]; overrides?: Override[] };
      const written = body.stages ?? [];
      served = [...served.filter((o) => !written.includes(o.stage_number)), ...(body.overrides ?? []).filter((o) => written.includes(o.stage_number))];
      return json(route, { ok: true });
    }
    return json(route, {
      enabled: true, intention_enabled: true, valid_efforts: FIVE_STEPS,
      stages_completed: 1, stage_count: STAGES, riders: RIDERS, overrides: served, role_scope_choice: false,
    });
  });
  const puts: OrderPut[] = [];
  const failed: number[] = [];
  await page.route(`**/api/races/${RACE_ID}/team-orders**`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() === "PUT") {
      const stage = Number(new URL(request.url()).pathname.split("/").pop());
      if (stage === failOrderStage && !failed.includes(stage)) {
        failed.push(stage);
        return route.fulfill({ status: 500, contentType: "application/json", headers: corsHeaders(request), body: JSON.stringify({ error: "team_orders_save_failed" }) });
      }
      puts.push({ stage, body: JSON.parse(request.postData() || "{}") });
      return json(route, { ok: true });
    }
    return json(route, {
      stage_count: STAGES, stages_completed: 1, riders: RIDERS,
      stages: Array.from({ length: STAGES }, (_, i) => ({ stage_number: i + 1, locked: i === 0, scheduled_at: null })),
      orders: [],
      stage_plan_enabled: false,
    });
  });
  return puts;
}

async function openTactics(page: Page): Promise<Locator> {
  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);
  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();
  await expect(visible(panel.getByRole("button", { name: "Intentioner for etape 2", exact: true }))).toHaveAttribute("aria-pressed", "true");
  return panel;
}

const stageButton = (panel: Locator, n: number) => visible(panel.getByRole("button", { name: `Intentioner for etape ${n}`, exact: true }));
const breakFor = (panel: Locator, name: string) => visible(panel.getByRole("button", { name: `${name} forsøger at komme med i udbruddet` }));

test("taktik (#8381): ordrer aendret paa en anden etape sendes med, og 'ikke gemt' ses fra alle etaper", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const puts = await mockRace(page);
  const panel = await openTactics(page);

  // Ordrer paa etape 2, derefter skift til etape 3 uden at gemme.
  await breakFor(panel, "Rider Two").click();
  await stageButton(panel, 3).click();

  // Kladden paa etape 2 er stadig ugemt: fanen siger det, og Gem kan trykkes.
  await expect(visible(panel.getByText("Du har ikke-gemte ændringer"))).toBeVisible();
  const save = visible(panel.getByRole("button", { name: "Gem etape 3" }));
  await expect(save).toBeEnabled();

  // En aendring paa etape 3 ogsaa, saa Gem gaar afsted med begge etapers kladde.
  await visible(panel.getByRole("button", { name: "Sæt intention" })).click();
  await visible(panel.getByRole("button", { name: /^Alt ud/ })).click();
  await save.click();
  await expect(visible(panel.getByText("Intentionerne er gemt."))).toBeVisible();

  const byStage = Object.fromEntries(puts.map((p) => [p.stage, p.body]));
  expect(Object.keys(byStage).map(Number).sort()).toEqual([2, 3]);
  expect(byStage[2].riders.find((r) => r.rider_id === "r2")?.try_break).toBe(true);
  expect(byStage[3].riders.find((r) => r.rider_id === "r1")?.effort).toBe("all_out");
  await expect(panel.getByText("Du har ikke-gemte ændringer").filter({ visible: true })).toHaveCount(0);
});

test("taktik (#8381): kun ordrer paa en anden etape kan gemmes fra den aabne", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const puts = await mockRace(page);
  const panel = await openTactics(page);

  await breakFor(panel, "Rider Two").click();
  await stageButton(panel, 3).click();
  await visible(panel.getByRole("button", { name: "Gem etape 3" })).click();
  await expect(visible(panel.getByText("Intentionerne er gemt."))).toBeVisible();
  expect(puts.map((p) => p.stage)).toEqual([2]);
});

test("taktik (#8381): fejler een etapes ordre, staar Gemt ikke, og kun den manglende sendes igen", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const puts = await mockRace(page, { failOrderStage: 2 });
  const panel = await openTactics(page);

  await breakFor(panel, "Rider Two").click();
  await stageButton(panel, 3).click();
  await visible(panel.getByRole("button", { name: "Sæt intention" })).click();
  await visible(panel.getByRole("button", { name: /^Alt ud/ })).click();
  await visible(panel.getByRole("button", { name: "Gem etape 3" })).click();

  const box = panel.getByTestId("tactics-save-status");
  await expect(box.getByText("Kun en del af planen blev gemt")).toBeVisible();
  await expect(box.getByTestId("tactics-save-part-orders")).toHaveAttribute("data-saved", "false");
  await expect(panel.getByText("Intentionerne er gemt.").filter({ visible: true })).toHaveCount(0);
  expect(puts.map((p) => p.stage)).toEqual([3]);

  await visible(panel.getByRole("button", { name: "Gem resten" })).click();
  await expect(visible(panel.getByText("Intentionerne er gemt."))).toBeVisible();
  expect(puts.map((p) => p.stage)).toEqual([3, 2]);
});
