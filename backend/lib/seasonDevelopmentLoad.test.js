import test from "node:test";
import assert from "node:assert/strict";

import {
  computeSeasonLoad,
  loadSeasonDevelopmentLoad,
  resolveSeasonIdByNumber,
  HARD_TRAINING_SESSIONS,
  RACE_ID_CHUNK,
} from "./seasonDevelopmentLoad.js";
import { SESSION_INTENSITY } from "./trainingDayTypes.js";

test("#6499: hårde sessioner udledes af SESSION_INTENSITY (en ny hård session tæller automatisk)", () => {
  const expected = Object.keys(SESSION_INTENSITY).filter((k) => SESSION_INTENSITY[k] === "hard").sort();
  assert.deepEqual([...HARD_TRAINING_SESSIONS].sort(), expected);
  assert.ok(!HARD_TRAINING_SESSIONS.includes("tempo"), "normal tæller ikke");
  assert.ok(!HARD_TRAINING_SESSIONS.includes("endurance"), "let tæller ikke");
});

test("#6499: løbsdage = distinkte (løb, etape) pr. rytter", () => {
  const load = computeSeasonLoad({
    stageRows: [
      { rider_id: "a", race_id: "r1", stage_number: 1 },
      { rider_id: "a", race_id: "r1", stage_number: 2 },
      { rider_id: "a", race_id: "r1", stage_number: 2 }, // dublet
      { rider_id: "a", race_id: "r2", stage_number: 1 },
      { rider_id: "b", race_id: "r2", stage_number: 1 },
      { rider_id: null, race_id: "r2", stage_number: 1 }, // uden rytter
    ],
  });
  assert.deepEqual(load.get("a"), { raceDays: 3, hardDays: 0 });
  assert.deepEqual(load.get("b"), { raceDays: 1, hardDays: 0 });
  assert.equal(load.has(null), false);
});

test("#6499: endagsløb giver én løbsdag pr. rytter fra 'gc'-rækken (ingen 'stage'-rækker)", () => {
  const load = computeSeasonLoad({
    stageRows: [
      { rider_id: "a", race_id: "tour", stage_number: 1 },
      { rider_id: "a", race_id: "tour", stage_number: 2 },
    ],
    oneDayRows: [
      { rider_id: "a", race_id: "classic1", stage_number: 1 },
      { rider_id: "a", race_id: "classic1", stage_number: 1 }, // dublet
      { rider_id: "a", race_id: "classic2", stage_number: null },
      { rider_id: "c", race_id: "classic1", stage_number: 1 }, // kun endagsløb
      { rider_id: null, race_id: "classic1", stage_number: 1 }, // uden rytter
    ],
  });
  assert.deepEqual(load.get("a"), { raceDays: 4, hardDays: 0 });
  assert.deepEqual(load.get("c"), { raceDays: 1, hardDays: 0 });
  assert.equal(load.has(null), false);
});

test("#6499: hårde dage = træningsdag, ikke løbsdag, hård session; dedup pr. (rytter, game_day ?? tick_date)", () => {
  const t = (over) => ({ rider_id: "a", day_type: "training", was_race_day: false, session: "vo2max", game_day: null, tick_date: "2026-10-01", ...over });
  const load = computeSeasonLoad({
    trainingRows: [
      t({}),
      t({}), // samme dato → én dag
      t({ tick_date: "2026-10-02", session: "threshold" }),
      t({ game_day: 7, tick_date: "2026-10-03" }),
      t({ game_day: 7, tick_date: "2026-10-04" }), // samme game_day → én dag
      t({ tick_date: "2026-10-05", session: "tempo" }),          // normal
      t({ tick_date: "2026-10-06", session: "endurance" }),      // let
      t({ tick_date: "2026-10-07", was_race_day: true }),        // løbsdag
      t({ tick_date: "2026-10-08", day_type: "skill", session: "technique" }),
      t({ tick_date: "2026-10-09", day_type: "recovery", session: null }),
      t({ rider_id: "b", tick_date: "2026-10-01", session: "cobbled_sectors" }),
    ],
  });
  assert.deepEqual(load.get("a"), { raceDays: 0, hardDays: 3 });
  assert.deepEqual(load.get("b"), { raceDays: 0, hardDays: 1 });
});

