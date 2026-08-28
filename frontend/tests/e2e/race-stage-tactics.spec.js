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
  evidenceShotPath,
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

// Faelles mock-opsaetning for begge tests: samme live 3-etapes loeb, samme
// stage-roles-kontekst. Returnerer en getter til den sidst opfangede PUT-body.
async function mockTacticsRace(page) {
  let capturedBody = null;
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? LIVE_STAGE_RACE : [LIVE_STAGE_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, LIVE_RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, []));

  // Selection-panel er ikke denne tests fokus — falder tilbage til fixtures'
  // generiske SEED_SELECTION (matcher enhver /api/races/:id/selection).

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

  return () => capturedBody;
}

test("etape-taktik-matrix: låst kørt etape + redigerbare etaper + førertrøje-genvej + gem", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  const getBody = await mockTacticsRace(page);

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  // #2637 fjernede det statiske "Trup låst"-panel (skadede ryttere skal kunne
  // fjernes under live løb — selection-panelet renderer nu selv i frozen-tilstand).
  // Testens ærinde er matrixen; det gamle frysnings-assert var bundet til den
  // fjernede besked og er derfor udgået (fejlede i CI efter #2653-merget).
  //
  // #3914: mens løbet stadig køres (race.status==="scheduled") ligger etape-
  // taktik-matrixen nu i en default-lukket CollapsibleSection ("Etape-taktik")
  // sammen med holdudtagelsen — udfold den via <summary>-klik (native <details>,
  // ingen ekstra ARIA) før vi kan interagere med matrixen.
  await page.locator("summary", { hasText: "Etape-taktik" }).click();

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
  const capturedBody = getBody();
  expect(capturedBody).not.toBeNull();
  expect(capturedBody.overrides).toEqual([
    { stage_number: 2, rider_id: "r1", race_role: "helper", effort: "normal" },
    { stage_number: 2, rider_id: "r2", race_role: "captain", effort: "normal" },
    { stage_number: 3, rider_id: "r1", race_role: "helper", effort: "normal" },
    { stage_number: 3, rider_id: "r2", race_role: "captain", effort: "normal" },
  ]);
});

// #4344: rolle-dropdownen — den vej hullet faktisk gik. Basis-kaptajnen (Rider
// One) er urørt, spilleren gør Rider Two til kaptajn på etape 2. Før fixet blev
// KUN Rider Two sendt, backendens tælling så 1 kaptajn, og motoren fik 2.
test("#4344: ny kaptajn via dropdownen degraderer den forrige og sender begge rækker", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const getBody = await mockTacticsRace(page);

  await login(page);
  await page.goto(`/races/${RACE_ID}`);
  await page.locator("summary", { hasText: "Etape-taktik" }).click();

  const matrix = page.getByTestId("stage-role-matrix");
  await expect(matrix).toBeVisible();

  const riderOneRow = matrix.locator("tr", { hasText: "Rider One" });
  const riderTwoRow = matrix.locator("tr", { hasText: "Rider Two" });

  // Udgangspunkt: Rider One er basis-kaptajn på begge redigerbare etaper.
  await expect(riderOneRow.getByRole("combobox").nth(0)).toHaveValue("captain");

  // Spilleren vælger Rider Two som kaptajn på etape 2 (første rolle-select i rækken).
  await riderTwoRow.getByRole("combobox").nth(0).selectOption("captain");

  // Rollen FLYTTER: Rider One er nu hjælper på etape 2, men urørt på etape 3.
  await expect(riderTwoRow.getByRole("combobox").nth(0)).toHaveValue("captain");
  await expect(riderOneRow.getByRole("combobox").nth(0)).toHaveValue("helper");
  await expect(riderOneRow.getByRole("combobox").nth(2)).toHaveValue("captain");

  // Ændringen er ikke tavs — spilleren får at vide hvem der mistede rollen.
  await expect(matrix.getByText(/Rollen flyttede: Rider One er nu Kun rytter på etape 2/i)).toBeVisible();

  await matrix.screenshot({ path: evidenceShotPath(`pr-screens/4344-captain-moves-not-duplicates-${testInfo.project.name}.png`) });

  const saveBtn = matrix.getByRole("button", { name: /gem taktik/i });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(matrix.getByText(/taktikken er gemt/i)).toBeVisible();

  // Kernen i fixet: BEGGE rækker er nu i payloaden, så backendens guard kan se
  // at der kun er én kaptajn tilbage på etapen.
  expect(getBody().overrides).toEqual([
    { stage_number: 2, rider_id: "r1", race_role: "helper", effort: "normal" },
    { stage_number: 2, rider_id: "r2", race_role: "captain", effort: "normal" },
  ]);
});
