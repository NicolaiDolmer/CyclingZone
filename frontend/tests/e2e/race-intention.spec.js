// Løbsdagens intention (#4632, variant B) — intentions-fladen på RaceDetailPage.
// Afløser race-stage-tactics.spec.js (#2034's etape-taktik-matrix), som testede
// de rolle-/indsats-dropdowns variant B fjerner.
//
// Tre tilstande dækkes, fordi de er tre forskellige flader:
//   1. Etapeløb midt i afviklingen: etape-vælger med låste kørte etaper, den
//      udfoldede vælger med FEM trin, og et gem der kun sender de ryttere der
//      er ændret — uden at tabe en intention på en anden kommende etape.
//   2. Flaget OFF: serveren sender kun tre værdier, og fladen viser TRE trin.
//   3. Endagsløb: ingen etape-vælger, kolonnen hedder "løbsdag".
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

const FIVE_STEPS = ["grupetto", "save", "normal", "protect", "all_out"];
// Serverens OFF-vokabular står bevidst i sin EGEN rækkefølge (raceRoles.
// VALID_EFFORTS) — fladen skal selv sortere det til skala-rækkefølge.
const THREE_STEPS = ["protect", "normal", "save"];

const RIDERS = [
  { rider_id: "r1", name: "Rider One", race_role: "captain", abandoned: false },
  { rider_id: "r2", name: "Rider Two", race_role: "helper", abandoned: false },
];

function raceFixture({ stages, stagesCompleted, raceType }) {
  return {
    id: RACE_ID,
    name: "E2E Intention Race",
    race_type: raceType,
    race_class: "OtherWorldTourA",
    stages,
    stages_completed: stagesCompleted,
    edition_year: 2026,
    status: "scheduled",
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
async function mockIntentionRace(page, { race, validEfforts, overrides = [], results = [] }) {
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

test("intention: etape-vælger, femtrins-vælger og et gem der ikke taber andre etaper", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  const getBody = await mockIntentionRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    // Etape 3 har allerede en gemt intention. Spilleren rører KUN etape 2 —
    // den må stadig være med i payloaden (PUT'en er REPLACE for alt kommende).
    overrides: [{ stage_number: 3, rider_id: "r2", race_role: "helper", effort: "save" }],
    results: LIVE_RESULTS,
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  // #3914: mens løbet køres ligger fladen i en default-lukket CollapsibleSection.
  await page.locator("summary", { hasText: "Løbsdagens intention" }).click();

  const panel = page.getByTestId("race-intention-panel");
  await expect(panel).toBeVisible();

  // Etape 1 er kørt: låst i vælgeren. Etape 2 er dagens og står åben.
  await expect(panel.getByRole("button", { name: /^Etape 1$/ })).toBeDisabled();
  const stageTwo = panel.getByRole("button", { name: /Etape 2 · i dag/ });
  await expect(stageTwo).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByText("Intention · etape 2")).toBeVisible();

  // Rollen er ren visning — ingen vælger for den.
  await expect(panel.getByRole("combobox")).toHaveCount(0);

  // "Ikke valgt" er en synlig tilstand, ikke et tomt felt.
  await expect(panel.getByText("Intet valgt. Han kører sin rolle.").first()).toBeVisible();

  // Udfold vælgeren for Rider One: fem trin, hver med sin sætning i ord.
  const riderOne = panel.locator("tr", { hasText: "Rider One" }).first();
  await riderOne.getByRole("button", { name: "Sæt intention" }).click();
  const picker = panel.locator("tr", { hasText: "Rider One" }).first();
  for (const label of ["Grupetto", "Kør roligt", "Normal", "Arbejd eller angrib", "Alt ud"]) {
    await expect(picker.getByRole("button", { name: new RegExp(label) }).first()).toBeVisible();
  }
  await expect(panel.getByText("Rollens standard").first()).toBeVisible();

  await panel.screenshot({ path: evidenceShotPath(`pr-screens/4632-intention-picker-${testInfo.project.name}.png`) });

  await picker.getByRole("button", { name: /Alt ud/ }).first().click();
  await expect(panel.getByText("Standard: kaptajn. I dag: alt ud.")).toBeVisible();

  // Siden må ikke overflowe vandret (#1834-mønster).
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "siden må ikke overflowe vandret").toBeLessThanOrEqual(1);

  const saveBtn = panel.getByRole("button", { name: "Gem etape 2" });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(panel.getByText("Intentionerne er gemt.")).toBeVisible();

  // Kun den ændrede rytter på etape 2 — OG etape 3's eksisterende intention,
  // som et REPLACE-gem ellers ville slette.
  expect(getBody().overrides).toEqual([
    { stage_number: 2, rider_id: "r1", race_role: "captain", effort: "all_out" },
    { stage_number: 3, rider_id: "r2", race_role: "helper", effort: "save" },
  ]);
});

test("intention: flaget OFF giver TRE trin på fladen", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockIntentionRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 0, raceType: "stage_race" }),
    validEfforts: THREE_STEPS,
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  const panel = page.getByTestId("race-intention-panel");
  await expect(panel).toBeVisible();

  const riderOne = panel.locator("tr", { hasText: "Rider One" }).first();
  await riderOne.getByRole("button", { name: "Sæt intention" }).click();

  for (const label of ["Kør roligt", "Normal", "Arbejd eller angrib"]) {
    await expect(riderOne.getByRole("button", { name: new RegExp(label) }).first()).toBeVisible();
  }
  // De to yderpunkter findes ikke når flaget er off — fladen må ikke tilbyde et
  // valg backenden afviser.
  await expect(riderOne.getByRole("button", { name: /Grupetto/ })).toHaveCount(0);
  await expect(riderOne.getByRole("button", { name: /Alt ud/ })).toHaveCount(0);
});

test("intention: endagsløb har ingen etape-vælger", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockIntentionRace(page, {
    race: raceFixture({ stages: 1, stagesCompleted: 0, raceType: "single" }),
    validEfforts: FIVE_STEPS,
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  const panel = page.getByTestId("race-intention-panel");
  await expect(panel).toBeVisible();

  await expect(panel.getByText("Intention · løbsdag")).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Etape \d/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Gem løbsdagen" })).toBeVisible();
  // Der er ingen næste etape at kopiere til.
  await expect(panel.getByRole("button", { name: /^Kopiér til etape/ })).toHaveCount(0);

  await panel.screenshot({ path: evidenceShotPath(`pr-screens/4632-intention-one-day-${testInfo.project.name}.png`) });
});
