import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, TEST_TEAM } from "./fixtures.js";

// #3858 — Race Centre: dagens løb som sendeflade. Dækker ALLE tre kort-tilstande
// fra den godkendte mockup-kontrakt i ét load (LIVE / kommende / færdig) plus
// "Around the divisions"-striben, så en regression i tilstands-afledningen
// (lib/raceCentre.js) eller i kortets handlings-række fanges her.
//
// Klokken er fastfrosset (page.clock.setFixedTime) fordi HELE sidens tilstand er
// en funktion af (nu − scheduled_at): uden en fast nu ville de samme fixture-rækker
// give en anden kort-tilstand afhængigt af hvornår suiten kørte.
// 2026-08-17T14:30Z = 16:30 København (CEST, UTC+2).
const FROZEN_NOW = new Date("2026-08-17T14:30:00Z");

const DIVISIONS = [
  { id: 2, tier: 2, pool_index: 0, label: "Division 2 · Pool A" },
  { id: 3, tier: 3, pool_index: 1, label: "Division 3 · Pool B" },
];

// Egne løb (league_division_id = TEST_TEAM.league_division_id) + ét fremmed løb
// til divisions-striben.
const RACES = [
  // stages_completed = 5: etape 5 ER skrevet færdig af motoren, men slottet ligger
  // inde i afspilningsvinduet — det er præcis LIVE-tilstanden (deterministisk
  // afspilning, ikke realtime).
  { id: "race-live", name: "Tour de Zone", stages: 8, stages_completed: 5, status: "scheduled", race_type: "stage_race", league_division_id: TEST_TEAM.league_division_id },
  { id: "race-up", name: "Ronde van Vlaanderen", stages: 1, stages_completed: 0, status: "scheduled", race_type: "single", league_division_id: TEST_TEAM.league_division_id },
  { id: "race-done", name: "Milano Sanremo", stages: 1, stages_completed: 1, status: "completed", race_type: "single", league_division_id: TEST_TEAM.league_division_id },
  { id: "race-other", name: "Vuelta Iberica", stages: 12, stages_completed: 6, status: "scheduled", race_type: "stage_race", league_division_id: 3 },
];

const SCHEDULE = [
  // Færdig: kørt kl. 12:00 CEST, langt uden for afspilningsvinduet.
  { race_id: "race-done", stage_number: 1, scheduled_at: "2026-08-17T10:00:00Z" },
  // LIVE: slot for 15 minutter siden, etapen er skrevet færdig → afspilning i gang.
  { race_id: "race-live", stage_number: 5, scheduled_at: "2026-08-17T14:15:00Z" },
  // Kommende: kl. 19:00 CEST i dag.
  { race_id: "race-up", stage_number: 1, scheduled_at: "2026-08-17T17:00:00Z" },
  // Anden division, kommende — "Around the divisions".
  { race_id: "race-other", stage_number: 7, scheduled_at: "2026-08-17T18:00:00Z" },
];

const RESULTS = [
  { race_id: "race-done", stage_number: 1, result_type: "stage", rank: 1, rider_id: "r-win", rider_name: "Mathieu Vasseur", team_id: "team-rival" },
  { race_id: "race-done", stage_number: 1, result_type: "stage", rank: 2, rider_id: "r-mine", rider_name: "Lars Bendtsen", team_id: TEST_TEAM.id },
  { race_id: "race-done", stage_number: 1, result_type: "stage", rank: 3, rider_id: "r-third", rider_name: "Nico Ferrari", team_id: "team-rival" },
  { race_id: "race-live", stage_number: 5, result_type: "stage", rank: 1, rider_id: "r-live1", rider_name: "Tom Aalborg", team_id: "team-rival" },
  { race_id: "race-live", stage_number: 5, result_type: "stage", rank: 2, rider_id: "r-live2", rider_name: "Ivan Petrov", team_id: TEST_TEAM.id },
  { race_id: "race-live", stage_number: 5, result_type: "stage", rank: 3, rider_id: "r-live3", rider_name: "Sepp Vogel", team_id: "team-rival" },
];

