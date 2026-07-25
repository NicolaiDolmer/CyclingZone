// #2851 · Unit-tests for den rene fordelings-funktion (ejer-gate 25/7: "ren
// fordelings-funktion unit-testet"). Ingen I/O — ren input → output.

import test from "node:test";
import assert from "node:assert/strict";

import {
  rankTeamsGlobally,
  snakeAssign,
  distributeCompression,
  summarizeMovements,
} from "./pyramidCompression.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makePools() {
  // 1/2/4/8-pyramide som prod: league_divisions med tier + pool_index.
  const pools = [{ id: "d1-a", tier: 1, pool_index: 0 }];
  for (let i = 0; i < 2; i++) pools.push({ id: `d2-${"ab"[i]}`, tier: 2, pool_index: i });
  for (let i = 0; i < 4; i++) pools.push({ id: `d3-${"abcd"[i]}`, tier: 3, pool_index: i });
  for (let i = 0; i < 8; i++) pools.push({ id: `d4-${"abcdefgh"[i]}`, tier: 4, pool_index: i });
  return pools;
}

function makeRankedField(count) {
  // count managerhold med faldende point; blandede afsender-tiers så
  // movement-klassifikation testes bredt (fromTier 2/3/4 cyklisk).
  const teams = [];
  const standings = [];
  for (let i = 0; i < count; i++) {
    const id = `team-${String(i).padStart(3, "0")}`;
    teams.push({
      id,
      name: `Team ${String(i).padStart(3, "0")}`,
      division: 3,
      league_division_id: `d3-${"abcd"[i % 4]}`,
    });
    standings.push({ team_id: id, total_points: 3000 - i * 10, gc_wins: 0, stage_wins: 0 });
  }
  return { teams, standings };
}

// ─── rankTeamsGlobally ───────────────────────────────────────────────────────