// ── Mock med præcis det loadSeasonDevelopmentLoad bruger (eq/in/gt/order/limit/range/maybeSingle).
function createMock(tables, { failOn = null } = {}) {
  const queries = [];
  function builder(table, filters = []) {
    const run = (rows) => rows.filter((row) => filters.every((f) => f(row)));
    let limitN = null;
    const api = {
      select() { return api; },
      eq(col, val) { filters.push((r) => r[col] === val); return api; },
      in(col, vals) { filters.push((r) => vals.includes(r[col])); return api; },
      gt(col, val) { filters.push((r) => r[col] > val); return api; },
      order() { return api; },
      limit(n) {
        limitN = n;
        queries.push(table);
        if (failOn === table) return Promise.resolve({ data: null, error: { message: `${table} boom` } });
        const rows = run(tables[table] ?? []).sort((a, b) => (a.id > b.id ? 1 : -1)).slice(0, limitN);
        return Promise.resolve({ data: rows, error: null });
      },
      range(from, to) {
        queries.push(table);
        const rows = run(tables[table] ?? []).sort((a, b) => (a.id > b.id ? 1 : -1)).slice(from, to + 1);
        return Promise.resolve({ data: rows, error: null });
      },
      maybeSingle() {
        queries.push(table);
        return Promise.resolve({ data: run(tables[table] ?? [])[0] ?? null, error: null });
      },
    };
    return api;
  }
  return { from: (table) => builder(table, []), queries };
}

function pad(n) { return String(n).padStart(6, "0"); }

test("#6499: loadSeasonDevelopmentLoad læser kun den afsluttede sæson og tæller over bidder og sider", async () => {
  const races = [];
  const results = [];
  // Flere løb end én bid, og én rytter med flere rækker end én side.
  for (let i = 0; i < RACE_ID_CHUNK + 5; i++) {
    const raceId = `race-${pad(i)}`;
    races.push({ id: raceId, season_id: "s4" });
    for (let stage = 1; stage <= 3; stage++) {
      results.push({ id: `res-${pad(results.length)}`, race_id: raceId, stage_number: stage, result_type: "stage", rider_id: "a" });
      results.push({ id: `res-${pad(results.length)}`, race_id: raceId, stage_number: stage, result_type: "gc", rider_id: "a" });
    }
  }
  // Endagsløb: rytterens resultat ligger som 'gc' (+ 'team'), aldrig 'stage'.
  const SINGLE_RACES = RACE_ID_CHUNK + 2; // flere end én bid
  for (let i = 0; i < SINGLE_RACES; i++) {
    const raceId = `single-${pad(i)}`;
    races.push({ id: raceId, season_id: "s4", race_type: "single" });
    results.push({ id: `res-${pad(results.length)}`, race_id: raceId, stage_number: 1, result_type: "gc", rider_id: "a" });
    results.push({ id: `res-${pad(results.length)}`, race_id: raceId, stage_number: 1, result_type: "team", rider_id: "a" });
  }
  races.push({ id: "race-other", season_id: "s3" });
  results.push({ id: "res-other", race_id: "race-other", stage_number: 1, result_type: "stage", rider_id: "a" });
  races.push({ id: "single-other", season_id: "s3", race_type: "single" });
  results.push({ id: "res-single-other", race_id: "single-other", stage_number: 1, result_type: "gc", rider_id: "a" });
  const training = [];
  for (let d = 1; d <= 1500; d++) {
    training.push({ id: `trn-${pad(d)}`, rider_id: "a", season_id: "s4", day_type: "training", was_race_day: false, session: "vo2max", game_day: d, tick_date: "2026-10-01" });
  }
  training.push({ id: "trn-s3", rider_id: "a", season_id: "s3", day_type: "training", was_race_day: false, session: "vo2max", game_day: 1, tick_date: "2026-07-01" });

  const supabase = createMock({
    seasons: [{ id: "s3", number: 3 }, { id: "s4", number: 4 }],
    races, race_results: results, rider_training_scores: training,
  });
  const out = await loadSeasonDevelopmentLoad({ supabase, seasonNumber: 4 });
  assert.equal(out.seasonId, "s4");
  assert.equal(out.raceCount, RACE_ID_CHUNK + 5 + SINGLE_RACES);
  assert.equal(out.singleRaceCount, SINGLE_RACES);
  assert.equal(out.oneDayRiderDays, SINGLE_RACES);
  // Etapeløbenes 'gc'-rækker tæller ikke; endagsløbenes 'gc' tæller én dag hver.
  assert.deepEqual(out.byRider.get("a"), { raceDays: (RACE_ID_CHUNK + 5) * 3 + SINGLE_RACES, hardDays: 1500 });
});

test("#6499: manglende sæson eller læsefejl kaster (aldrig tavst fuldt fald)", async () => {
  await assert.rejects(() => resolveSeasonIdByNumber(createMock({ seasons: [] }), 9), /not found/);
  const supabase = createMock({ seasons: [{ id: "s4", number: 4 }], races: [] }, { failOn: "rider_training_scores" });
  await assert.rejects(() => loadSeasonDevelopmentLoad({ supabase, seasonId: "s4" }), /boom/);
  await assert.rejects(() => loadSeasonDevelopmentLoad({ supabase: null, seasonId: "s4" }), /client required/);
});
