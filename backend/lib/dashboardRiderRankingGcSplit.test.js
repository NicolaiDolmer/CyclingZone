import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchGcClassicSplit, splitGcWins } from "./dashboardRiderRankingGcSplit.js";

// #3507 — splitGcWins skal reproducere rider_rankings_mv's definition 1:1
// (database/2026-07-04-ranking-matviews.sql): gc_wins = stage_race GC-sejre,
// classic_wins = single-race ("klassiker") GC-sejre. Kilden er RPC'ens samlede
// gc_wins (alle typer) + en lille race_type-joinet GC-vinder-liste.

test("splitGcWins: splitter stage_race vs single pr. rytter", () => {
  const riders = [
    { rider_id: "r1", points: 100, gc_wins: 3 }, // RPC's ukorrekte "alle typer"-tal
    { rider_id: "r2", points: 50, gc_wins: 1 },
  ];
  const gcRows = [
    { rider_id: "r1", race: { race_type: "stage_race" } },
    { rider_id: "r1", race: { race_type: "stage_race" } },
    { rider_id: "r1", race: { race_type: "single" } },
    { rider_id: "r2", race: { race_type: "single" } },
  ];
  const result = splitGcWins(riders, gcRows);
  assert.deepEqual(result[0], { rider_id: "r1", points: 100, gc_wins: 2, classic_wins: 1 });
  assert.deepEqual(result[1], { rider_id: "r2", points: 50, gc_wins: 0, classic_wins: 1 });
});

test("splitGcWins: rytter uden GC-sejre falder tilbage til 0/0 (ikke RPC'ens gamle tal)", () => {
  const riders = [{ rider_id: "r1", gc_wins: 5 }]; // stale/forkert RPC-tal skal overskrives
  const result = splitGcWins(riders, []);
  assert.equal(result[0].gc_wins, 0);
  assert.equal(result[0].classic_wins, 0);
});

test("splitGcWins: ukendte race_type-vaerdier (fx null) taeller hverken gc eller classic", () => {
  const riders = [{ rider_id: "r1", gc_wins: 1 }];
  const gcRows = [{ rider_id: "r1", race: { race_type: null } }, { rider_id: "r1", race: null }];
  const result = splitGcWins(riders, gcRows);
  assert.equal(result[0].gc_wins, 0);
  assert.equal(result[0].classic_wins, 0);
});

test("splitGcWins: tom riders-liste giver tom liste (ingen kast ved null/undefined input)", () => {
  assert.deepEqual(splitGcWins(null, null), []);
  assert.deepEqual(splitGcWins([], []), []);
});

test("splitGcWins: bevarer feltrækkefølge/-øvrige felter uændret bortset fra gc_wins/classic_wins", () => {
  const riders = [{ rider_id: "r1", firstname: "Rider", points: 10, gc_wins: 9 }];
  const result = splitGcWins(riders, []);
  assert.equal(result[0].firstname, "Rider");
  assert.equal(result[0].points, 10);
});

// fetchGcClassicSplit — tynd Supabase-wrapper, testet med en fake query-builder
// (samme mønster som andre backend/lib-tests der undgår en levende DB).
function fakeSupabase(rows) {
  const calls = [];
  const builder = {
    select(cols) { calls.push(["select", cols]); return this; },
    in(col, vals) { calls.push(["in", col, vals]); return this; },
    eq(col, val) { calls.push(["eq", col, val]); return this; },
    then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
  };
  return {
    from(table) { calls.push(["from", table]); return builder; },
    _calls: calls,
  };
}

test("fetchGcClassicSplit: tom riderIds-liste kalder aldrig Supabase", async () => {
  const supabase = fakeSupabase([]);
  const result = await fetchGcClassicSplit(supabase, { riderIds: [], seasonId: "s1", leagueDivisionId: 3 });
  assert.deepEqual(result, []);
  assert.deepEqual(supabase._calls, []);
});

test("fetchGcClassicSplit: filtrerer på rank=1, result_type=gc, race.season_id + division naar sat", async () => {
  const rows = [{ rider_id: "r1", race: { race_type: "stage_race" } }];
  const supabase = fakeSupabase(rows);
  const result = await fetchGcClassicSplit(supabase, { riderIds: ["r1"], seasonId: "s1", leagueDivisionId: 3 });
  assert.deepEqual(result, rows);
  const eqCalls = supabase._calls.filter(c => c[0] === "eq");
  assert.ok(eqCalls.some(c => c[1] === "rank" && c[2] === 1));
  assert.ok(eqCalls.some(c => c[1] === "result_type" && c[2] === "gc"));
  assert.ok(eqCalls.some(c => c[1] === "race.season_id" && c[2] === "s1"));
  assert.ok(eqCalls.some(c => c[1] === "race.league_division_id" && c[2] === 3));
});

test("fetchGcClassicSplit: leagueDivisionId=null (alle divisioner) filtrerer IKKE på division", async () => {
  const supabase = fakeSupabase([]);
  await fetchGcClassicSplit(supabase, { riderIds: ["r1"], seasonId: "s1", leagueDivisionId: null });
  const eqCalls = supabase._calls.filter(c => c[0] === "eq");
  assert.ok(!eqCalls.some(c => c[1] === "race.league_division_id"));
});