test("rankTeamsGlobally sorterer på point på tværs af puljer og nummererer 1..N", () => {
  const teams = [
    { id: "b", name: "Beta", division: 3, league_division_id: "d3-a" },
    { id: "a", name: "Alfa", division: 4, league_division_id: "d4-a" },
    { id: "c", name: "Gamma", division: 2, league_division_id: "d2-a" },
  ];
  const standings = [
    { team_id: "a", total_points: 900 },
    { team_id: "b", total_points: 1200 },
    { team_id: "c", total_points: 100 },
  ];
  const ranked = rankTeamsGlobally({ teams, standings });
  assert.deepEqual(ranked.map((r) => r.teamId), ["b", "a", "c"]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
  // Et D4-hold med flere point end et D2-hold ligger over det — puljeblind rangering.
  assert.equal(ranked[1].fromTier, 4);
});

test("rankTeamsGlobally er deterministisk ved pointlighed (gc → stage → navn → id)", () => {
  const teams = [
    { id: "t2", name: "Zebra", division: 3, league_division_id: null },
    { id: "t1", name: "Aksel", division: 3, league_division_id: null },
    { id: "t3", name: "Aksel", division: 3, league_division_id: null },
  ];
  const standings = [
    { team_id: "t1", total_points: 500, gc_wins: 0, stage_wins: 2 },
    { team_id: "t2", total_points: 500, gc_wins: 1, stage_wins: 0 },
    { team_id: "t3", total_points: 500, gc_wins: 0, stage_wins: 2 },
  ];
  const a = rankTeamsGlobally({ teams, standings });
  const b = rankTeamsGlobally({ teams: [...teams].reverse(), standings: [...standings].reverse() });
  // gc_wins vinder over stage_wins; navne-/id-tiebreak gør rækkefølgen input-uafhængig.
  assert.deepEqual(a.map((r) => r.teamId), ["t2", "t1", "t3"]);
  assert.deepEqual(b.map((r) => r.teamId), a.map((r) => r.teamId));
});

test("rankTeamsGlobally markerer hold uden standings-række og lægger dem nederst", () => {
  const teams = [
    { id: "with", name: "Med", division: 3, league_division_id: null },
    { id: "without", name: "Uden", division: 3, league_division_id: null },
  ];
  const standings = [{ team_id: "with", total_points: 10 }];
  const ranked = rankTeamsGlobally({ teams, standings });
  assert.equal(ranked[1].teamId, "without");
  assert.equal(ranked[1].missingStanding, true);
  assert.equal(ranked[1].totalPoints, 0);
});

// ─── snakeAssign ─────────────────────────────────────────────────────────────

test("snakeAssign fordeler boustrofedon: A,B | B,A | A,B ...", () => {
  const pools = [{ id: "A" }, { id: "B" }];
  const rows = snakeAssign([1, 2, 3, 4, 5, 6], pools).map((r) => r.pool.id);
  assert.deepEqual(rows, ["A", "B", "B", "A", "A", "B"]);
});

test("snakeAssign over 4 puljer vender hver anden række", () => {
  const pools = ["A", "B", "C", "D"].map((id) => ({ id }));
  const rows = snakeAssign([1, 2, 3, 4, 5, 6, 7, 8], pools).map((r) => r.pool.id);
  assert.deepEqual(rows, ["A", "B", "C", "D", "D", "C", "B", "A"]);
});

// ─── distributeCompression ───────────────────────────────────────────────────

test("150 hold → præcis 48 i D2 (24+24), 96 i D3 (4×24), 6 i D4 A/B (3+3)", () => {
  const pools = makePools();
  const { teams, standings } = makeRankedField(150);
  const ranked = rankTeamsGlobally({ teams, standings });
  const { assignments, byPool } = distributeCompression(ranked, pools);

  assert.equal(assignments.length, 150);
  assert.equal(assignments.filter((a) => a.toTier === 2).length, 48);
  assert.equal(assignments.filter((a) => a.toTier === 3).length, 96);
  assert.equal(assignments.filter((a) => a.toTier === 4).length, 6);
  assert.equal(byPool.get("d2-a"), 24);
  assert.equal(byPool.get("d2-b"), 24);
  for (const p of ["a", "b", "c", "d"]) assert.equal(byPool.get(`d3-${p}`), 24);
  assert.equal(byPool.get("d4-a"), 3);
  assert.equal(byPool.get("d4-b"), 3);
  // Resten samles KUN i de to første D4-puljer — c..h får ingen.
  for (const p of ["c", "d", "e", "f", "g", "h"]) assert.equal(byPool.get(`d4-${p}`) ?? 0, 0);

  // Rank-grænserne er skarpe: rank 48 → D2, rank 49 → D3, rank 144 → D3, rank 145 → D4.
  const byRank = new Map(assignments.map((a) => [a.rank, a]));
  assert.equal(byRank.get(48).toTier, 2);
  assert.equal(byRank.get(49).toTier, 3);
  assert.equal(byRank.get(144).toTier, 3);
  assert.equal(byRank.get(145).toTier, 4);
});

test("movement-klassifikation: D4→D2 = promoted, D3→D4 = relegated, samme tier = unchanged/pool-move", () => {
  const pools = makePools();
  const teams = [];
  const standings = [];
  for (let i = 0; i < 150; i++) {
    const id = `t${String(i).padStart(3, "0")}`;
    // Hold 0 kommer fra D4 og har flest point (D4→D2 = promoted, Thybo-scenariet);
    // resten fra D3; de sidste to ender i D4 (relegated, Crowther-scenariet).
    teams.push({
      id,
      name: `T${String(i).padStart(3, "0")}`,
      division: i === 0 ? 4 : 3,
      league_division_id: i === 0 ? "d4-a" : `d3-${"abcd"[i % 4]}`,
    });
    standings.push({ team_id: id, total_points: 3000 - i * 10 });
  }
  const ranked = rankTeamsGlobally({ teams, standings });
  const { assignments } = distributeCompression(ranked, pools);
  const { promoted, relegated } = summarizeMovements(assignments);

  const first = assignments.find((a) => a.teamId === "t000");
  assert.equal(first.toTier, 2);
  assert.equal(first.movement, "promoted");
  // 47 øvrige D3-hold rykker op i D2 + D4-holdet = 48 promoted i alt.
  assert.equal(promoted.length, 48);
  // De 6 dårligste D3-hold rykker ned i D4.
  assert.equal(relegated.length, 6);
  for (const r of relegated) {
    assert.equal(r.fromTier, 3);
    assert.equal(r.toTier, 4);
  }
});

test("færre end 144 hold: D2 fyldes først, D3 tager resten, D4 forbliver tom", () => {
  const pools = makePools();
  const { teams, standings } = makeRankedField(100);
  const ranked = rankTeamsGlobally({ teams, standings });
  const { assignments } = distributeCompression(ranked, pools);
  assert.equal(assignments.filter((a) => a.toTier === 2).length, 48);
  assert.equal(assignments.filter((a) => a.toTier === 3).length, 52);
  assert.equal(assignments.filter((a) => a.toTier === 4).length, 0);
});

test("distributeCompression kaster ved skæv pyramide (manglende tier 2-pulje)", () => {
  const pools = makePools().filter((p) => p.id !== "d2-b");
  const { teams, standings } = makeRankedField(150);
  const ranked = rankTeamsGlobally({ teams, standings });
  assert.throws(() => distributeCompression(ranked, pools), /expected 2 tier 2 pools/);
});

test("re-run-determinisme: samme input giver bit-identisk fordeling (idempotens-fundamentet)", () => {
  const pools = makePools();
  const { teams, standings } = makeRankedField(150);
  const run1 = distributeCompression(rankTeamsGlobally({ teams, standings }), pools);
  const run2 = distributeCompression(rankTeamsGlobally({ teams, standings }), pools);
  assert.deepEqual(run1.assignments, run2.assignments);
});
