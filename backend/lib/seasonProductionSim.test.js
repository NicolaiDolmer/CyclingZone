import test from "node:test";
import assert from "node:assert/strict";
import {
  assignSeasonFields,
  computeRacesEnteredByRider,
  aggregateRunTotals,
  aggregateSeasonSamples,
} from "./seasonProductionSim.js";
import { PRIZE_PER_POINT } from "./economyConstants.js";

const ab = (over = {}) => ({
  climbing: 50, time_trial: 50, sprint: 50, punch: 50, endurance: 50,
  cobblestone: 50, acceleration: 50, recovery: 50, tactics: 50, positioning: 50,
  flat: 50, tempo: 50, durability: 50, aggression: 50, descending: 50,
  ...over,
});
const flatStage = { stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };

function riders(ids) {
  return ids.map((rider_id) => ({ rider_id, abilities: ab(), fatigue: 0 }));
}

// ── assignSeasonFields ───────────────────────────────────────────────────────

test("assignSeasonFields: division-filter — kun hold i løbets division kommer i betragtning", () => {
  const races = [
    { id: "raceA", race_type: "single", league_division_id: "D1", stages: [flatStage], game_days: [1] },
  ];
  const teamsByDivision = new Map([
    ["D1", ["t1"]],
    ["D2", ["t2"]], // t2 er i en anden division — må ALDRIG optræde i raceA
  ]);
  const ridersByTeam = new Map([
    ["t1", riders(["r1", "r2"])],
    ["t2", riders(["r9", "r10"])],
  ]);

  const { entrantsByRaceId } = assignSeasonFields({ races, teamsByDivision, ridersByTeam });
  const entrants = entrantsByRaceId.get("raceA");
  assert.ok(entrants);
  assert.ok(entrants.every((e) => e.team_id === "t1"));
  assert.ok(!entrants.some((e) => e.rider_id === "r9" || e.rider_id === "r10"));
});

test("assignSeasonFields: 1 rytter = 1 løb/dag — busy-set blokerer samme dag på tværs af løb", () => {
  // raceA og raceB deler game_day 100. Team t1 har kun 2 ryttere → raceA opbruger
  // hele rosteret (default sizeRule max=8 ≥ 2 → picks begge), så raceB (samme
  // division, samme dag) skal IKKE kunne tildele t1 nogen ryttere.
  const races = [
    { id: "raceA", race_type: "single", league_division_id: "D1", stages: [flatStage], game_days: [100] },
    { id: "raceB", race_type: "single", league_division_id: "D1", stages: [flatStage], game_days: [100] },
  ];
  const teamsByDivision = new Map([["D1", ["t1"]]]);
  const ridersByTeam = new Map([["t1", riders(["r1", "r2"])]]);

  const { entrantsByRaceId, stats } = assignSeasonFields({ races, teamsByDivision, ridersByTeam });
  assert.ok(entrantsByRaceId.has("raceA"));
  assert.equal(entrantsByRaceId.get("raceA").length, 2);
  // raceB fik intet felt (t1 er fuldt optaget) → udelades helt af outputtet.
  assert.ok(!entrantsByRaceId.has("raceB"));
  assert.equal(stats.skipped_no_entrants, 1);
});

test("assignSeasonFields: etapeløb optager ryttere på ALLE sine game_days, ikke kun den første", () => {
  // raceC spænder dag 200-201. raceD ligger KUN på dag 201 (overlap med raceC's
  // sidste dag) — t1's ryttere (alle brugt af raceC) skal stadig være utilgængelige
  // for raceD, selvom raceD's eneste dag ikke er raceC's FØRSTE dag.
  const races = [
    { id: "raceC", race_type: "stage_race", league_division_id: "D1", stages: [flatStage, { ...flatStage, stage_number: 2 }], game_days: [200, 201] },
    { id: "raceD", race_type: "single", league_division_id: "D1", stages: [flatStage], game_days: [201] },
  ];
  const teamsByDivision = new Map([["D1", ["t1"]]]);
  const ridersByTeam = new Map([["t1", riders(["r1", "r2", "r3"])]]);

  const { entrantsByRaceId } = assignSeasonFields({ races, teamsByDivision, ridersByTeam });
  assert.ok(entrantsByRaceId.has("raceC"));
  assert.ok(!entrantsByRaceId.has("raceD"));
});

