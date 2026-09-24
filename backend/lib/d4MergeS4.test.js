// #5641 · Unit-tests for den rene D4→D3-sammenlægnings-planlægning (A1).
// Ingen I/O — ren input → output, samme disciplin som pyramidCompression.test.js.

import test from "node:test";
import assert from "node:assert/strict";

import { planD4Merge, isD4MergeEligible, MAX_MERGE_MANAGERS } from "./d4MergeS4.js";

function d3Pools() {
  return [
    { id: "d3-a", tier: 3, pool_index: 0 },
    { id: "d3-b", tier: 3, pool_index: 1 },
    { id: "d3-c", tier: 3, pool_index: 2 },
    { id: "d3-d", tier: 3, pool_index: 3 },
  ];
}

function makeTeam(id, overrides = {}) {
  return {
    id,
    name: `Team ${id}`,
    division: 4,
    league_division_id: `d4-a`,
    is_ai: false,
    is_bank: false,
    is_frozen: false,
    is_test_account: false,
    parked_at: null,
    ...overrides,
  };
}

function standingFor(id, points) {
  return { team_id: id, total_points: points, gc_wins: 0, stage_wins: 0 };
}

// ─── isD4MergeEligible ───────────────────────────────────────────────────────

test("isD4MergeEligible: kun D3/D4, ikke-AI/bank/frosset/test, ikke-parkerede hold", () => {
  assert.equal(isD4MergeEligible(makeTeam("a", { division: 3 })), true);
  assert.equal(isD4MergeEligible(makeTeam("b", { division: 4 })), true);
  assert.equal(isD4MergeEligible(makeTeam("c", { division: 2 })), false);
  assert.equal(isD4MergeEligible(makeTeam("d", { division: 1 })), false);
  assert.equal(isD4MergeEligible(makeTeam("e", { is_ai: true })), false);
  assert.equal(isD4MergeEligible(makeTeam("f", { is_bank: true })), false);
  assert.equal(isD4MergeEligible(makeTeam("g", { is_frozen: true })), false);
  assert.equal(isD4MergeEligible(makeTeam("h", { is_test_account: true })), false);
  assert.equal(isD4MergeEligible(makeTeam("i", { parked_at: "2026-09-20T00:00:00Z" })), false);
  assert.equal(isD4MergeEligible(null), false);
});

// ─── planD4Merge: krav til d3Pools ───────────────────────────────────────────

test("planD4Merge kaster hvis d3Pools ikke er præcis 4 puljer", () => {
  const teams = [makeTeam("a")];
  const standings = [standingFor("a", 100)];
  assert.throws(() => planD4Merge({ teams, standings, d3Pools: d3Pools().slice(0, 3) }), /4 D3-puljer/);
  assert.throws(() => planD4Merge({ teams, standings, d3Pools: [] }), /4 D3-puljer/);
});

// ─── snake-balance ────────────────────────────────────────────────────────────

test("planD4Merge snake-fordeler eligible hold jævnt over de 4 D3-puljer (A,B,C,D,D,C,B,A,...)", () => {
  const teams = [];
  const standings = [];
  for (let i = 0; i < 20; i++) {
    const id = `t${String(i).padStart(2, "0")}`;
    teams.push(makeTeam(id, { division: i % 2 === 0 ? 4 : 3 }));
    standings.push(standingFor(id, 1000 - i)); // faldende, så rank == input-orden
  }
  const { assignments, byPool } = planD4Merge({ teams, standings, d3Pools: d3Pools() });
  assert.equal(assignments.length, 20);
  // Boustrofedon: rank 1-4 → A,B,C,D · rank 5-8 → D,C,B,A · ...
  const expectedPool = ["d3-a", "d3-b", "d3-c", "d3-d", "d3-d", "d3-c", "d3-b", "d3-a"];
  for (let i = 0; i < 8; i++) {
    assert.equal(assignments[i].toPoolId, expectedPool[i], `rank ${i + 1}`);
  }
  // Balance: 20 hold over 4 puljer → hver pulje får 5.
  for (const pool of d3Pools()) {
    assert.equal(byPool.get(pool.id), 5, `${pool.id} skal have 5 hold`);
  }
});

// ─── parkeret/frosset/test-hold udelukkes ────────────────────────────────────

