import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, raceResultsRoute, evidenceShotPath } from "./fixtures.js";

// #5123 (@thelamba 8/9): "jeg kan ikke se etaperesultatet paa telefonen" — fandt
// det kun via kalenderen. Kortlægning (PR-body): løbssidens Overblik-fane
// (den fane man lander på uden et ?stage=-deep-link, fx via Planlægning/Race
// Centre) havde INGEN vej til den seneste etapes EGET resultat — kun det
// samlede/endelige klassement var ét klik væk ("Åbn resultater" → "Samlet").
// Etaper-fanen åbnede desuden altid på etape 1, uanset hvor langt løbet var
// nået. Denne spec beviser den KORTESTE vej efter fixet, på mobile-chromium
// (393×852, samme viewport som produktionens 390px-mål) OG desktop/webkit
// (ingen viewport-specifik UI ændret — samme fix gælder alle bredder).

function rider(id, first, last) {
  return { id, firstname: first, lastname: last, nationality_code: "dk", team: { id: "team-x", name: "Team X" } };
}

function row(id, stage_number, result_type, rank, r, points = 0, finish_time = null) {
  return {
    id, stage_number, result_type, rank,
    rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`,
    team_id: r.team.id, team_name: r.team.name,
    finish_time, points_earned: points, prize_money: 0, rider: r,
    in_breakaway: false, breakaway_caught: false,
  };
}

const ADA = rider("rider-1", "Ada", "Pedersen");
const MIK = rider("rider-2", "Mikkel", "Hansen");

const STAGE_PROFILES = [
  { stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint" },
  { stage_number: 2, profile_type: "hilly", finale_type: null },
  { stage_number: 3, profile_type: "mountain", finale_type: "long_climb" },
];

// Etape 1 + 2 målrækkefølge (etape 2 er den senest KØRTE — race.stages_completed
// nedenfor). Etape 3 er hverken kørt eller resultat-hentet.
const RESULTS_DURING = [
  row("r1", 1, "stage", 1, ADA, 100, "+0:00"),
  row("r2", 1, "stage", 2, MIK, 80, "+0:12"),
  row("j1", 1, "leader", 1, ADA, 0),
  row("r3", 2, "stage", 1, MIK, 100, "+0:00"),
  row("r4", 2, "stage", 2, ADA, 80, "+0:07"),
  row("j2", 2, "leader", 1, MIK, 0),
];

async function mockRace(page, race, results) {
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? race : [race]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute(results));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, STAGE_PROFILES));
  await page.route("**/rest/v1/race_stage_passages**", (route) => json(route, []));
}

// UNDER løbet: 3 etaper i alt, 2 kørt — race_type stage_race, status stadig
// "scheduled" (backendens tilstandsmaskine, #1825: status skifter først ved
// helt-færdigt løb).
const RACE_DURING = {
  id: "race-e2e-5123-during",
  name: "E2E Vuelta 5123",
  race_type: "stage_race",
  race_class: "TourFrance",
  stages: 3,
  stages_completed: 2,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

test("during a race, Overblik links straight to the latest stage's OWN result, not just Samlet (#5123)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockRace(page, RACE_DURING, RESULTS_DURING);

  await login(page);
  await page.goto("/races/race-e2e-5123-during");

  // Lander på Overblik (fasens første fane) — INGEN ?stage= i URL'en, præcis
  // situationen efter et klik fra Planlægning/Race Centre (ikke et dybt link).
  await expect(page.getByRole("heading", { name: "E2E Vuelta 5123" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overblik", selected: true })).toBeVisible();

  // #5123-fixet: en direkte, navngivet vej til DEN seneste etapes eget
  // resultat — ikke kun den løbende samlede stilling ("Sådan står du").
  const stageResultCta = page.getByRole("button", { name: "Resultat af etape 2" });
  await expect(stageResultCta).toBeVisible();

  if (test.info().project.name === "mobile-chromium") {
    await page.screenshot({ path: evidenceShotPath("pr-screens/5123-before-overview-mobile.png") });
  }

  await stageResultCta.click();

  // Ét klik → Resultater-fanen, etape 2 valgt, etape 2's egen målrækkefølge
  // synlig. Ingen omvej via kalenderen.
  await expect(page).toHaveURL(/tab=results/);
  await expect(page).toHaveURL(/stage=2/);
  await expect(page.getByRole("tab", { name: "Resultater", selected: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Etape 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Etape 2 · målrækkefølge")).toBeVisible();

  if (test.info().project.name === "mobile-chromium") {
    await page.screenshot({ path: evidenceShotPath("pr-screens/5123-after-stage-result-mobile.png") });
  }
});

test("Etaper-fanen åbner på den senest kørte etape, ikke altid etape 1 (#5123)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockRace(page, RACE_DURING, RESULTS_DURING);

  await login(page);
  await page.goto("/races/race-e2e-5123-during");

  // Skift til Etaper-fanen UDEN noget ?stage= i URL'en (samme "klikkede sig
  // derhen"-situation som ovenfor).
  await page.getByRole("tab", { name: "Etaper" }).click();
  await expect(page).not.toHaveURL(/stage=/);

  // Før #5123-fixet åbnede stripen altid på etape 1 uanset løbets fremdrift.
  await expect(page.getByRole("button", { name: "Etape 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Etape 1" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Etape 3" })).toHaveAttribute("aria-pressed", "false");
});

// EFTER løbet: samme fixture, men helt kørt (stages_completed === stages,
// status "completed") — "Sådan endte det" har allerede en primær "Åbn
// resultater"-knap til det ENDELIGE samlede klassement; #5123 tilføjer en
// sekundær vej til den SIDSTE etapes eget resultat, som er et andet spørgsmål.
const RACE_AFTER = { ...RACE_DURING, id: "race-e2e-5123-after", stages_completed: 3, status: "completed" };
const RESULTS_AFTER = [
  ...RESULTS_DURING,
  row("r5", 3, "stage", 1, ADA, 100, "+0:00"),
  row("r6", 3, "stage", 2, MIK, 80, "+0:20"),
  row("g1", 3, "gc", 1, ADA, 0, "+0:00"),
  row("g2", 3, "gc", 2, MIK, 0, "+0:09"),
];

test("after a race, Overblik links straight to the FINAL stage's own result, not just Samlet (#5123)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockRace(page, RACE_AFTER, RESULTS_AFTER);

  await login(page);
  await page.goto("/races/race-e2e-5123-after");

  await expect(page.getByRole("tab", { name: "Overblik", selected: true })).toBeVisible();
  // Den EKSISTERENDE primære vej til det samlede slut-klassement er uændret.
  await expect(page.getByRole("button", { name: "Åbn resultater" })).toBeVisible();

  // Den NYE sekundære vej til etapens eget resultat (#5123).
  const stageResultCta = page.getByRole("button", { name: "Resultat af etape 3" });
  await expect(stageResultCta).toBeVisible();
  await stageResultCta.click();

  await expect(page).toHaveURL(/tab=results/);
  await expect(page).toHaveURL(/stage=3/);
  await expect(page.getByRole("button", { name: "Etape 3" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Etape 3 · målrækkefølge")).toBeVisible();
});