test("assignSeasonFields: ledige ryttere (ikke optaget) kan stadig bruges i et senere overlappende løb", () => {
  // t1 har 10 ryttere. raceE (dag 300, Class1 → sizeRule {min:6,max:6}) tager 6.
  // raceF (også dag 300, samme division) kan så bruge de resterende 4.
  const races = [
    { id: "raceE", race_type: "single", race_class: "Class1", league_division_id: "D1", stages: [flatStage], game_days: [300] },
    { id: "raceF", race_type: "single", race_class: "Class1", league_division_id: "D1", stages: [flatStage], game_days: [300] },
  ];
  const teamsByDivision = new Map([["D1", ["t1"]]]);
  const ridersByTeam = new Map([["t1", riders(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"])]]);

  const { entrantsByRaceId } = assignSeasonFields({ races, teamsByDivision, ridersByTeam });
  const eIds = new Set(entrantsByRaceId.get("raceE").map((e) => e.rider_id));
  const fIds = new Set(entrantsByRaceId.get("raceF").map((e) => e.rider_id));
  assert.equal(eIds.size, 6);
  assert.equal(fIds.size, 4);
  // Uanset eksakt sizeRule: de to felter må aldrig overlappe (busy-set-invariant).
  for (const id of eIds) assert.ok(!fIds.has(id));
});

test("assignSeasonFields: races uden division/stage-profiler/schedule skippes og tælles i stats", () => {
  const races = [
    { id: "raceNoDiv", race_type: "single", league_division_id: null, stages: [flatStage], game_days: [1] },
    { id: "raceNoStages", race_type: "single", league_division_id: "D1", stages: [], game_days: [1] },
    { id: "raceNoSchedule", race_type: "single", league_division_id: "D1", stages: [flatStage], game_days: [] },
    { id: "raceNoTeams", race_type: "single", league_division_id: "D9", stages: [flatStage], game_days: [1] },
  ];
  const teamsByDivision = new Map([["D1", ["t1"]]]); // D9 har ingen hold
  const ridersByTeam = new Map([["t1", riders(["r1"])]]);

  const { entrantsByRaceId, stats } = assignSeasonFields({ races, teamsByDivision, ridersByTeam });
  assert.equal(entrantsByRaceId.size, 0);
  assert.equal(stats.skipped_no_division, 1);
  assert.equal(stats.skipped_no_stages_or_schedule, 2);
  assert.equal(stats.skipped_no_candidate_teams, 1);
});

test("assignSeasonFields: deterministisk — samme input giver samme output ved gentagne kald", () => {
  const races = [
    { id: "raceA", race_type: "single", league_division_id: "D1", stages: [flatStage], game_days: [1] },
    { id: "raceB", race_type: "single", league_division_id: "D1", stages: [flatStage], game_days: [2] },
  ];
  const teamsByDivision = new Map([["D1", ["t1", "t2"]]]);
  const ridersByTeam = new Map([
    ["t1", riders(["r1", "r2", "r3"])],
    ["t2", riders(["r4", "r5", "r6"])],
  ]);

  const run1 = assignSeasonFields({ races, teamsByDivision, ridersByTeam });
  const run2 = assignSeasonFields({ races, teamsByDivision, ridersByTeam });
  assert.deepEqual(
    [...run1.entrantsByRaceId.get("raceA")].map((e) => e.rider_id).sort(),
    [...run2.entrantsByRaceId.get("raceA")].map((e) => e.rider_id).sort(),
  );
});

// ── computeRacesEnteredByRider ───────────────────────────────────────────────

test("computeRacesEnteredByRider: tæller løb pr. rytter på tværs af flere løb", () => {
  const entrantsByRaceId = new Map([
    ["raceA", [{ rider_id: "r1", team_id: "t1" }, { rider_id: "r2", team_id: "t1" }]],
    ["raceB", [{ rider_id: "r1", team_id: "t1" }]],
  ]);
  const counts = computeRacesEnteredByRider(entrantsByRaceId);
  assert.equal(counts.get("r1"), 2);
  assert.equal(counts.get("r2"), 1);
  assert.equal(counts.has("r3"), false);
});

// ── aggregateRunTotals / aggregateSeasonSamples ──────────────────────────────

test("aggregateRunTotals: ekskluderer hold-rækker (rider_id=null)", () => {
  const runsResultRows = [
    [
      { rider_id: "r1", team_id: "t1", points_earned: 10, prize_money: 750 },
      { rider_id: null, team_id: "t1", points_earned: 999, prize_money: 999 * PRIZE_PER_POINT }, // hold-række
    ],
  ];
  const [totals] = aggregateRunTotals(runsResultRows);
  assert.equal(totals.size, 1);
  assert.deepEqual(totals.get("r1"), { points: 10, prize: 750 });
});

test("aggregateSeasonSamples: mean/sd/percentiler over K runs + kollinearitet e_prize=75×e_points", () => {
  const runsResultRows = [
    [{ rider_id: "r1", team_id: "t1", points_earned: 10, prize_money: 10 * PRIZE_PER_POINT }],
    [{ rider_id: "r1", team_id: "t1", points_earned: 20, prize_money: 20 * PRIZE_PER_POINT }],
    // run 2: r1 scorer intet (ingen række for r1 i det hele taget) — skal stadig tælle som 0.
    [{ rider_id: "someone_else", team_id: "t2", points_earned: 5, prize_money: 5 * PRIZE_PER_POINT }],
  ];
  const racesEnteredByRider = new Map([["r1", 7]]);

  const out = aggregateSeasonSamples({ runsResultRows, racesEnteredByRider });
  const r1 = out.get("r1");
  assert.ok(r1);
  assert.equal(r1.races_entered, 7); // taget direkte fra racesEnteredByRider, IKKE talt fra rows
  assert.equal(r1.e_points, 10); // mean([10,20,0]) = 10
  assert.equal(r1.e_prize, 750); // mean([750,1500,0]) = 750
  assert.equal(r1.e_prize, r1.e_points * PRIZE_PER_POINT); // eksakt kollinearitet, ikke kun "ca."
  // population-sd af [750,1500,0] omkring mean 750: sqrt(((0² + 750² + 750²) / 3)) ≈ 612.37
  assert.ok(Math.abs(r1.sd_prize - 612.3724356957945) < 1e-9);
  assert.equal(r1.p10_prize, 0);
  assert.equal(r1.p50_prize, 750);
  assert.equal(r1.p90_prize, 1500);
  // "someone_else" er IKKE i racesEnteredByRider → må ikke optræde i output
  // (kun ryttere assignSeasonFields faktisk tildelte et løb indgår).
  assert.equal(out.has("someone_else"), false);
});

test("aggregateSeasonSamples: rytter tildelt et løb men uden en eneste træffer over K runs → alt 0, ikke udeladt", () => {
  const runsResultRows = [
    [{ rider_id: "other", team_id: "t9", points_earned: 1, prize_money: PRIZE_PER_POINT }],
    [{ rider_id: "other", team_id: "t9", points_earned: 1, prize_money: PRIZE_PER_POINT }],
  ];
  const racesEnteredByRider = new Map([["r_never_scores", 3]]);

  const out = aggregateSeasonSamples({ runsResultRows, racesEnteredByRider });
  const r = out.get("r_never_scores");
  assert.ok(r);
  assert.equal(r.e_points, 0);
  assert.equal(r.e_prize, 0);
  assert.equal(r.sd_prize, 0);
  assert.equal(r.p10_prize, 0);
  assert.equal(r.p50_prize, 0);
  assert.equal(r.p90_prize, 0);
});

test("aggregateSeasonSamples: K=0 (ingen runs) → tom Map, ingen division-by-zero-krak", () => {
  const out = aggregateSeasonSamples({ runsResultRows: [], racesEnteredByRider: new Map([["r1", 5]]) });
  assert.equal(out.size, 0);
});

test("aggregateSeasonSamples: racesEnteredByRider=0 for en rytter udelades (defensivt — bør ikke forekomme i praksis)", () => {
  const out = aggregateSeasonSamples({ runsResultRows: [[]], racesEnteredByRider: new Map([["r1", 0]]) });
  assert.equal(out.has("r1"), false);
});