test("planD4Merge udelukker parkerede, frosne, test- og AI-hold fra planlægningen", () => {
  const teams = [
    makeTeam("real1", { division: 3 }),
    makeTeam("real2", { division: 4 }),
    makeTeam("parked", { division: 4, parked_at: "2026-09-20T00:00:00Z" }),
    makeTeam("frozen", { division: 3, is_frozen: true }),
    makeTeam("test", { division: 4, is_test_account: true }),
    makeTeam("ai", { division: 4, is_ai: true }),
    makeTeam("bank", { division: 3, is_bank: true }),
    makeTeam("wrongTier", { division: 2 }),
  ];
  const standings = teams.map((t, i) => standingFor(t.id, 500 - i));
  const { assignments } = planD4Merge({ teams, standings, d3Pools: d3Pools() });
  assert.deepEqual(
    assignments.map((a) => a.teamId).sort(),
    ["real1", "real2"],
  );
});

// ─── > 96 managers afvises ────────────────────────────────────────────────────

test("planD4Merge afviser mere end 96 (MAX_MERGE_MANAGERS) eligible managerhold", () => {
  const teams = [];
  const standings = [];
  for (let i = 0; i < MAX_MERGE_MANAGERS + 1; i++) {
    const id = `t${i}`;
    teams.push(makeTeam(id, { division: 4 }));
    standings.push(standingFor(id, 1000 - i));
  }
  assert.throws(() => planD4Merge({ teams, standings, d3Pools: d3Pools() }), /> 96/);

  // Præcis 96 er OK (god margin-grænsen, ikke off-by-one).
  const okTeams = teams.slice(0, MAX_MERGE_MANAGERS);
  const okStandings = standings.slice(0, MAX_MERGE_MANAGERS);
  assert.doesNotThrow(() => planD4Merge({ teams: okTeams, standings: okStandings, d3Pools: d3Pools() }));
});

// ─── determinisme ved pointlighed ─────────────────────────────────────────────

test("planD4Merge er deterministisk ved pointlighed, input-rækkefølge-uafhængigt", () => {
  const teams = [
    makeTeam("z", { name: "Zebra", division: 4 }),
    makeTeam("a", { name: "Aksel", division: 3 }),
    makeTeam("m", { name: "Midte", division: 4 }),
  ];
  const standings = [
    standingFor("z", 500),
    standingFor("a", 500),
    standingFor("m", 500),
  ];
  const first = planD4Merge({ teams, standings, d3Pools: d3Pools() });
  const second = planD4Merge({
    teams: [...teams].reverse(),
    standings: [...standings].reverse(),
    d3Pools: d3Pools(),
  });
  assert.deepEqual(first.assignments.map((a) => a.teamId), second.assignments.map((a) => a.teamId));
  // Navne-alfabetet afgør ved fuld pointlighed (samme kæde som rankTeamsGlobally).
  assert.deepEqual(first.assignments.map((a) => a.teamId), ["a", "m", "z"]);
});

// ─── idempotens ────────────────────────────────────────────────────────────────

test("planD4Merge markerer hold allerede i deres mål-pulje som 'unchanged' (idempotent re-run)", () => {
  const teams = [];
  const standings = [];
  for (let i = 0; i < 8; i++) {
    const id = `t${i}`;
    teams.push(makeTeam(id, { division: 4 }));
    standings.push(standingFor(id, 1000 - i));
  }
  const first = planD4Merge({ teams, standings, d3Pools: d3Pools() });

  // Simulér at scriptet har anvendt planen: hold rykker nu til deres toPoolId,
  // "division" bliver 3. En ny planlægning fra denne tilstand skal give
  // PRÆCIS samme fordeling og markere alle som 'unchanged' (ingen writes ved re-run).
  const movedTeams = teams.map((t) => {
    const a = first.assignments.find((x) => x.teamId === t.id);
    return { ...t, division: 3, league_division_id: a.toPoolId };
  });
  const second = planD4Merge({ teams: movedTeams, standings, d3Pools: d3Pools() });
  assert.ok(second.assignments.every((a) => a.movement === "unchanged"));
  assert.deepEqual(
    second.assignments.map((a) => a.toPoolId),
    first.assignments.map((a) => a.toPoolId),
  );
});

test("planD4Merge sætter movement til 'promoted' fra D4 og 'pool-move' fra D3 (når puljen ændres)", () => {
  const teams = [
    makeTeam("fromD4", { division: 4, league_division_id: "d4-a" }),
    makeTeam("fromD3same", { division: 3, league_division_id: "d3-a" }),
  ];
  const standings = [standingFor("fromD4", 900), standingFor("fromD3same", 100)];
  const { assignments } = planD4Merge({ teams, standings, d3Pools: d3Pools() });
  const d4 = assignments.find((a) => a.teamId === "fromD4");
  const d3 = assignments.find((a) => a.teamId === "fromD3same");
  assert.equal(d4.movement, "promoted");
  // fromD3same er rank 2 (lavere point) → snake row 0 col 1 → d3-b, forskelligt fra d3-a.
  assert.equal(d3.toPoolId, "d3-b");
  assert.equal(d3.movement, "pool-move");
});
