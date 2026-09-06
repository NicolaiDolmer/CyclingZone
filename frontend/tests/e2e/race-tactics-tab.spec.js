// Løbssidens Taktik-fane (#4613, variant A godkendt 6/9) — afløser
// race-intention.spec.js, som testede intentions-fladen (#4632) dengang den var
// et selvstændigt kort i en <details>-fold på løbssiden. Fladen er nu en FANE:
// samme intention, men med ordrerne under samme etape og ét gem.
//
// Fire ting dækkes, fordi de er #4613's egentlige løfter:
//   1. Fane-striben følger LØBETS TILSTAND (før/under/efter) — det er hele
//      pointen i variant A, og den logik er værdiløs hvis den ikke når fladen.
//   2. Etapeløb under afvikling: én etape-vælger, kørt etape er READ-ONLY
//      (åbnes, men uden gem-knap), og gemmet taber ikke en anden etapes
//      intention.
//   3. Flaget OFF: serveren sender tre værdier, fanen viser TRE trin.
//   4. Endagsløb: ingen etape-vælger, og Taktik-fanen findes kun før start.
//
// Mønster følger race-selection.spec.js: stabilizePage → installNetworkMocks →
// spec-specifikke overrides (LIFO) → login → goto.
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  evidenceShotPath,
  json,
  corsHeaders,
  raceResultsRoute,
} from "./fixtures.js";

const RACE_ID = "00000000-0000-4000-8000-000000004632";

// Fanen renderer BEGGE layouts (tabel fra sm og op, stablede kort under) og
// skjuler det ene med CSS, saa hver tekst findes to gange i DOM'en. Alle
// opslag scopes derfor til den SYNLIGE variant — samme moenster som
// race-detail-upcoming.spec.js' rute-match-assert.
const visible = (locator) => locator.filter({ visible: true }).first();

const FIVE_STEPS = ["grupetto", "save", "normal", "protect", "all_out"];
// Serverens OFF-vokabular står bevidst i sin EGEN rækkefølge (raceRoles.
// VALID_EFFORTS) — fladen skal selv sortere det til skala-rækkefølge.
const THREE_STEPS = ["protect", "normal", "save"];

const RIDERS = [
  { rider_id: "r1", name: "Rider One", race_role: "captain", abandoned: false },
  { rider_id: "r2", name: "Rider Two", race_role: "helper", abandoned: false },
];

function raceFixture({ stages, stagesCompleted, raceType, status = "scheduled" }) {
  return {
    id: RACE_ID,
    name: "E2E Tactics Race",
    race_type: raceType,
    race_class: "OtherWorldTourA",
    stages,
    stages_completed: stagesCompleted,
    edition_year: 2026,
    status,
    season: { id: "season-e2e", number: 1 },
    pool_race: null,
  };
}

// Etape 1 (kørt) leader-klassement — 2 rækker gør stillingen "fuld" for
// buildLiveStandings (#2081).
const LIVE_RESULTS = [
  { id: "res-1", stage_number: 1, result_type: "leader", rank: 1, rider_id: "r1", rider_name: "Rider One", team_id: "team-e2e", team_name: "E2E Team", finish_time: "+0:00" },
  { id: "res-2", stage_number: 1, result_type: "leader", rank: 2, rider_id: "r2", rider_name: "Rider Two", team_id: "team-e2e", team_name: "E2E Team", finish_time: "+0:12" },
];

/**
 * Mocker ét løb + dets stage-roles-kontekst. Returnerer en getter til den
 * sidst opfangede PUT-body.
 */
async function mockTacticsRace(page, { race, validEfforts, overrides = [], results = [] }) {
  let capturedBody = null;
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? race : [race]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute(results));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, []));

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
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        intention_enabled: validEfforts.length > 3,
        valid_efforts: validEfforts,
        stages_completed: race.stages_completed,
        stage_count: race.stages,
        riders: RIDERS,
        overrides,
      }),
    });
  });

  return () => capturedBody;
}

// Fane-striben er sidens egen navigation; ?tab= er dyb-linket den sætter.
const tab = (page, name) => page.getByRole("tab", { name });

test("faner: stribens indhold følger løbets tilstand (før → under → efter)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // FØR start: ingen resultater, ingen kørte etaper.
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 0, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
  });
  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  await expect(tab(page, "Overblik")).toBeVisible();
  await expect(tab(page, "Hold")).toBeVisible();
  await expect(tab(page, "Taktik")).toBeVisible();
  await expect(tab(page, "Etaper")).toBeVisible();
  // Et løb der ikke er kørt har intet resultat at vise — fanen ville være tom.
  await expect(tab(page, "Resultater")).toHaveCount(0);

  // UNDER afvikling: etape 1 kørt. Resultater kommer til, Taktik BLIVER
  // (etape 2-3 er stadig åbne at sætte).
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
  });
  await page.goto(`/races/${RACE_ID}`);

  await expect(tab(page, "Taktik")).toBeVisible();
  await expect(tab(page, "Resultater")).toBeVisible();

  // EFTER: løbet er færdigt. Taktik forsvinder — der er intet tilbage at sætte,
  // og en fane der ikke kan bruges er værre end ingen fane.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 3, raceType: "stage_race", status: "completed" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
  });
  await page.goto(`/races/${RACE_ID}`);

  await expect(tab(page, "Resultater")).toBeVisible();
  await expect(tab(page, "Hold")).toBeVisible();
  await expect(tab(page, "Taktik")).toHaveCount(0);
});

