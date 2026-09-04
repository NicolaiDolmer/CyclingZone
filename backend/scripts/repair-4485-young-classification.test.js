import test from "node:test";
import assert from "node:assert/strict";

import {
  rerankU25Field,
  withPointsAndPrize,
  diffByTeam,
  standingsPoolKey,
  projectStandings,
  findNegativeBalanceRisk,
} from "./repair-4485-young-classification.js";

const REF_YEAR = 2028; // sæson 3

function rider(id, birthdate) {
  return [id, { birthdate }];
}

test("rerankU25Field: fjerner 26+ (fødselsår < referenceYear-25) og bevarer relativ orden", () => {
  const riderById = new Map([
    rider("r1", "2002-01-01"), // 26 år i 2028 — IKKE u25
    rider("r2", "2003-01-01"), // 25 år i 2028 — u25 (grænsen, ejer-beslutning 2/9+4/9)
    rider("r3", "2005-06-15"), // 23 år — u25
  ]);
  const baseRows = [
    { race_id: "race-1", stage_number: 1, rider_id: "r1", rank: 1, team_id: "t1", team_name: "Team 1" },
    { race_id: "race-1", stage_number: 1, rider_id: "r2", rank: 2, team_id: "t2", team_name: "Team 2" },
    { race_id: "race-1", stage_number: 1, rider_id: "r3", rank: 3, team_id: "t3", team_name: "Team 3" },
  ];
  const out = rerankU25Field(baseRows, riderById, REF_YEAR);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.rider_id), ["r2", "r3"]);
  assert.deepEqual(out.map((r) => r.rank), [1, 2]); // genranget 1..N, relativ orden bevaret
});

test("rerankU25Field: grupperer uafhængigt pr. (race_id, stage_number)", () => {
  const riderById = new Map([rider("r1", "2005-01-01"), rider("r2", "2005-01-01")]);
  const baseRows = [
    { race_id: "race-1", stage_number: 1, rider_id: "r1", rank: 1, team_id: "t1" },
    { race_id: "race-1", stage_number: 2, rider_id: "r2", rank: 1, team_id: "t2" },
  ];
  const out = rerankU25Field(baseRows, riderById, REF_YEAR);
  assert.equal(out.length, 2);
  assert.ok(out.find((r) => r.stage_number === 1 && r.rider_id === "r1"));
  assert.ok(out.find((r) => r.stage_number === 2 && r.rider_id === "r2"));
});

test("rerankU25Field: rytter uden birthdate-match udelades (aldrig et gæt)", () => {
  const riderById = new Map(); // tom — ingen rider fundet
  const baseRows = [{ race_id: "race-1", stage_number: 1, rider_id: "ghost", rank: 1, team_id: "t1" }];
  const out = rerankU25Field(baseRows, riderById, REF_YEAR);
  assert.equal(out.length, 0);
});

test("withPointsAndPrize: slår point op pr. (result_type, rank, race_class) og udleder prize = points*75", () => {
  const rows = [{ race_id: "race-1", stage_number: 1, rider_id: "r1", rank: 1, team_id: "t1", team_name: "Team 1" }];
  const raceClassByRaceId = new Map([["race-1", "OtherWorldTourA"]]);
  const pointsLookupByRaceClass = new Map([["OtherWorldTourA", { young__1: 106 }]]);
  const riderById = new Map([["r1", { firstname: "Ryan", lastname: "Whitfield" }]]);
  const out = withPointsAndPrize(rows, "young", raceClassByRaceId, pointsLookupByRaceClass, riderById);
  assert.equal(out.length, 1);
  assert.equal(out[0].points_earned, 106);
  assert.equal(out[0].prize_money, 106 * 75);
  assert.equal(out[0].rider_name, "Ryan Whitfield");
  assert.equal(out[0].result_type, "young");
});

test("withPointsAndPrize: manglende opslag falder tilbage til 0 point/0 kr (aldrig et gæt)", () => {
  const rows = [{ race_id: "race-1", stage_number: 1, rider_id: "r1", rank: 91, team_id: "t1" }];
  const out = withPointsAndPrize(rows, "young", new Map([["race-1", "Class1"]]), new Map([["Class1", {}]]), new Map());
  assert.equal(out[0].points_earned, 0);
  assert.equal(out[0].prize_money, 0);
});