// Tidslinje for LIVE-etapen (spec §2.4-kontrakten). Ved 15/30 minutter inde i
// afspilningsvinduet står afspilningen på halvvejen af de 190 km → km 95, så
// KOM-passagen ved km 92 er den seneste film-linje.
const LIVE_TIMELINE = {
  timeline_version: 1,
  stage_number: 5,
  events: [
    { km: 0, type: "stage_start", params: { field_count: 138, distance_km: 190 } },
    { km: 14, type: "breakaway_formed", params: { rider_ids: ["r-live3"] } },
    { km: 92, type: "kom_passage", params: { name: "Col du Test", category: "2", top: [{ rider_id: "r-live3", points: 5 }] } },
    { km: 160, type: "breakaway_caught", params: { rider_ids: ["r-live3"] } },
    { km: 190, type: "finish", params: { win_type: "sprint_win", top: [{ rider_id: "r-live1", rank: 1 }] } },
  ],
};

async function installRaceCentreMocks(page) {
  await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, SCHEDULE));
  await page.route("**/rest/v1/races**", (route) => json(route, RACES));
  await page.route("**/rest/v1/league_divisions**", (route) => json(route, DIVISIONS));
  await page.route("**/rest/v1/race_entries**", (route) => json(route, [
    { race_id: "race-live" }, { race_id: "race-up" }, { race_id: "race-done" },
  ]));
  await page.route("**/rest/v1/race_results**", (route) => json(route, RESULTS));

  await page.route("**/api/races/*/timeline**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (!request.url().includes("race-live")) {
      return route.fulfill({ status: 404, headers: corsHeaders(request), contentType: "application/json", body: "{}" });
    }
    return json(route, LIVE_TIMELINE);
  });

  await page.route("**/api/races/*/selection", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, { enabled: true, size: { min: 6, max: 8 }, selection: { rider_ids: ["a", "b", "c", "d", "e", "f", "g", "h"] } });
  });
}

