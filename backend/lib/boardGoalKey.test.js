import test from "node:test";
import assert from "node:assert/strict";

import { buildGoalKey } from "./boardGoals.js";

// #4578 · buildGoalKey er den stabile, INDHOLDSBASEREDE mål-nøgle (mål i
// board_mandates.goals[] har aldrig haft id'er, prod-fund 2/9). Se boardGoals.js
// for den fulde begrundelse. Testene her verificerer kontrakten selve
// PR-briefen kræver: deterministisk, uafhængig af felt-rækkefølge/ekstra
// felter, og adskiller target/cumulative/nationality_code/race_scope.

test("buildGoalKey: deterministisk — samme mål giver samme nøgle hver gang", () => {
  const goal = { type: "stage_wins", target: 5, cumulative: true, category: "results" };
  const first = buildGoalKey(goal);
  const second = buildGoalKey({ ...goal });
  assert.equal(first, second);
  assert.equal(first, buildGoalKey(goal), "gentagne kald på SAMME objekt giver samme nøgle");
});

test("buildGoalKey: uafhængig af felt-rækkefølge på mål-objektet", () => {
  const a = { type: "min_riders", target: 20, cumulative: false, nationality_code: null, race_scope: null };
  const b = { race_scope: null, nationality_code: null, cumulative: false, target: 20, type: "min_riders" };
  assert.equal(buildGoalKey(a), buildGoalKey(b));
});

test("buildGoalKey: uafhængig af EKSTRA felter (label, satisfaction_*, category, importance, weight, owner_archetype_key)", () => {
  const bare = { type: "gc_wins", target: 2, cumulative: true };
  const enriched = {
    ...bare,
    label: "Mindst 2 samlede sejre over planperioden",
    satisfaction_bonus: 25,
    satisfaction_penalty: 10,
    category: "results",
    importance: "required",
    weight: 1.0,
    owner_archetype_key: "resultatjaegeren",
    negotiated: true,
  };
  assert.equal(buildGoalKey(bare), buildGoalKey(enriched));
});

test("buildGoalKey: to mål der KUN adskiller sig på target giver FORSKELLIGE nøgler", () => {
  const a = buildGoalKey({ type: "stage_wins", target: 2 });
  const b = buildGoalKey({ type: "stage_wins", target: 3 });
  assert.notEqual(a, b);
});

test("buildGoalKey: to mål der KUN adskiller sig på cumulative giver FORSKELLIGE nøgler", () => {
  const a = buildGoalKey({ type: "gc_wins", target: 1, cumulative: false });
  const b = buildGoalKey({ type: "gc_wins", target: 1, cumulative: true });
  assert.notEqual(a, b);
});

test("buildGoalKey: to mål der KUN adskiller sig på nationality_code giver FORSKELLIGE nøgler", () => {
  const a = buildGoalKey({ type: "min_national_riders", target: 3, nationality_code: "DNK" });
  const b = buildGoalKey({ type: "min_national_riders", target: 3, nationality_code: "FRA" });
  assert.notEqual(a, b);
});

test("buildGoalKey: to mål der KUN adskiller sig på race_scope giver FORSKELLIGE nøgler", () => {
  const a = buildGoalKey({ type: "monument_podium", target: 2, race_scope: "classics" });
  const b = buildGoalKey({ type: "monument_podium", target: 2, race_scope: null });
  assert.notEqual(a, b);
});

test("buildGoalKey: en genforhandling (nyt target) giver bevidst en NY nøgle", () => {
  const original = { type: "top_n_finish", target: 5 };
  const negotiated = { type: "top_n_finish", target: 7, negotiated: true };
  assert.notEqual(buildGoalKey(original), buildGoalKey(negotiated));
});

test("buildGoalKey: manglende felter (undefined/null) rammer samme streng — ingen 'undefined'-lækage", () => {
  const key = buildGoalKey({ type: "no_outstanding_debt", target: 0 });
  assert.equal(key, "no_outstanding_debt|0|||0");
  assert.ok(!key.includes("undefined"));
  assert.ok(!key.includes("null"));
});

test("buildGoalKey: 0 dubletter blandt en prod-lignende liste af 5 mål (samme balanced-pakke som generateBoardGoals)", () => {
  const goals = [
    { type: "top_n_finish", target: 4, category: "results" },
    { type: "min_riders", target: 15, min_target: 5, max_target: 20, category: "economy" },
    { type: "stage_wins", target: 2, cumulative: false, category: "results" },
    { type: "no_outstanding_debt", target: 0, category: "economy" },
    { type: "relative_rank", target: 3, category: "results" },
  ];
  const keys = goals.map((g) => buildGoalKey(g));
  assert.equal(new Set(keys).size, keys.length, "ingen af de 5 mål må dele nøgle");
});