test("diffByTeam: netto point/CZ$ = sum(nye) - sum(gamle), grupperet på team_id", () => {
  const oldRows = [
    { team_id: "t1", points_earned: 106, prize_money: 7950 }, // t1 var forkert rang 1
    { team_id: "t2", points_earned: 66, prize_money: 4950 },
  ];
  const newRows = [
    { team_id: "t2", points_earned: 106, prize_money: 7950 }, // t2 rykker op til rang 1
    { team_id: "t3", points_earned: 66, prize_money: 4950 },  // t3 ny på podiet
  ];
  const byTeam = diffByTeam(oldRows, newRows);
  assert.equal(byTeam.get("t1").pointsDelta, -106);
  assert.equal(byTeam.get("t1").czDelta, -7950);
  assert.equal(byTeam.get("t2").pointsDelta, 106 - 66);
  assert.equal(byTeam.get("t2").czDelta, 7950 - 4950);
  assert.equal(byTeam.get("t3").pointsDelta, 66);
  assert.equal(byTeam.get("t3").czDelta, 4950);
});

test("diffByTeam: rækker uden team_id ignoreres (kan ikke krediteres et hold der ikke findes)", () => {
  const byTeam = diffByTeam([{ team_id: null, points_earned: 10, prize_money: 750 }], []);
  assert.equal(byTeam.size, 0);
});

test("standingsPoolKey: pulje hvis allokeret, ellers tier-fallback", () => {
  assert.equal(standingsPoolKey({ league_division_id: "pool-1", division: 3 }), "pool:pool-1");
  assert.equal(standingsPoolKey({ league_division_id: null, division: 2 }), "tier:2");
});

test("projectStandings: genrangerer pulje-lokalt efter effective points (total - penalty), kun berørte hold i output", () => {
  const standingsRows = [
    { team_id: "t1", division: 3, league_division_id: "pool-1", total_points: 500, penalty_points: 0, rank_in_division: 2 },
    { team_id: "t2", division: 3, league_division_id: "pool-1", total_points: 480, penalty_points: 0, rank_in_division: 3 },
    { team_id: "t3", division: 3, league_division_id: "pool-1", total_points: 600, penalty_points: 0, rank_in_division: 1 },
    { team_id: "t4", division: 3, league_division_id: "pool-2", total_points: 100, penalty_points: 0, rank_in_division: 1 }, // anden pulje, uændret
  ];
  // t1 mister 106 point (skulle ikke have haft dem), t2 vinder 106 point → t2 overhaler t1.
  const teamDeltaById = new Map([
    ["t1", { pointsDelta: -106 }],
    ["t2", { pointsDelta: 106 }],
  ]);
  const out = projectStandings(standingsRows, teamDeltaById);
  assert.equal(out.length, 2); // kun t1+t2 har et delta != 0
  const t1 = out.find((r) => r.team_id === "t1");
  const t2 = out.find((r) => r.team_id === "t2");
  assert.equal(t1.new_total_points, 394);
  assert.equal(t2.new_total_points, 586);
  assert.equal(t2.new_rank_in_division, 2); // t2 overhaler t1, men ikke t3 (600)
  assert.equal(t1.new_rank_in_division, 3);
  assert.equal(t1.rank_changed, true);
  assert.equal(t2.rank_changed, true);
});

test("projectStandings: penalty_points trækkes fra i den effektive rangering", () => {
  const standingsRows = [
    { team_id: "t1", division: 4, league_division_id: null, total_points: 500, penalty_points: 50, rank_in_division: 2 },
    { team_id: "t2", division: 4, league_division_id: null, total_points: 480, penalty_points: 0, rank_in_division: 1 },
  ];
  // t1 vinder 40 point (effective 500-50+40=490), stadig under t2s 480... nej vent: 490>480, så t1 rykker op.
  const teamDeltaById = new Map([["t1", { pointsDelta: 40 }]]);
  const out = projectStandings(standingsRows, teamDeltaById);
  assert.equal(out.length, 1);
  assert.equal(out[0].new_total_points, 540);
  assert.equal(out[0].new_rank_in_division, 1);
});

test("findNegativeBalanceRisk: flager KUN hold hvor en tilbagebetaling sender balance under 0", () => {
  const teams = [
    { id: "t1", balance: 1000 },
    { id: "t2", balance: 500 },
    { id: "t3", balance: 2000 },
  ];
  const teamDeltaById = new Map([
    ["t1", { czDelta: -1500 }], // skal betale mere tilbage end de har → risiko
    ["t2", { czDelta: -500 }],  // præcis 0 tilbage → ikke negativ, ikke risiko
    ["t3", { czDelta: 300 }],   // positivt delta → aldrig en risiko
  ]);
  const risks = findNegativeBalanceRisk(teams, teamDeltaById);
  assert.equal(risks.length, 1);
  assert.equal(risks[0].team_id, "t1");
  assert.equal(risks[0].projectedBalance, -500);
});

test("findNegativeBalanceRisk: hold uden noget delta rammes aldrig", () => {
  const risks = findNegativeBalanceRisk([{ id: "t1", balance: 0 }], new Map());
  assert.equal(risks.length, 0);
});