test("race centre: live, upcoming and finished cards render for today's stages", async ({ page }) => {
  await stabilizePage(page);
  await page.clock.setFixedTime(FROZEN_NOW);
  await installNetworkMocks(page);
  await installRaceCentreMocks(page);
  await login(page);

  await page.goto("/race-centre");

  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Løbscenter" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Dine løb i dag" })).toBeVisible();

  // LIVE-kortet: rød live-badge, film-linje fra tidslinjen, gold "Se live".
  await expect(main.getByText("Tour de Zone")).toBeVisible();
  await expect(main.getByText("Live", { exact: true }).first()).toBeVisible();
  await expect(main.getByText(/Col du Test/)).toBeVisible();
  await expect(main.getByRole("link", { name: "Se live" })).toBeVisible();

  // Kommende: nedtælling + opstillings-status + ghost "Gennemgå taktik".
  await expect(main.getByText("Ronde van Vlaanderen")).toBeVisible();
  await expect(main.getByText(/Opstillingen er klar/)).toBeVisible();
  // "Gennemgå taktik" hører KUN til managerens eget løb; divisions-striben får
  // den stille indgang i stedet (gold + taktik er hans dag, ikke pressens).
  await expect(main.getByRole("link", { name: "Gennemgå taktik" })).toHaveCount(1);

  // Færdig: podie med egen rytter fremhævet + "Fuldt resultat" + løbsfilm.
  await expect(main.getByText("Milano Sanremo")).toBeVisible();
  await expect(main.getByText("Lars Bendtsen")).toBeVisible();
  await expect(main.getByText("Din rytter").first()).toBeVisible();
  await expect(main.getByRole("link", { name: "Fuldt resultat" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Se løbsfilmen" })).toBeVisible();

  // Presse-laget: løb fra andre divisioner ligger i sin egen stribe, ikke i "dine".
  await expect(main.getByRole("heading", { name: "Rundt i divisionerne" })).toBeVisible();
  await expect(main.getByText("Vuelta Iberica")).toBeVisible();
  await expect(main.getByRole("link", { name: "Se løbet" })).toHaveCount(1);

  // Screenshot til PR-dokumentation. #3554: e2e skriver KUN til test-results/.
  await page.screenshot({ path: "test-results/3858-race-centre.png", fullPage: true });
});

// #4026: udbrydere på et LIVE-kort står typisk IKKE i race_results endnu —
// navnene skal hentes via riders-opslaget (useRiderNames), og et rå UUID må
// ALDRIG nå fladen (incidenten 20/8: "Hui J. Feng, a2ffc9c9-… rykker væk").
// Fixture-id'erne er ægte UUID'er, fordi navne-hooket kun slår ægte UUID'er op.
const ESCAPEE_1 = "11111111-1111-4111-8111-111111111111";
const ESCAPEE_2 = "22222222-2222-4222-8222-222222222222";

const BREAKAWAY_TIMELINE = {
  timeline_version: 1,
  stage_number: 5,
  events: [
    { km: 0, type: "stage_start", params: { field_count: 138, distance_km: 190 } },
    // Ved 15/30 min inde i vinduet står afspilningen på km 95 → udbruddet ved
    // km 80 er den seneste film-linje (ingen af rytterne findes i RESULTS).
    { km: 80, type: "breakaway_formed", params: { rider_ids: [ESCAPEE_1, ESCAPEE_2] } },
    { km: 190, type: "finish", params: { win_type: "sprint_win", top: [{ rider_id: "r-live1", rank: 1 }] } },
  ],
};

test("race centre: live film line resolves breakaway names via riders lookup — never raw UUIDs (#4026)", async ({ page }) => {
  await stabilizePage(page);
  await page.clock.setFixedTime(FROZEN_NOW);
  await installNetworkMocks(page);
  await installRaceCentreMocks(page);
  // Registreret EFTER installRaceCentreMocks → vinder over dens timeline-route.
  await page.route("**/rest/v1/riders**", (route) => json(route, [
    { id: ESCAPEE_1, firstname: "Hugo", lastname: "Mercier" },
    { id: ESCAPEE_2, firstname: "Léo", lastname: "Fontaine" },
  ]));
  await page.route("**/api/races/*/timeline**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (!request.url().includes("race-live")) {
      return route.fulfill({ status: 404, headers: corsHeaders(request), contentType: "application/json", body: "{}" });
    }
    return json(route, BREAKAWAY_TIMELINE);
  });
  await login(page);

  await page.goto("/race-centre");

  const main = page.locator("main");
  await expect(main.getByText("Tour de Zone")).toBeVisible();
  // Navnene kommer fra riders-opslaget — ingen af de to står i race_results.
  await expect(main.getByText(/Hugo Mercier, Léo Fontaine rykker væk fra feltet/)).toBeVisible();
  // Forward-guard: intet UUID-fragment må nogensinde rendere i main.
  await expect(main.getByText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/)).toHaveCount(0);

  await page.screenshot({ path: "test-results/4026-race-centre-breakaway-names.png", fullPage: true });
});

test("race centre: empty state when the team has no stage today", async ({ page }) => {
  await stabilizePage(page);
  await page.clock.setFixedTime(FROZEN_NOW);
  await installNetworkMocks(page);
  await installRaceCentreMocks(page);
  // Ingen slots i dag → hverken egne kort eller divisions-stribe.
  await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, []));
  await login(page);

  await page.goto("/race-centre");

  const main = page.locator("main");
  await expect(main.getByText("Ingen løb for dit hold i dag")).toBeVisible();
  await expect(main.getByRole("heading", { name: "Rundt i divisionerne" })).toHaveCount(0);

  await page.screenshot({ path: "test-results/3858-race-centre-empty.png", fullPage: true });
});
