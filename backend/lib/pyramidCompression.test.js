// #2851 · Unit-tests for den rene fordelings-funktion (ejer-gate 25/7: "ren
// fordelings-funktion unit-testet"). Ingen I/O — ren input → output.

import test from "node:test";
import assert from "node:assert/strict";

import {
  rankTeamsGlobally,
  snakeAssign,
  distributeCompression,
  summarizeMovements,
  buildCountbackByTeam,
  NO_COUNTBACK_RANK,
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

// ─── buildCountbackByTeam ───────────────────────────────────────────────────

test("buildCountbackByTeam aggregerer klassements-sejre, etape-podier og bedste placeringer pr. hold", () => {
  const raceResults = [
    // "Guds hånd": 4 øvrige-klassements-sejre (young×1 + team_day×1 + 2 flere),
    // 2 etape-podier (bedste 2.), bedste GC 7. — #3036 cutline-144-fixturen.
    { team_id: "guds-hand", result_type: "young", rank: 1 },
    { team_id: "guds-hand", result_type: "team_day", rank: 1 },
    { team_id: "guds-hand", result_type: "points_day", rank: 1 },
    { team_id: "guds-hand", result_type: "mountain_day", rank: 1 },
    { team_id: "guds-hand", result_type: "stage", rank: 2 },
    { team_id: "guds-hand", result_type: "stage", rank: 3 },
    { team_id: "guds-hand", result_type: "stage", rank: 11 },
    { team_id: "guds-hand", result_type: "gc", rank: 7 },
    { team_id: "guds-hand", result_type: "gc", rank: 9 },
    // stage/gc rank=1 skal IKKE tælle med i classificationWins — det er
    // allerede dækket af de eksisterende stage_wins/gc_wins-led.
    { team_id: "guds-hand", result_type: "stage", rank: 1 },
    { team_id: "guds-hand", result_type: "gc", rank: 1 },
    // HWT Rockets: ingen sejre, ingen podier.
    { team_id: "hwt-rockets", result_type: "stage", rank: 15 },
    { team_id: "hwt-rockets", result_type: "gc", rank: 11 },
    // Rækker uden team_id (rider forladt/slettet) eller ugyldig rank ignoreres.
    { team_id: null, result_type: "stage", rank: 1 },
    { team_id: "hwt-rockets", result_type: "stage", rank: null },
  ];
  const cb = buildCountbackByTeam(raceResults);
  const guds = cb.get("guds-hand");
  assert.equal(guds.classificationWins, 4);
  assert.equal(guds.stagePodiums, 3); // rank 1, 2, 3 (rank=1 stage tæller stadig som podie)
  assert.equal(guds.bestStageRank, 1);
  assert.equal(guds.bestGcRank, 1);
  const hwt = cb.get("hwt-rockets");
  assert.equal(hwt.classificationWins, 0);
  assert.equal(hwt.stagePodiums, 0);
  assert.equal(hwt.bestStageRank, 15);
  assert.equal(hwt.bestGcRank, 11);
});

test("buildCountbackByTeam: hold uden nogen rækker findes ikke i map (caller falder tilbage til NO_COUNTBACK_RANK)", () => {
  const cb = buildCountbackByTeam([{ team_id: "a", result_type: "gc", rank: 1 }]);
  assert.equal(cb.has("never-raced"), false);
});

// ─── rankTeamsGlobally + countback (#3036) ──────────────────────────────────

test("#3036: 61-61-cutline 26/7 — Guds hånd vinder på countback, ikke navne-alfabetet", () => {
  // Ægte fixture fra S1→S2-cutline 144 (#2851-kommentar 26/7): begge 61 point,
  // 0 løbssejre, 0 etapesejre. Alfabetet ('Guds hånd' < 'HWT Rockets') gav
  // tilfældigvis samme udfald som countback — men countback-leddet skal være
  // GRUNDEN, ikke navnet. Verificeret mod ægte prod-tal via Supabase MCP.
  const teams = [
    { id: "hwt-rockets", name: "HWT Rockets", division: 4, league_division_id: "d4-h" },
    { id: "guds-hand", name: "Guds hånd", division: 4, league_division_id: "d4-h" },
  ];
  const standings = [
    { team_id: "hwt-rockets", total_points: 61, gc_wins: 0, stage_wins: 0 },
    { team_id: "guds-hand", total_points: 61, gc_wins: 0, stage_wins: 0 },
  ];
  const countback = new Map([
    ["guds-hand", { classificationWins: 4, stagePodiums: 2, bestStageRank: 2, bestGcRank: 7 }],
    ["hwt-rockets", { classificationWins: 0, stagePodiums: 0, bestStageRank: 15, bestGcRank: 11 }],
  ]);
  const ranked = rankTeamsGlobally({ teams, standings, countback });
  assert.deepEqual(ranked.map((r) => r.teamId), ["guds-hand", "hwt-rockets"]);
  assert.equal(ranked[0].rank, 1);
  // Uden countback ville alfabetet ('Guds hånd' < 'HWT Rockets') give samme
  // rækkefølge — så beviset for at countback-leddet FAKTISK afgør sagen er at
  // omvendte navne (som ville tabe alfabetisk) stadig ender rigtigt.
  const teamsRenamed = [
    { id: "hwt-rockets", name: "AAA Rockets", division: 4, league_division_id: "d4-h" },
    { id: "guds-hand", name: "ZZZ hånd", division: 4, league_division_id: "d4-h" },
  ];
  const rankedRenamed = rankTeamsGlobally({ teams: teamsRenamed, standings, countback });
  assert.deepEqual(rankedRenamed.map((r) => r.teamId), ["guds-hand", "hwt-rockets"]);
});

test("rankTeamsGlobally: alle countback-led lige → falder tilbage til navn → id", () => {
  const teams = [
    { id: "t2", name: "Zebra", division: 3, league_division_id: null },
    { id: "t1", name: "Aksel", division: 3, league_division_id: null },
  ];
  const standings = [
    { team_id: "t1", total_points: 100, gc_wins: 0, stage_wins: 0 },
    { team_id: "t2", total_points: 100, gc_wins: 0, stage_wins: 0 },
  ];
  const countback = new Map([
    ["t1", { classificationWins: 2, stagePodiums: 1, bestStageRank: 5, bestGcRank: 5 }],
    ["t2", { classificationWins: 2, stagePodiums: 1, bestStageRank: 5, bestGcRank: 5 }],
  ]);
  const ranked = rankTeamsGlobally({ teams, standings, countback });
  assert.deepEqual(ranked.map((r) => r.teamId), ["t1", "t2"]); // "Aksel" < "Zebra"
});

test("rankTeamsGlobally: hold uden countback-data får NO_COUNTBACK_RANK (sentinel, aldrig falsk 0.)", () => {
  const teams = [
    { id: "raced", name: "Raced", division: 3, league_division_id: null },
    { id: "never-raced", name: "NeverRaced", division: 3, league_division_id: null },
  ];
  const standings = [
    { team_id: "raced", total_points: 50, gc_wins: 0, stage_wins: 0 },
    { team_id: "never-raced", total_points: 50, gc_wins: 0, stage_wins: 0 },
  ];
  const countback = new Map([
    ["raced", { classificationWins: 0, stagePodiums: 0, bestStageRank: 20, bestGcRank: 15 }],
    // "never-raced" har ingen entry i map — skal falde tilbage til sentinel, ikke 0.
  ]);
  const ranked = rankTeamsGlobally({ teams, standings, countback });
  assert.equal(ranked[0].teamId, "raced"); // reel placering slår sentinel
  assert.equal(ranked[1].teamId, "never-raced");
  assert.equal(ranked[1].bestStageRank, NO_COUNTBACK_RANK);
  assert.equal(ranked[1].bestGcRank, NO_COUNTBACK_RANK);
});

test("rankTeamsGlobally: uden countback-param ALT reproducerer den gamle kæde (bagudkompatibelt)", () => {
  // Identisk fixture til den eksisterende gc→stage→navn→id-determinisme-test —
  // kun uden at sende countback overhovedet. Alle nye led skal annullere sig
  // selv (0/sentinel for alle hold) og falde tilbage til den PRÆCIS samme
  // rækkefølge som før #3036.
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
  const ranked = rankTeamsGlobally({ teams, standings });
  assert.deepEqual(ranked.map((r) => r.teamId), ["t2", "t1", "t3"]);
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
