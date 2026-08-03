import { test } from "node:test";
import assert from "node:assert/strict";
import { poolMatchesSelection, filterByDivisionPool, ALL_POOLS_VALUE } from "./resultsFilter.js";

const DIVISIONS_BY_ID = new Map([
  ["pool-1a", { tier: 1, pool_index: 0 }],
  ["pool-2a", { tier: 2, pool_index: 0 }],
  ["pool-2b", { tier: 2, pool_index: 1 }],
]);

test("poolMatchesSelection: null poolId (common/season-wide row) always matches", () => {
  assert.equal(poolMatchesSelection(null, { tier: 1, poolId: "pool-1a" }, DIVISIONS_BY_ID), true);
  assert.equal(poolMatchesSelection(undefined, { tier: 2, poolId: ALL_POOLS_VALUE }, DIVISIONS_BY_ID), true);
});

test("poolMatchesSelection: tier=null (all divisions) matches everything", () => {
  assert.equal(poolMatchesSelection("pool-2b", { tier: null, poolId: null }, DIVISIONS_BY_ID), true);
});

test("poolMatchesSelection: matching tier, poolId=all matches every pool in that tier", () => {
  assert.equal(poolMatchesSelection("pool-2a", { tier: 2, poolId: ALL_POOLS_VALUE }, DIVISIONS_BY_ID), true);
  assert.equal(poolMatchesSelection("pool-2b", { tier: 2, poolId: null }, DIVISIONS_BY_ID), true);
});

test("poolMatchesSelection: different tier never matches", () => {
  assert.equal(poolMatchesSelection("pool-2a", { tier: 1, poolId: ALL_POOLS_VALUE }, DIVISIONS_BY_ID), false);
});

test("poolMatchesSelection: specific pool must match exactly (loose string/number equality)", () => {
  assert.equal(poolMatchesSelection("pool-2a", { tier: 2, poolId: "pool-2a" }, DIVISIONS_BY_ID), true);
  assert.equal(poolMatchesSelection("pool-2b", { tier: 2, poolId: "pool-2a" }, DIVISIONS_BY_ID), false);
});

test("poolMatchesSelection: unknown poolId (not in divisionsById) never matches a specific tier", () => {
  assert.equal(poolMatchesSelection("ghost-pool", { tier: 1, poolId: null }, DIVISIONS_BY_ID), false);
});

test("filterByDivisionPool: filters a row list via a poolId accessor", () => {
  const rows = [
    { id: "r1", league_division_id: "pool-1a" },
    { id: "r2", league_division_id: "pool-2a" },
    { id: "r3", league_division_id: "pool-2b" },
    { id: "r4", league_division_id: null },
  ];
  const out = filterByDivisionPool(rows, (r) => r.league_division_id, { tier: 2, poolId: "pool-2b" }, DIVISIONS_BY_ID);
  assert.deepEqual(out.map((r) => r.id), ["r3", "r4"]);
});

test("filterByDivisionPool: non-array input degrades to empty list", () => {
  assert.deepEqual(filterByDivisionPool(null, (r) => r, { tier: 1, poolId: null }, DIVISIONS_BY_ID), []);
});
