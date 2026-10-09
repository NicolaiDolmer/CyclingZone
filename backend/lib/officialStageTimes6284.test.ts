import test from "node:test";
import assert from "node:assert/strict";
import { rankedFromV4Output } from "./raceEngineV4Bridge.js";
import { accumulateStageRows, formatGap, rankByCumTimeAsc } from "./raceClassifications.js";
import { CURRENT_RACE_RULES_REVISION, isKnownRulesRevision, ordersGcGeneration, resolveRaceRulesRevision } from "./raceEngineRulesRevision.ts";

const revision = "official_times_v1";
// Synthetic official arrivals, including a tied group and excluded outcomes.
const output = { results: [
  { rider_id: "r-a", rank: 1, time_seconds: 12000, status: "finished" },
  { rider_id: "r-b", rank: 2, time_seconds: 14223.4, status: "finished" },
  { rider_id: "r-c", rank: 3, time_seconds: 14223.4, status: "finished" },
  { rider_id: "r-out", rank: 4, time_seconds: 16000, status: "otl" },
  { rider_id: "r-dnf", rank: 5, time_seconds: 0, status: "abandoned" },
] };

test("future official revision preserves arrivals through saved rows and resumed GC", () => {
  const ranked = rankedFromV4Output(output, { rulesRevision: revision });
  assert.deepEqual(ranked.map((r) => [r.rider_id, r.rank, r.stageGap]), [
    ["r-a", 1, 0], ["r-b", 2, 2223], ["r-c", 3, 2223],
  ]);
  const rows = ranked.map((r) => ({ ...r, stage_number: 1, finish_time: formatGap(r.stageGap), bonus_seconds: r.rank === 1 ? 7 : 0, sprint_points: 0, kom_points: 0 }));
  const saved = JSON.parse(JSON.stringify(rows));
  const next = ranked.map((r) => ({ ...r, stage_number: 2, finish_time: formatGap(r.stageGap), bonus_seconds: 0, sprint_points: 0, kom_points: 0 }));
  const resumed = accumulateStageRows({ stageRows: [...saved, ...next] });
  assert.equal(resumed.cumTime.get("r-b"), 4446);
  assert.equal(resumed.cumTime.get("r-a"), -7);
  assert.deepEqual(rankByCumTimeAsc(ranked, resumed.cumTime, resumed.posSum).map((r) => r.rider_id), ["r-a", "r-b", "r-c"]);
  assert.equal(resumed.cumTime.has("r-out"), false);
});

test("legacy revisions retain their existing capped ranked bytes", () => {
  const original = rankedFromV4Output(output);
  for (const rulesRevision of ["legacy", "orders_gc_v1", "orders_gc_v2", "orders_gc_v3"]) {
    assert.deepEqual(rankedFromV4Output(output, { rulesRevision }), original);
  }
  assert.equal(original[1].stageGap, 1800);
});

test("official_times_v1 branches from v2 mechanics and is never the activation default", () => {
  assert.equal(isKnownRulesRevision(revision), true);
  assert.equal(ordersGcGeneration(revision), 2);
  assert.notEqual(CURRENT_RACE_RULES_REVISION, revision);
  assert.equal(resolveRaceRulesRevision({ race: { stages_completed: 0 }, firstStageClaim: true, storedRevision: null, currentRevision: revision }), revision);
  for (const storedRevision of ["legacy", "orders_gc_v1", "orders_gc_v2", "orders_gc_v3"]) {
    assert.equal(resolveRaceRulesRevision({ race: { stages_completed: 1 }, firstStageClaim: true, storedRevision, currentRevision: revision }), storedRevision);
  }
  assert.equal(resolveRaceRulesRevision({ race: { stages_completed: 1 }, firstStageClaim: true, storedRevision: null, currentRevision: revision }), "legacy");
});
