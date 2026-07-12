import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRiderRaces } from "./riderResultsTab.js";
import { buildTrophyCase, careerTotals, raceAchievements, seasonHonours } from "./riderPalmares.js";

// Samme fixture-form som riderResultsTab.test.js (ægte prod-shape,
// verificeret 2026-07-03) + team_name (#1993-snapshot) og en 2. sæson med et
// endagsløbs-sejr + en 3.-plads, så podie/season-honours-stier dækkes.
const stageRace = { id: "vb", name: "Vuelta Burgalesa", race_type: "stage_race", race_class: "ProSeries", stages: 5, status: "completed", scheduled_for: "2026-06-29T18:00:00Z", season: { number: 1 }, pool: { terrain_archetype: "mountain_tour" } };
const single = { id: "ge", name: "Giro Emiliano", race_type: "single", race_class: "ProSeries", stages: 1, status: "completed", scheduled_for: "2026-07-02T18:00:00Z", season: { number: 1 }, pool: { terrain_archetype: "puncheur" } };
const s2Win = { id: "s2w", name: "Trofeo Alba", race_type: "single", race_class: "Class1", stages: 1, status: "completed", scheduled_for: "2026-08-10T18:00:00Z", season: { number: 2 }, pool: { terrain_archetype: "flat_sprint" } };
const s2Third = { id: "s2t", name: "Coppa Meridiana", race_type: "single", race_class: "Class2", stages: 1, status: "completed", scheduled_for: "2026-08-20T18:00:00Z", season: { number: 2 }, pool: { terrain_archetype: "hilly_classic" } };
const s2Midfield = { id: "s2m", name: "Circuit Nord", race_type: "single", race_class: "Class2", stages: 1, status: "completed", scheduled_for: "2026-08-25T18:00:00Z", season: { number: 2 }, pool: { terrain_archetype: "flat_sprint" } };

const ROWS = [
  { race: stageRace, result_type: "gc", stage_number: 5, rank: 1, points_earned: 260, prize_money: 19500, team_name: "Team Alpine" },
  { race: stageRace, result_type: "stage", stage_number: 1, rank: 22, points_earned: 0, prize_money: 0, team_name: "Team Alpine" },
  { race: stageRace, result_type: "stage", stage_number: 2, rank: 2, points_earned: 32, prize_money: 2400, team_name: "Team Alpine" },
  { race: stageRace, result_type: "stage", stage_number: 4, rank: 1, points_earned: 43, prize_money: 3225, team_name: "Team Alpine" },
  { race: stageRace, result_type: "stage", stage_number: 5, rank: 1, points_earned: 43, prize_money: 3225, team_name: "Team Alpine" },
  { race: stageRace, result_type: "stage", stage_number: 3, rank: 2, points_earned: 32, prize_money: 2400, team_name: "Team Alpine" },
  { race: stageRace, result_type: "points", stage_number: 5, rank: 1, points_earned: 107, prize_money: 8025, team_name: "Team Alpine" },
  { race: stageRace, result_type: "mountain", stage_number: 5, rank: 1, points_earned: 107, prize_money: 8025, team_name: "Team Alpine" },
  { race: stageRace, result_type: "young", stage_number: 5, rank: 1, points_earned: 53, prize_money: 3975, team_name: "Team Alpine" },
  { race: stageRace, result_type: "leader", stage_number: 3, rank: 1, points_earned: 5, prize_money: 375, team_name: "Team Alpine" },
  { race: stageRace, result_type: "mountain_day", stage_number: 4, rank: 1, points_earned: 3, prize_money: 225, team_name: "Team Alpine" },
  { race: single, result_type: "gc", stage_number: 1, rank: 4, points_earned: 80, prize_money: 6000, team_name: "Team Alpine" },
  { race: s2Win, result_type: "gc", stage_number: 1, rank: 1, points_earned: 60, prize_money: 4500, team_name: "Roubaix Racing" },
  { race: s2Third, result_type: "gc", stage_number: 1, rank: 3, points_earned: 25, prize_money: 1200, team_name: "Roubaix Racing" },
  { race: s2Midfield, result_type: "gc", stage_number: 1, rank: 14, points_earned: 4, prize_money: 0, team_name: "Roubaix Racing" },
];

