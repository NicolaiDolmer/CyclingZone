import test from "node:test";
import assert from "node:assert/strict";
import { aggregateJerseyWins } from "./seasonJerseyWins.ts";

test("aggregateJerseyWins tæller kun rank 1 i de tre trøje-typer pr. hold", () => {
  const out = aggregateJerseyWins([
    { result_type: "points", rank: 1, team_id: "A" },
    { result_type: "mountain", rank: 1, team_id: "A" },
    { result_type: "young", rank: 1, team_id: "B" },
    { result_type: "points", rank: 2, team_id: "B" },
    { result_type: "gc", rank: 1, team_id: "B" },
    { result_type: "leader", rank: 1, team_id: "B" },
    { result_type: "points", rank: 1, team_id: null },
  ]);
  assert.deepEqual(out, {
    A: { total: 2, points: 1, mountain: 1, young: 0 },
    B: { total: 1, points: 0, mountain: 0, young: 1 },
  });
});

test("aggregateJerseyWins er robust over for tom/manglende input", () => {
  assert.deepEqual(aggregateJerseyWins(null), {});
  assert.deepEqual(aggregateJerseyWins([]), {});
});