test("taktik: etape-vælger, femtrins-vælger og et gem der ikke taber andre etaper", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  const getBody = await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    // Etape 3 har allerede en gemt intention. Spilleren rører KUN etape 2 —
    // den må stadig være med i payloaden (PUT'en er REPLACE for alt kommende).
    overrides: [{ stage_number: 3, rider_id: "r2", race_role: "helper", effort: "save" }],
    results: LIVE_RESULTS,
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);

  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();

  // Etape 2 er dagens og aabner som den foerste der kan saettes.
  // Etape-knapperne baerer et eksplicit navn ("Intentioner for etape N") fordi
  // loebssidens egen etape-stribe allerede har knapper der hedder "Etape N".
  await expect(visible(panel.getByRole("button", { name: "Intentioner for etape 2, i dag" })))
    .toHaveAttribute("aria-pressed", "true");
  // Rollen gaelder hele loebet og saettes i holdudtagelsen — ingen vaelger her.
  await expect(panel.getByRole("combobox")).toHaveCount(0);

  // "Ikke valgt" er en synlig tilstand, ikke et tomt felt.
  await expect(visible(panel.getByText("Intet valgt. Han kører sin rolle."))).toBeVisible();

  // Udfold vælgeren for den foerste rytter (Rider One): fem trin, hver med sin
  // saetning i ord. Kun én vaelger kan vaere aaben ad gangen, saa trinnene
  // slaas op paa kortet som helhed.
  await visible(panel.getByRole("button", { name: "Sæt intention" })).click();
  for (const label of ["Grupetto", "Kør roligt", "Normal", "Arbejd eller angrib", "Alt ud"]) {
    await expect(visible(panel.getByRole("button", { name: new RegExp(`^${label}`) }))).toBeVisible();
  }
  await expect(visible(panel.getByText("Rollens standard", { exact: true }))).toBeVisible();

  await panel.screenshot({ path: evidenceShotPath(`pr-screens/4613-tactics-picker-${testInfo.project.name}.png`) });

  await visible(panel.getByRole("button", { name: /^Alt ud/ })).click();
  await expect(visible(panel.getByText("Standard: kaptajn. I dag: alt ud."))).toBeVisible();

  // Siden må ikke overflowe vandret (#1834-mønster).
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "siden må ikke overflowe vandret").toBeLessThanOrEqual(1);

  // ÉN guld-primær i fanen: gemmet for den AABNE etape.
  const saveBtn = visible(panel.getByRole("button", { name: "Gem etape 2" }));
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(visible(panel.getByText("Intentionerne er gemt."))).toBeVisible();

  // Kun den ændrede rytter på etape 2 — OG etape 3's eksisterende intention,
  // som et REPLACE-gem ellers ville slette.
  expect(getBody().overrides).toEqual([
    { stage_number: 2, rider_id: "r1", race_role: "captain", effort: "all_out" },
    { stage_number: 3, rider_id: "r2", race_role: "helper", effort: "save" },
  ]);
});

test("taktik: en kørt etape kan åbnes, men er read-only", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    overrides: [{ stage_number: 1, rider_id: "r1", race_role: "captain", effort: "all_out" }],
    results: LIVE_RESULTS,
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);

  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();

  // Etape 1 er kørt. Den kan aabnes — "det du sendte dem ud med" er værd at se
  // igen — men taktik kan ALDRIG saettes paa den.
  await visible(panel.getByRole("button", { name: "Intentioner for etape 1" })).click();

  await expect(visible(panel.getByText(/^Etape 1 er låst\./))).toBeVisible();
  // Ingen gem-knap, ingen kopiér-knap, ingen vaelger: fladen tilbyder ikke en
  // beslutning serveren ville afvise.
  await expect(panel.getByRole("button", { name: /^Gem etape/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /^Kopiér til etape/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Sæt intention" })).toHaveCount(0);
});

test("taktik: flaget OFF giver TRE trin på fanen", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 0, raceType: "stage_race" }),
    validEfforts: THREE_STEPS,
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);

  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();

  await visible(panel.getByRole("button", { name: "Sæt intention" })).click();

  for (const label of ["Kør roligt", "Normal", "Arbejd eller angrib"]) {
    await expect(visible(panel.getByRole("button", { name: new RegExp(`^${label}`) }))).toBeVisible();
  }
  // De to yderpunkter findes ikke når flaget er off — fanen må ikke tilbyde et
  // valg backenden afviser.
  await expect(panel.getByRole("button", { name: /^Grupetto/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /^Alt ud/ })).toHaveCount(0);
});

test("taktik: endagsløb har ingen etape-vælger, og fanen forsvinder ved start", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 1, stagesCompleted: 0, raceType: "single" }),
    validEfforts: FIVE_STEPS,
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);

  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();

  // Ingen etape-vaelger: kun ét "Løbsdag"-maerke, og kolonnen hedder loebsdag
  // (kolonne-headeren lever kun i desktop-tabellen, derfor toolbar-maerket her).
  await expect(visible(panel.getByText("Løbsdag", { exact: true }))).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Intentioner for etape/ })).toHaveCount(0);
  await expect(visible(panel.getByRole("button", { name: "Gem løbsdagen" }))).toBeVisible();
  // Der er ingen næste etape at kopiere til.
  await expect(panel.getByRole("button", { name: /^Kopiér til etape/ })).toHaveCount(0);

  await panel.screenshot({ path: evidenceShotPath(`pr-screens/4613-tactics-one-day-${testInfo.project.name}.png`) });

  // Endagsloebet har KUN den ene dag, og den laaser naar flaget falder. Naar
  // loebet er kørt, findes Taktik-fanen ikke laengere.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 1, stagesCompleted: 1, raceType: "single", status: "completed" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
  });
  await page.goto(`/races/${RACE_ID}`);

  await expect(tab(page, "Resultater")).toBeVisible();
  await expect(tab(page, "Taktik")).toHaveCount(0);
});
