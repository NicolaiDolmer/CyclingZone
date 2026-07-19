import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatGap,
  parseGapSeconds,
  accumulateStageRows,
  filterCompletedEntrants,
  classPointsForRank,
  teamClassification,
} from "./raceClassifications.js";

// ── parseGapSeconds / formatGap roundtrip ─────────────────────────────────────
test("parseGapSeconds er invers af formatGap (afrundede sekunder)", () => {
  for (const s of [0, 1, 59, 60, 61, 599, 600, 3599, 3600, 5025]) {
    assert.equal(parseGapSeconds(formatGap(s)), s, `roundtrip for ${s}s`);
  }
});

test("parseGapSeconds: defensiv på null/PCM-rækker uden finish_time", () => {
  assert.equal(parseGapSeconds(null), 0);
  assert.equal(parseGapSeconds(undefined), 0);
  assert.equal(parseGapSeconds(""), 0);
  assert.equal(parseGapSeconds("garbage"), 0);
  assert.equal(parseGapSeconds("+2:05"), 125);
  assert.equal(parseGapSeconds("2:05"), 125); // uden plus accepteres
});

// ── accumulateStageRows ───────────────────────────────────────────────────────
const PROFILES = new Map([[1, "flat"], [2, "mountain"], [3, "flat"]]);

function row(stage, rider, rank, gap) {
  return { stage_number: stage, result_type: "stage", rank, rider_id: rider, finish_time: gap };
}

test("akkumulering: cumTime = sum af parsede gaps, posSum = sum af ranks", () => {
  const acc = accumulateStageRows({
    stageRows: [row(1, "x", 1, "+0:00"), row(1, "y", 2, "+1:30"), row(2, "x", 3, "+2:00"), row(2, "y", 1, "+0:00")],
    profileTypeByStage: PROFILES,
  });
  assert.equal(acc.cumTime.get("x"), 120);
  assert.equal(acc.cumTime.get("y"), 90);
  assert.equal(acc.posSum.get("x"), 4);
  assert.equal(acc.posSum.get("y"), 3);
  assert.deepEqual([...acc.stageNumbers].sort(), [1, 2]);
});

test("KOM-point kun på klatre-etaper; point-konkurrence på alle", () => {
  const acc = accumulateStageRows({
    stageRows: [row(1, "x", 1, "+0:00"), row(2, "x", 1, "+0:00")], // flat + mountain
    profileTypeByStage: PROFILES,
  });
  assert.equal(acc.pointsComp.get("x"), 2 * classPointsForRank(1));
  assert.equal(acc.komComp.get("x"), classPointsForRank(1)); // kun mountain-etapen
});

test("rækker uden rider_id ignoreres (team-rækker o.l. kan aldrig forurene)", () => {
  const acc = accumulateStageRows({
    stageRows: [{ stage_number: 1, rank: 1, rider_id: null, finish_time: "+0:00" }],
    profileTypeByStage: PROFILES,
  });
  assert.equal(acc.stageNumbers.size, 0);
  assert.equal(acc.cumTime.size, 0);
});

// ── filterCompletedEntrants ───────────────────────────────────────────────────
test("kun ryttere med ALLE etaper er klassements-berettigede (solgt/slettet udgår)", () => {
  const entrants = [{ rider_id: "full" }, { rider_id: "leaver" }, { rider_id: "late" }];
  const acc = accumulateStageRows({
    stageRows: [
      row(1, "full", 1, "+0:00"), row(2, "full", 1, "+0:00"),
      row(1, "leaver", 2, "+0:10"), // mangler etape 2
      row(2, "late", 2, "+0:10"),   // mangler etape 1 (mid-race-intruder)
    ],
    profileTypeByStage: PROFILES,
  });
  const completed = filterCompletedEntrants(entrants, acc.stagesByRider, acc.stageNumbers);
  assert.deepEqual(completed.map((e) => e.rider_id), ["full"]);
});

test("tomt input → tomme maps, ingen throw", () => {
  const acc = accumulateStageRows({ stageRows: [], profileTypeByStage: new Map() });
  assert.equal(acc.stageNumbers.size, 0);
  assert.deepEqual(filterCompletedEntrants([{ rider_id: "a" }], acc.stagesByRider, acc.stageNumbers), [{ rider_id: "a" }]);
});

// ── teamClassification ────────────────────────────────────────────────────────
test("teamClassification: hold med <3 fuldførende ryttere rangeres IKKE (#2694)", () => {
  // Hold A har kun 1 rytter, hold B kun 2 — ingen af dem kan vinde/rangeres.
  // Hold C har 3 → eneste rangerede hold.
  const entrants = [
    { rider_id: "a1", team_id: "A" },
    { rider_id: "b1", team_id: "B" },
    { rider_id: "b2", team_id: "B" },
    { rider_id: "c1", team_id: "C" },
    { rider_id: "c2", team_id: "C" },
    { rider_id: "c3", team_id: "C" },
  ];
  const cumTime = new Map([
    ["a1", 10], // hurtigst, men soloryttet → udgår
    ["b1", 20], ["b2", 30],
    ["c1", 100], ["c2", 110], ["c3", 120],
  ]);
  const rows = teamClassification(entrants, cumTime);
  assert.deepEqual(rows.map((r) => r.team_id), ["C"]);
  assert.equal(rows[0].rank, 1);
});

test("teamClassification: bedste-3-sum + tie-break bevaret for hold med >=3", () => {
  const entrants = [
    { rider_id: "a1", team_id: "A" }, { rider_id: "a2", team_id: "A" },
    { rider_id: "a3", team_id: "A" }, { rider_id: "a4", team_id: "A" },
    { rider_id: "b1", team_id: "B" }, { rider_id: "b2", team_id: "B" },
    { rider_id: "b3", team_id: "B" },
  ];
  const cumTime = new Map([
    ["a1", 0], ["a2", 10], ["a3", 20], ["a4", 900], // 4. rytter tæller ikke: 0+10+20=30
    ["b1", 5], ["b2", 5], ["b3", 5], // 15 → B vinder
  ]);
  const rows = teamClassification(entrants, cumTime);
  assert.deepEqual(rows.map((r) => [r.rank, r.team_id, r.time]), [[1, "B", 15], [2, "A", 30]]);
});

test("teamClassification: lige tid brydes deterministisk på team_id", () => {
  const entrants = [
    { rider_id: "z1", team_id: "Z" }, { rider_id: "z2", team_id: "Z" }, { rider_id: "z3", team_id: "Z" },
    { rider_id: "a1", team_id: "A" }, { rider_id: "a2", team_id: "A" }, { rider_id: "a3", team_id: "A" },
  ];
  const cumTime = new Map([
    ["z1", 10], ["z2", 10], ["z3", 10],
    ["a1", 10], ["a2", 10], ["a3", 10],
  ]);
  const rows = teamClassification(entrants, cumTime);
  assert.deepEqual(rows.map((r) => r.team_id), ["A", "Z"]);
});
