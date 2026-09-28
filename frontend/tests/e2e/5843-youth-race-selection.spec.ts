// #5843: managers skal selv kunne se og udtage til U23- og juniorløb.
//
// Spillervejen: U23 team / Junior team → Calendar-fanen viser holdets ungdomsløb
// → rækken åbner den eksisterende løbsside på Hold-fanen → samme udtagelsespanel
// som senior → gem. Løbet er auto-udtaget af AI'en på forhånd (prod 28/9), og
// testen beviser at den auto-udfyldte trup kan ændres før start.
//
// Mocks: Supabase-læsningerne bag Calendar (teams' ungdomspuljer, aktiv sæson,
// puljens løb, etape-slots, holdets entries) + GET/PUT /api/races/:id/selection.
// Senest registrerede route vinder over installNetworkMocks' generiske mocks.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders } from "./fixtures.js";
import { previewYouthSquadsPayload, previewYouthRiderRows } from "../../src/preview/youthSquadsMock.ts";
import type { Page, Route } from "@playwright/test";

const U23_POOL = 901;
const JUNIOR_POOL = 911;

const CASES = [
  {
    squad: "u23" as const,
    pool: U23_POOL,
    race: { id: "00000000-0000-4000-8000-000000005843", name: "E2E U23 Classic", race_type: "single", race_class: "U23", stages: 1 },
    doneRace: { id: "00000000-0000-4000-8000-000000058431", name: "E2E U23 Opener", race_type: "single", race_class: "U23", stages: 1 },
  },
  {
    squad: "junior" as const,
    pool: JUNIOR_POOL,
    race: { id: "00000000-0000-4000-8000-000000005844", name: "E2E Junior Tour", race_type: "stage_race", race_class: "Junior", stages: 3 },
    doneRace: { id: "00000000-0000-4000-8000-000000058441", name: "E2E Junior Prologue", race_type: "single", race_class: "Junior", stages: 1 },
  },
];

const RIDERS = Array.from({ length: 8 }, (_, i) => ({
  id: `youth-r${i}`, name: `Youth Rider ${i}`, suitability: 70 - i, form: 55, fatigue: 10, injured: false,
}));
const AUTO_PICK = RIDERS.slice(0, 6).map((r) => r.id);

function preflight(route: Route): boolean {
  const request = route.request();
  if (request.method() !== "OPTIONS") return false;
  void route.fulfill({ status: 204, headers: corsHeaders(request) });
  return true;
}

function wantsObject(route: Route): boolean {
  return (route.request().headers().accept || "").includes("vnd.pgrst.object");
}

