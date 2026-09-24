// #5643 · comebackPlacement: Global Rank → division → pulje med en AI-plads.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tierForGlobalRank,
  resolveComebackRank,
  pickComebackPool,
  COMEBACK_BOTTOM_TIER,
} from "./comebackPlacement.js";

test("tierForGlobalRank: grænserne fra ejer-beslutningen 24/9", () => {
  assert.equal(tierForGlobalRank(1), 1);
  assert.equal(tierForGlobalRank(24), 1);
  assert.equal(tierForGlobalRank(25), 2);
  assert.equal(tierForGlobalRank(72), 2);
  assert.equal(tierForGlobalRank(73), 3);
  assert.equal(tierForGlobalRank(168), 3);
  assert.equal(tierForGlobalRank(169), 4);
  assert.equal(tierForGlobalRank(5000), 4);
});

test("tierForGlobalRank: ukendt rang går til bunden", () => {
  for (const rank of [null, undefined, 0, -3, Number.NaN, "abc"]) {
    assert.equal(tierForGlobalRank(rank), COMEBACK_BOTTOM_TIER, `rank=${String(rank)}`);
  }
});

test("resolveComebackRank: bruger global_rank når den findes", () => {
  assert.equal(resolveComebackRank({ globalRank: 30, globalPoints: 900, humansAbove: 2 }), 30);
});

test("resolveComebackRank: NULL-rang rangeres på point blandt menneskehold", () => {
  assert.equal(resolveComebackRank({ globalRank: null, globalPoints: 500, humansAbove: 80 }), 81);
  assert.equal(resolveComebackRank({ globalRank: null, globalPoints: 500, humansAbove: 0 }), 1);
});

test("resolveComebackRank: NULL-rang uden point → null (bunden)", () => {
  assert.equal(resolveComebackRank({ globalRank: null, globalPoints: 0, humansAbove: 0 }), null);
  assert.equal(resolveComebackRank({ globalRank: null, globalPoints: null }), null);
  assert.equal(tierForGlobalRank(resolveComebackRank({ globalRank: null, globalPoints: 0 })), 4);
});

// Fixture: D1 én pulje, D2 to, D3 to, D4 to. `ai` = antal frie AI-hold.
function world({ ai = {}, extraTeams = [], extraPools = [] } = {}) {
  const pools = [
    { id: 1, tier: 1, pool_index: 0, label: "1A" },
    { id: 2, tier: 2, pool_index: 0, label: "2A" },
    { id: 3, tier: 2, pool_index: 1, label: "2B" },
    { id: 4, tier: 3, pool_index: 0, label: "3A" },
    { id: 5, tier: 3, pool_index: 1, label: "3B" },
    { id: 6, tier: 4, pool_index: 0, label: "4A" },
    { id: 7, tier: 4, pool_index: 1, label: "4B" },
    ...extraPools,
  ];
  const teams = [];
  for (const [poolId, n] of Object.entries(ai)) {
    for (let i = 0; i < n; i += 1) {
      teams.push({ id: `ai-${poolId}-${i}`, league_division_id: Number(poolId), is_ai: true, is_bank: false, retired_at: null, pending_removal_at: null });
    }
  }
  return { pools, teams: [...teams, ...extraTeams] };
}

test("pickComebackPool: overtager en AI-plads i sin egen division", () => {
  const { pools, teams } = world({ ai: { 2: 1, 3: 2, 6: 5 } });
  const placement = pickComebackPool({ tier: 2, pools, teams });
  assert.equal(placement.poolId, 3, "flest AI-pladser vinder");
  assert.equal(placement.tier, 2);
  assert.equal(placement.reason, "ai_slot");
});

test("pickComebackPool: lighed i AI-pladser → laveste pool_index", () => {
  const { pools, teams } = world({ ai: { 4: 3, 5: 3 } });
  assert.equal(pickComebackPool({ tier: 3, pools, teams }).poolId, 4);
});

test("pickComebackPool: ingen AI-plads i divisionen → næste division ned", () => {
  const { pools, teams } = world({ ai: { 4: 2, 6: 9 } });
  const placement = pickComebackPool({ tier: 1, pools, teams });
  assert.equal(placement.tier, 3, "D1 og D2 er fulde af mennesker, D3 har plads");
  assert.equal(placement.poolId, 4);
});

test("pickComebackPool: falder helt til D4", () => {
  const { pools, teams } = world({ ai: { 7: 3 } });
  const placement = pickComebackPool({ tier: 2, pools, teams });
  assert.equal(placement.tier, 4);
  assert.equal(placement.poolId, 7);
});

test("pickComebackPool: går aldrig op i en højere division", () => {
  const { pools, teams } = world({ ai: { 1: 5, 2: 5, 7: 1 } });
  assert.equal(pickComebackPool({ tier: 4, pools, teams }).poolId, 7);
});

test("pickComebackPool: pensionerede, reserverede og bank-hold er ikke AI-pladser", () => {
  const { pools, teams } = world({
    ai: { 6: 2 },
    extraTeams: [
      { id: "r1", league_division_id: 4, is_ai: true, is_bank: false, retired_at: "2026-09-20T00:00:00Z", pending_removal_at: null },
      { id: "p1", league_division_id: 4, is_ai: true, is_bank: false, retired_at: null, pending_removal_at: "2026-09-24T00:00:00Z" },
      { id: "b1", league_division_id: 5, is_ai: true, is_bank: true, retired_at: null, pending_removal_at: null },
      { id: "h1", league_division_id: 5, is_ai: false, is_bank: false, retired_at: null, pending_removal_at: null },
    ],
  });
  assert.equal(pickComebackPool({ tier: 3, pools, teams }).tier, 4);
});

test("pickComebackPool: pensioneret pulje (retired_at) og ungdomspulje springes over", () => {
  const { pools, teams } = world({
    ai: { 6: 9, 7: 1, 8: 20, 9: 20 },
    extraPools: [
      { id: 8, tier: 4, pool_index: 4, label: "4E", retired_at: "2026-09-28T00:00:00Z" },
      { id: 9, tier: 4, pool_index: 5, label: "U23", squad: "u23" },
    ],
  });
  pools.find((p) => p.id === 6).retired_at = "2026-09-28T00:00:00Z";
  assert.equal(pickComebackPool({ tier: 4, pools, teams }).poolId, 7);
});

test("pickComebackPool: ingen AI-plads nogen steder → mindst fyldte aktive D4-pulje", () => {
  const human = (id, poolId) => ({ id, league_division_id: poolId, is_ai: false, is_bank: false, retired_at: null, pending_removal_at: null });
  const { pools, teams } = world({ extraTeams: [human("h1", 6), human("h2", 6), human("h3", 7)] });
  const placement = pickComebackPool({ tier: 1, pools, teams });
  assert.equal(placement.poolId, 7);
  assert.equal(placement.reason, "bottom_fallback");
});

test("pickComebackPool: ingen puljer → null", () => {
  assert.equal(pickComebackPool({ tier: 2, pools: [], teams: [] }), null);
});