test("buildTrophyCase: GC-sejr, etapesejre, trøjer, trøjedage, podier", () => {
  const trophy = buildTrophyCase(groupRiderRaces(ROWS));
  assert.equal(trophy.gcWins, 1, "Vuelta Burgalesa samlet-sejr (stage_race)");
  assert.equal(trophy.oneDayWins, 1, "Trofeo Alba (single)");
  assert.equal(trophy.stageWins, 2, "etape 4 + 5");
  assert.equal(trophy.jerseyWins, 3, "point + bjerg + ungdom");
  assert.equal(trophy.jerseyDays, 2, "1 leder-dag + 1 bjerg-dag");
  assert.deepEqual(trophy.jerseyDaysByType, { leader: 1, mountain_day: 1, points_day: 0, young_day: 0 });
  assert.equal(trophy.podiums, 3, "VB-sejr + Trofeo Alba-sejr + Coppa Meridiana 3.-plads (Giro Emiliano 4. tæller ikke)");
});

test("careerTotals: win-rate er careerWins/antal løb, ikke pr. etape", () => {
  const totals = careerTotals(groupRiderRaces(ROWS));
  assert.equal(totals.totalRaces, 5);
  assert.equal(totals.careerWins, 2, "GC-sejr + endagssejr — IKKE etapesejre");
  assert.equal(totals.podiums, 3);
  assert.equal(totals.jerseyWins, 3);
  assert.equal(totals.winRatePct, 40, "2/5 = 40%");
});

test("raceAchievements: win/podie/etapesejr/trøje udledes korrekt", () => {
  const races = groupRiderRaces(ROWS);
  const vb = races.find((r) => r.raceId === "vb");
  const ge = races.find((r) => r.raceId === "ge");
  const s2t = races.find((r) => r.raceId === "s2t");

  const vbAch = raceAchievements(vb);
  assert.ok(vbAch.some((a) => a.type === "gcWin"));
  assert.ok(vbAch.some((a) => a.type === "stageWin" && a.stage === 4));
  assert.ok(vbAch.some((a) => a.type === "stageWin" && a.stage === 5));
  assert.ok(vbAch.some((a) => a.type === "jerseyWin" && a.jersey === "points"));

  assert.deepEqual(raceAchievements(ge), [], "4.-plads i endagsløb er ingen ære");
  assert.deepEqual(raceAchievements(s2t), [{ type: "podium", rank: 3 }]);
});

test("seasonHonours: kun løb med achievements, grupperet pr. sæson m. holdnavn", () => {
  const honours = seasonHonours(groupRiderRaces(ROWS));
  assert.equal(honours.length, 2);
  assert.equal(honours[0].season, 2, "nyeste sæson først");
  assert.deepEqual(honours[0].teamNames, ["Roubaix Racing"]);
  assert.equal(honours[0].races.length, 2, "s2Win + s2Third — s2Midfield (14. plads) er ingen ære");

  assert.equal(honours[1].season, 1);
  assert.deepEqual(honours[1].teamNames, ["Team Alpine"]);
  assert.equal(honours[1].races.length, 1, "kun Vuelta Burgalesa — Giro Emiliano (4.) er ingen ære");
});

test("tom input giver tomme/neutrale resultater, ikke fejl", () => {
  assert.deepEqual(buildTrophyCase([]), {
    gcWins: 0, oneDayWins: 0, stageWins: 0, jerseyWins: 0, jerseyDays: 0,
    jerseyDaysByType: { leader: 0, mountain_day: 0, points_day: 0, young_day: 0 },
    podiums: 0,
  });
  assert.deepEqual(careerTotals([]), {
    totalRaces: 0, careerWins: 0, podiums: 0, jerseyWins: 0, winRatePct: 0, points: 0, prize: 0,
  });
  assert.deepEqual(seasonHonours([]), []);
});