async function setup(page: Page, c: (typeof CASES)[number]) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const scheduled = { ...c.race, stages_completed: 0, status: "scheduled", edition_year: 2026, season: { id: "season-e2e", number: 4 }, pool_race: null };
  const done = { ...c.doneRace, stages_completed: c.doneRace.stages, status: "completed", edition_year: 2026, season: { id: "season-e2e", number: 4 }, pool_race: null };

  await page.route("**/api/display-flags", (route) => {
    if (preflight(route)) return;
    return json(route, { rider_best_role_display: false, youth_squad_pages: true });
  });
  await page.route("**/api/youth-squads", (route) => {
    if (preflight(route)) return;
    return json(route, previewYouthSquadsPayload());
  });
  await page.route("**/rest/v1/riders*", (route) => {
    if (preflight(route)) return;
    const rows = previewYouthRiderRows(route.request().url());
    return rows ? json(route, rows) : route.fallback();
  });
  await page.route("**/rest/v1/teams*", (route) => {
    if (preflight(route)) return;
    if (!route.request().url().includes("u23_league_division_id")) return route.fallback();
    const row = { id: "team-e2e", u23_league_division_id: U23_POOL, junior_league_division_id: JUNIOR_POOL };
    return json(route, wantsObject(route) ? row : [row]);
  });
  await page.route("**/rest/v1/seasons*", (route) => {
    if (preflight(route)) return;
    const url = route.request().url();
    if (!url.includes("status=eq.active") || !url.includes("select=id&")) return route.fallback();
    return json(route, wantsObject(route) ? { id: "season-e2e" } : [{ id: "season-e2e" }]);
  });
  await page.route("**/rest/v1/races*", (route) => {
    if (preflight(route)) return;
    const url = decodeURIComponent(route.request().url());
    if (url.includes(`league_division_id=eq.${c.pool}`)) return json(route, [done, scheduled]);
    if (url.includes(`id=eq.${c.race.id}`)) return json(route, wantsObject(route) ? scheduled : [scheduled]);
    return route.fallback();
  });
  await page.route("**/rest/v1/race_stage_schedule*", (route) => {
    if (preflight(route)) return;
    const url = decodeURIComponent(route.request().url());
    if (!url.includes(c.race.id)) return route.fallback();
    const stages = Array.from({ length: c.race.stages }, (_, i) => ({
      race_id: c.race.id, stage_number: i + 1, scheduled_at: `2026-09-${28 + i}T17:30:00+00:00`,
    }));
    return json(route, [{ race_id: c.doneRace.id, stage_number: 1, scheduled_at: "2026-09-27T17:30:00+00:00" }, ...stages]);
  });
  await page.route("**/rest/v1/race_entries*", (route) => {
    if (preflight(route)) return;
    const url = decodeURIComponent(route.request().url());
    if (!url.includes(c.race.id)) return route.fallback();
    return json(route, AUTO_PICK.map(() => ({ race_id: c.race.id, is_auto_filled: true })));
  });
  await page.route("**/rest/v1/race_results*", (route) => json(route, []));

  const captured: { body: Record<string, unknown> | null } = { body: null };
  await page.route(`**/api/races/${c.race.id}/selection`, (route) => {
    if (preflight(route)) return;
    const request = route.request();
    if (request.method() === "PUT") {
      captured.body = JSON.parse(request.postData() || "{}");
      return json(route, { ok: true });
    }
    return json(route, {
      enabled: true,
      eligible: true,
      withdrawn: false,
      race: scheduled,
      size: { min: 4, max: 6 },
      selection: {
        rider_ids: AUTO_PICK, captain_id: AUTO_PICK[0], sprint_captain_id: null, hunter_id: null,
        free_role_ids: [], is_auto_filled: true, manual_rider_ids: [],
      },
      riders: RIDERS,
      availableCount: RIDERS.length,
      bound_riders: [],
    });
  });
  return captured;
}

for (const c of CASES) {
  test(`#5843 ${c.squad}: se → åbn → udtag → gem`, async ({ page }) => {
    const captured = await setup(page, c);
    await login(page);
    await page.goto(`/squads/${c.squad}`);

    // Se: Calendar-fanen viser løbet, med AI'ens auto-udtagelse synlig.
    await page.getByRole("tablist").getByRole("tab", { name: /Calendar|Kalender/ }).click();
    const row = page.getByTestId(`youth-race-row-${c.race.id}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(c.race.name);
    await expect(row).toContainText(/auto-picked|auto-udtaget/);
    // Det afsluttede løb står i Results, ikke i Calendar.
    await expect(page.getByTestId(`youth-race-row-${c.doneRace.id}`)).toHaveCount(0);

    // Åbn: rækkens handling fører til løbssidens Hold-fane.
    await page.getByTestId(`youth-race-action-${c.race.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/races/${c.race.id}\\?tab=team`));
    const panel = page.getByTestId("race-selection-panel");
    await expect(panel).toBeVisible();

    // Udtag: den auto-udfyldte trup kan ændres (Youth Rider 5 ud, 6 ind).
    await panel.getByRole("checkbox", { name: /Youth Rider 5/ }).uncheck();
    await panel.getByRole("checkbox", { name: /Youth Rider 6/ }).check();

    // Gem.
    const saveBtn = panel.getByRole("button", { name: /gem udtagelse|save selection/i });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(panel.getByText(/udtagelsen er gemt|selection saved/i)).toBeVisible();

    expect(captured.body).not.toBeNull();
    const ids = (captured.body?.rider_ids ?? []) as string[];
    expect(ids).toContain("youth-r6");
    expect(ids).not.toContain("youth-r5");
  });

  test(`#5843 ${c.squad}: Results-fanen viser det afsluttede løb med link til resultatet`, async ({ page }) => {
    await setup(page, c);
    await login(page);
    await page.goto(`/squads/${c.squad}`);
    await page.getByRole("tablist").getByRole("tab", { name: /Results|Resultater/ }).click();
    const row = page.getByTestId(`youth-race-row-${c.doneRace.id}`);
    await expect(row).toBeVisible();
    await expect(page.getByTestId(`youth-race-action-${c.doneRace.id}`)).toHaveAttribute("href", `/races/${c.doneRace.id}?tab=results`);
    await expect(page.getByTestId(`youth-race-row-${c.race.id}`)).toHaveCount(0);
  });
}
