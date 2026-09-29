import { test } from "node:test";
import assert from "node:assert/strict";

import { recomputeTeamRowsForRace, buildReport } from "./recompute-5952-team-classification.js";

const gc = (rider, team, rank) => ({ id: `gc-${rider}`, race_id: "r1", stage_number: 1, result_type: "gc", rank, rider_id: rider, team_id: team, finish_time: "+0:00" });
const teamRow = (team, rank, points = 0) => ({ id: `t-${team}`, race_id: "r1", stage_number: 1, result_type: "team", rank, team_id: team, team_name: team, points_earned: points, prize_money: points * 1000 });

// Spillerens eksempel: alle +0:00, Slipstream (9/19/24) blev sat bag Breakaway (29/45/49).
const oneDayResults = [
  gc("s1", "Slipstream", 9), gc("s2", "Slipstream", 19), gc("s3", "Slipstream", 24),
  gc("b1", "Breakaway", 29), gc("b2", "Breakaway", 45), gc("b3", "Breakaway", 49),
  teamRow("Breakaway", 1, 10), teamRow("Slipstream", 2, 5),
];

test("#5952 recompute: endagsløb flytter holdene og følger point/præmie med placeringen", () => {
  const out = recomputeTeamRowsForRace({
    race: { race_type: "single", squad: "senior" },
    results: oneDayResults,
    pointsLookup: { team__1: 10, team__2: 5 },
  });
  assert.equal(out.status, "ok");
  const byTeam = Object.fromEntries(out.changes.map((c) => [c.team_id, c]));
  assert.equal(byTeam.Slipstream.new_rank, 1);
  assert.equal(byTeam.Slipstream.new_points, 10);
  assert.equal(byTeam.Breakaway.new_rank, 2);
  assert.equal(byTeam.Breakaway.new_points, 5);
});

test("#5952 recompute: baseline-vagten stopper et løb hvis den gamle regel ikke genskaber de gemte placeringer", () => {
  const tampered = oneDayResults.map((r) => (r.result_type === "team" ? { ...r, rank: r.team_id === "Breakaway" ? 2 : 1 } : r));
  // Gemt: Slipstream 1 (allerede "rigtigt"), men den gamle regel siger Breakaway 1 -> ukendt kilde, rør ikke.
  const out = recomputeTeamRowsForRace({ race: { race_type: "single" }, results: tampered, pointsLookup: {} });
  assert.equal(out.status, "baseline_mismatch");
  assert.equal(out.changes.length, 0);
});

test("#5952 recompute: udbetalte løb optælles separat og markeres paid", () => {
  const report = buildReport({
    races: [{ id: "r1", name: "Klassiker", race_type: "single", race_class: "C1", prize_paid_at: "2026-09-29T18:00:00Z", squad: "senior" }],
    results: oneDayResults,
    profiles: [],
    racePoints: [],
  });
  assert.equal(report.summary.paid_races_not_touched, 1);
  assert.equal(report.summary.unpaid_races_to_apply, 0);
  assert.equal(report.races[0].paid, true);
});
