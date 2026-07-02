import { test } from "node:test";
import assert from "node:assert/strict";

import { parseGapSeconds, deriveTeamStandings, buildLiveStandings } from "./raceLiveStandings.js";

function leaderRow(stage, rider, rank, gap, team) {
  return { result_type: "leader", stage_number: stage, rank, rider_id: rider, team_id: team, team_name: `Team ${team}`, finish_time: gap };
}

test("parseGapSeconds: '+M:SS' → sekunder; defensiv på null/uparsebar", () => {
  assert.equal(parseGapSeconds("+0:00"), 0);
  assert.equal(parseGapSeconds("+2:05"), 125);
  assert.equal(parseGapSeconds(null), 0);
  assert.equal(parseGapSeconds("garbage"), 0);
});

test("deriveTeamStandings: sum af holdets 3 bedste gaps, lavest vinder, stabil tie-break", () => {
  const gc = [
    leaderRow(2, "a1", 1, "+0:00", "A"),
    leaderRow(2, "a2", 2, "+0:10", "A"),
    leaderRow(2, "a3", 3, "+0:20", "A"),
    leaderRow(2, "a4", 4, "+9:00", "A"), // 4. rytter tæller ikke
    leaderRow(2, "b1", 5, "+0:05", "B"),
    leaderRow(2, "b2", 6, "+0:05", "B"),
    leaderRow(2, "b3", 7, "+0:05", "B"),
  ];
  const teams = deriveTeamStandings(gc);
  // A: 0+10+20=30 · B: 5+5+5=15 → B vinder.
  assert.deepEqual(teams.map((t) => [t.rank, t.team_id]), [[1, "B"], [2, "A"]]);
  // Række-formen kan gå direkte i ResultTable (id/result_type/rank/team).
  assert.equal(teams[0].result_type, "team");
  assert.equal(teams[0].rider_id, null);
  assert.equal(teams[0].team_name, "Team B");
});

test("buildLiveStandings: bruger seneste etape med FULDE leader-rækker; legacy rank-1-etaper giver null", () => {
  // Etape 1 er legacy (kun rank-1-trøjerække) → ingen løbende stilling.
  assert.equal(buildLiveStandings([leaderRow(1, "x", 1, "+0:00", "A")]), null);

  // Etape 1 legacy + etape 2 fuld → stilling fra etape 2.
  const results = [
    leaderRow(1, "x", 1, "+0:00", "A"),
    leaderRow(2, "x", 1, "+0:00", "A"),
    leaderRow(2, "y", 2, "+0:30", "B"),
    { result_type: "points_day", stage_number: 2, rank: 1, rider_id: "y", team_id: "B", finish_time: null },
    { result_type: "stage", stage_number: 2, rank: 1, rider_id: "x", team_id: "A", finish_time: "+0:00" },
  ];
  const live = buildLiveStandings(results);
  assert.equal(live.stage, 2);
  assert.deepEqual(live.byType.gc.map((r) => r.rider_id), ["x", "y"]);
  assert.deepEqual(live.byType.points.map((r) => r.rider_id), ["y"]);
  assert.equal(live.byType.team.length, 2);
  assert.equal(live.byType.mountain.length, 0);
});

test("buildLiveStandings: tom/ingen leader-rækker → null", () => {
  assert.equal(buildLiveStandings([]), null);
  assert.equal(buildLiveStandings([{ result_type: "stage", stage_number: 1, rank: 1, rider_id: "x" }]), null);
});
