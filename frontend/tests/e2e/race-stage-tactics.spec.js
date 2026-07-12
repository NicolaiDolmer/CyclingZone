// Race Engine v3 (#2224), slice S3 (#2034) — etape-taktik-matrixen på
// RaceDetailPage. Mocker et LIVE 3-etapes løb (stages_completed=1, status
// forbliver "scheduled" — deriveRaceStatus regner det som "live"), så testen
// dækker BÅDE den låste etape (kørt) og de to redigerbare etaper, samt at
// panelet vises SAMTIDIG med "Lineup locked"-beskeden (#2034 punkt 2: matrixen
// erstattes ikke af lineup-frysningen, den styrer kun kommende etaper).
//
// Mønster følger race-selection.spec.js: stabilizePage → installNetworkMocks →
// spec-specifikke overrides (LIFO) → login → goto.
import { test, expect } from "@playwright/test";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  json,
  corsHeaders,
} from "./fixtures.js";

const RACE_ID = "00000000-0000-4000-8000-000000002034";

const LIVE_STAGE_RACE = {
  id: RACE_ID,
  name: "E2E Tactics Tour",
  race_type: "stage_race",
  race_class: "OtherWorldTourA",
  stages: 3,
  stages_completed: 1,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

// Etape 1 (kørt) leader-klassement — 2 rækker gør stillingen "fuld" for
// buildLiveStandings (#2081). Rider Two (ikke basis-kaptajn) fører, så
// førertrøje-genvejen bliver meningsfuld at teste.
const LIVE_RESULTS = [
  { id: "res-1", stage_number: 1, result_type: "leader", rank: 1, rider_id: "r2", rider_name: "Rider Two", team_id: "team-e2e", team_name: "E2E Team", finish_time: "+0:00" },
  { id: "res-2", stage_number: 1, result_type: "leader", rank: 2, rider_id: "r1", rider_name: "Rider One", team_id: "team-e2e", team_name: "E2E Team", finish_time: "+0:12" },
];

const STAGE_ROLES_RIDERS = [
  { rider_id: "r1", name: "Rider One", race_role: "captain" },
  { rider_id: "r2", name: "Rider Two", race_role: "helper" },
];

// Etape 1 (kørt) har en gemt override — bruges til at assertere den låste
// visning. Etape 2/3 er urørte (viser basis-rollen).
const STAGE_ROLES_OVERRIDES = [
  { stage_number: 1, rider_id: "r1", race_role: "captain", effort: "protect" },
];

test("etape-taktik-matrix: låst kørt etape + redigerbare etaper + førertrøje-genvej + gem", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? LIVE_STAGE_RACE : [LIVE_STAGE_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, LIVE_RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, []));

  // Selection-panel er ikke denne tests fokus — falder tilbage til fixtures'
  // generiske SEED_SELECTION (matcher enhver /api/races/:id/selection).

  let capturedBody = null;
  await page.route(`**/api/races/${RACE_ID}/stage-roles`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() === "PUT") {
      try {
        capturedBody = JSON.parse(request.postData() || "{}");
      } catch {
        capturedBody = {};
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders(request),
        body: JSON.stringify({ ok: true }),
      });
    }
    // GET — samme svar før og efter gem (nok til at bekræfte re-fetch sker uden at fejle).
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        stages_completed: LIVE_STAGE_RACE.stages_completed,
        stage_count: LIVE_STAGE_RACE.stages,
        riders: STAGE_ROLES_RIDERS,
        overrides: STAGE_ROLES_OVERRIDES,
      }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  // Lineup-frysningsbeskeden vises (løbet er live) — OG matrixen vises SAMTIDIG.
  await expect(page.getByText(/trup låst/i)).toBeVisible();

  const matrix = page.getByTestId("stage-role-matrix");
  await expect(matrix).toBeVisible();

  // Etape 1 er kørt/låst: viser resolveret rolle som stille tekst (kaptajn +
  // "protect"-effort-override), ingen <select> for den kolonne.
  await expect(matrix.getByText(/Kaptajn/).first()).toBeVisible();

  // Etape 2/3 er redigerbare — 2 selects pr. rytter pr. etape = 4 rytter-rækker
  // × 2 etaper × 2 selects = 8 comboboxe.
  await expect(matrix.getByRole("combobox")).toHaveCount(8);

  // Førertrøje-genvej: Rider Two fører GC efter etape 1 (mine ryttere) → knap tilbudt.
  const jerseyBtn = matrix.getByRole("button", { name: /Rider Two.*kaptajn/i });
  await expect(jerseyBtn).toBeVisible();
  await jerseyBtn.click();

  // Efter genvejen: Rider Two er kaptajn, Rider One demoteret til helper — på
  // BEGGE redigerbare etaper (2 og 3). Selects for rytter-rækkerne opdateres i draft.
  const riderOneRow = matrix.locator("tr", { hasText: "Rider One" });
  const riderTwoRow = matrix.locator("tr", { hasText: "Rider Two" });
  // Rolle-select er ALTID den første af de to comboboxe pr. celle (rolle, effort).
  await expect(riderOneRow.getByRole("combobox").nth(0)).toHaveValue("helper");
  await expect(riderOneRow.getByRole("combobox").nth(2)).toHaveValue("helper");
  await expect(riderTwoRow.getByRole("combobox").nth(0)).toHaveValue("captain");
  await expect(riderTwoRow.getByRole("combobox").nth(2)).toHaveValue("captain");

  // Forward-guard (#1834-mønster): matrixen ligger i en overflow-x-auto-container,
  // så SIDEN selv må ikke overflowe vandret på mobil.
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "siden må ikke overflowe vandret på mobil").toBeLessThanOrEqual(1);

  // Gem — knappen aktiveres af den dirty draft-state genvejen satte.
  const saveBtn = matrix.getByRole("button", { name: /gem taktik/i });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();

  await expect(matrix.getByText(/taktikken er gemt/i)).toBeVisible();

  // PUT-payload: KUN afvigelser fra basis-rolle (REPLACE-semantik, #2034
  // kontrakt) — 4 rækker (r1+r2 × etape 2+3), sorteret stage asc, rider_id asc.
  expect(capturedBody).not.toBeNull();
  expect(capturedBody.overrides).toEqual([
    { stage_number: 2, rider_id: "r1", race_role: "helper", effort: "normal" },
    { stage_number: 2, rider_id: "r2", race_role: "captain", effort: "normal" },
    { stage_number: 3, rider_id: "r1", race_role: "helper", effort: "normal" },
    { stage_number: 3, rider_id: "r2", race_role: "captain", effort: "normal" },
  ]);
});
