import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json } from "./fixtures.js";

// #959 Etape-resultater V1 — renderer-regression for /races/:raceId.
// Mocker ét 2-etapers stage-race med etape-resultater, daglige trøjebærere og
// endelige klassementer, og verificerer faner + trøje-badges + målrækkefølge.

const RACE = {
  id: "race-e2e-1",
  name: "E2E Tour",
  race_type: "stage_race",
  race_class: "TourFrance",
  stages: 2,
  edition_year: 2026,
  status: "completed",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

function rider(id, first, last) {
  return { id, firstname: first, lastname: last, nationality_code: "dk", team: { id: "team-x", name: "Team X" } };
}

function row(id, stage_number, result_type, rank, r, points = 0, finish_time = null) {
  return {
    id, stage_number, result_type, rank,
    rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`,
    team_id: r.team.id, team_name: r.team.name,
    finish_time, points_earned: points, prize_money: 0, rider: r,
  };
}

const ADA = rider("rider-1", "Ada", "Pedersen");
const MIK = rider("rider-2", "Mikkel", "Hansen");

// #1484 stiliseret terræn-indikator: ét profil pr. etape (flad → bjerg).
const STAGE_PROFILES = [
  { stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint" },
  { stage_number: 2, profile_type: "mountain", finale_type: "long_climb" },
];

const RESULTS = [
  // Etape 1 målrækkefølge (Race Engine v2 skriver pr.-etape-gab i finish_time)
  row("r1", 1, "stage", 1, ADA, 100, "+0:00"),
  row("r2", 1, "stage", 2, MIK, 80, "+0:23"),
  // Etape 1 trøjebærere (ingen finish_time)
  row("j1", 1, "leader", 1, ADA, 0),
  row("j2", 1, "points_day", 1, MIK, 0),
  row("j3", 1, "mountain_day", 1, ADA, 0),
  row("j4", 1, "young_day", 1, ADA, 0),
  // Etape 2 målrækkefølge
  row("r3", 2, "stage", 1, MIK, 100, "+0:00"),
  row("r4", 2, "stage", 2, ADA, 80, "+0:14"),
  // Endelige klassementer (sidste etape) — gc har kumulativt gab
  row("g1", 2, "gc", 1, ADA, 0, "+0:00"),
  row("g2", 2, "gc", 2, MIK, 0, "+0:09"),
  row("p1", 2, "points", 1, MIK, 0),
  row("m1", 2, "mountain", 1, ADA, 0),
  row("y1", 2, "young", 1, ADA, 0),
  row("t1", 2, "team", 1, MIK, 0),
];

test("race detail page renders stage tabs, jerseys and overall classifications", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Override races + race_results for det specifikke detalje-load.
  await page.route("**/rest/v1/races**", route => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", route => json(route, RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, STAGE_PROFILES));

  await login(page);
  await page.goto("/races/race-e2e-1");

  // Header + faner
  await expect(page.getByRole("heading", { name: "E2E Tour" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Samlet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Etape 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Etape 2" })).toBeVisible();

  // Samlet-fane (default): alle 5 klassementer + kumulativt GC-gab (#959 gaps)
  await expect(page.getByText("Samlet (GC)")).toBeVisible();
  await expect(page.getByText("Pointkonkurrence")).toBeVisible();
  await expect(page.getByText("Bjergkonkurrence")).toBeVisible();
  await expect(page.getByText("Holdkonkurrence")).toBeVisible();
  await expect(page.getByText("+0:09")).toBeVisible();

  // Etape 1: trøje-badges + målrækkefølge + pr.-etape-gab (#959 gaps)
  await page.getByRole("button", { name: "Etape 1" }).click();
  await expect(page.getByText("Trøjer efter etapen")).toBeVisible();
  await expect(page.getByText("Fører", { exact: true })).toBeVisible();
  await expect(page.getByText("Bjerg", { exact: true })).toBeVisible();
  await expect(page.getByText("Etape 1 · målrækkefølge")).toBeVisible();
  await expect(page.getByText("+0:23")).toBeVisible();

  // #1484 terræn-indikator: etape 1 = fladt + massespurt.
  await expect(page.getByText("Terræn", { exact: true })).toBeVisible();
  await expect(page.getByText("Fladt")).toBeVisible();
  await expect(page.getByText("Massespurt")).toBeVisible();

  // Etape 2 = bjerge + bjergfinale (skifter med fanen).
  await page.getByRole("button", { name: "Etape 2" }).click();
  await expect(page.getByText("Bjerge")).toBeVisible();
  await expect(page.getByText("Bjergfinale")).toBeVisible();
});
