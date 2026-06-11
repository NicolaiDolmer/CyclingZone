import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runAdminSimulateRace,
  getRaceEngineStatus,
  buildRaceSimEmbed,
} from "./adminSimulateRace.js";

// ── Mock-supabase ─────────────────────────────────────────────────────────────
// Matches raceRunner.test.js-mønstret; udvider med count-head for
// getRaceEngineStatus-tælle-queries.
function makeSupabase(canned = {}) {
  const writes = [];
  function from(table) {
    let _count = null;
    const b = {
      select(fields, opts = {}) {
        if (opts.count === "exact" && opts.head === true) {
          _count = (canned[table] || []).length;
        }
        return b;
      },
      eq() { return b; },
      in() { return b; },
      or() { return b; },
      order() { return b; },
      maybeSingle() {
        return Promise.resolve({ data: (canned[table] || [])[0] ?? null, error: null });
      },
      // Count-head query resolves med { count, error }
      then(resolve, reject) {
        if (_count !== null) {
          return Promise.resolve({ count: _count, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: canned[table] || [], error: null }).then(resolve, reject);
      },
      insert(rows) { writes.push({ table, op: "insert", rows }); return Promise.resolve({ error: null }); },
      update(obj) {
        const rec = { table, op: "update", obj, eqs: [] };
        writes.push(rec);
        const u = { eq(c, v) { rec.eqs.push([c, v]); return u; }, in() { return u; }, then(r) { return Promise.resolve({ error: null }).then(r); } };
        return u;
      },
    };
    return b;
  }
  return { from, __writes: writes };
}

// ── runAdminSimulateRace ──────────────────────────────────────────────────────

// Test 1: flag OFF + dryRun=false → 409; simulateRace stub ikke kaldt.
test("runAdminSimulateRace: flag OFF + dryRun=false → 409, simulateRace ikke kaldt", async () => {
  const supabase = makeSupabase({
    app_config: [],   // tom → flag OFF
    races: [{ id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, edition_year: 2026, status: "scheduled" }],
  });
  let stubCalled = false;
  const stub = async () => { stubCalled = true; return {}; };

  let err = null;
  try {
    await runAdminSimulateRace({ supabase, raceId: "r1", dryRun: false, simulateRace: stub });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "skal kaste");
  assert.equal(err.status, 409, `forventet 409, fik ${err.status}: ${err.message}`);
  assert.equal(stubCalled, false, "simulateRace-stub må ikke kaldes når flag er OFF");
});

// Test 2: flag OFF + dryRun=true → tilladt; stub kaldt med dryRun:true + race.
test("runAdminSimulateRace: flag OFF + dryRun=true → tilladt, stub kaldt med dryRun:true", async () => {
  const race = { id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, edition_year: 2026, status: "scheduled" };
  const supabase = makeSupabase({
    app_config: [],   // flag OFF
    races: [race],
  });
  let capturedArgs = null;
  const stub = async (args) => { capturedArgs = args; return { dryRun: true, rows: 5 }; };

  const result = await runAdminSimulateRace({ supabase, raceId: "r1", dryRun: true, simulateRace: stub });

  assert.ok(capturedArgs, "simulateRace-stub skal kaldes");
  assert.equal(capturedArgs.dryRun, true, "dryRun:true skal videregives til stub");
  assert.equal(capturedArgs.race.id, "r1", "race skal videregives");
  assert.equal(result.dryRun, true);
});

// Test 3: ukendt raceId → 404.
test("runAdminSimulateRace: ukendt raceId → 404", async () => {
  const supabase = makeSupabase({ races: [] }); // ingen ræs
  let err = null;
  try {
    await runAdminSimulateRace({ supabase, raceId: "ukendt-id", simulateRace: async () => {} });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "skal kaste");
  assert.equal(err.status, 404);
});

// Test 4: løb med status "completed" → 409.
test("runAdminSimulateRace: completed-løb → 409", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],   // flag ON — sikrer 409 kommer fra completed-check
    races: [{ id: "r2", season_id: "s1", name: "Afviklet", race_type: "stage_race", race_class: "ProSeries", stages: 3, edition_year: 2026, status: "completed" }],
  });
  let err = null;
  try {
    await runAdminSimulateRace({ supabase, raceId: "r2", dryRun: false, simulateRace: async () => {} });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "skal kaste");
  assert.equal(err.status, 409);
  assert.ok(err.message.includes("allerede afviklet") || err.message.includes("completed"), `uventet besked: ${err.message}`);
});

// Test 5: manglende raceId → 400.
test("runAdminSimulateRace: manglende raceId → 400", async () => {
  const supabase = makeSupabase({});
  let err = null;
  try {
    await runAdminSimulateRace({ supabase, simulateRace: async () => {} });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "skal kaste");
  assert.equal(err.status, 400);
});

// ── getRaceEngineStatus ───────────────────────────────────────────────────────

// Test 6a: aktiv sæson → enabled + races med profile_count/entry_count/ready.
test("getRaceEngineStatus: aktiv sæson → korrekt form med profile_count/entry_count/ready", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],
    seasons: [{ id: "s1", number: 2, status: "active" }],
    races: [
      { id: "r1", name: "Alfa GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, status: "scheduled" },
    ],
    race_stage_profiles: [{ id: "p1" }, { id: "p2" }],   // 2 profiler → ready:true
    race_entries: [{ rider_id: "rider1" }],               // 1 entry
  });

  const status = await getRaceEngineStatus({ supabase });

  assert.equal(status.enabled, true);
  assert.ok(status.flag_key, "flag_key skal være sat");
  assert.ok(status.season, "season skal være sat");
  assert.equal(status.races.length, 1);
  const r = status.races[0];
  assert.ok("profile_count" in r, "profile_count mangler");
  assert.ok("entry_count" in r, "entry_count mangler");
  assert.ok("ready" in r, "ready mangler");
  assert.equal(r.profile_count, 2, "profile_count skal være 2 (matcher mock: 2 race_stage_profiles)");
  assert.equal(r.ready, true, "ready skal være true når profile_count > 0");
});

// Test 6b: ingen aktiv sæson → { enabled, season: null, races: [] }.
test("getRaceEngineStatus: ingen aktiv sæson → season:null + races:[]", async () => {
  const supabase = makeSupabase({
    app_config: [],   // flag OFF
    seasons: [],      // ingen aktiv sæson
  });

  const status = await getRaceEngineStatus({ supabase });

  assert.equal(status.enabled, false);
  assert.equal(status.season, null);
  assert.deepEqual(status.races, []);
});

// ── buildRaceSimEmbed ─────────────────────────────────────────────────────────

// Test 7: GC-vinder + etapevindere i embed-titel/-beskrivelse.
test("buildRaceSimEmbed: titel indeholder løbsnavn, beskrivelse indeholder GC-vinder og etapevindere", () => {
  const race = { id: "r1", name: "Test GP" };
  const resultRows = [
    { result_type: "gc",    rank: 1, rider_name: "A", rider_id: "a", stage_number: null },
    { result_type: "gc",    rank: 2, rider_name: "X", rider_id: "x", stage_number: null },
    { result_type: "stage", rank: 1, rider_name: "B", rider_id: "b", stage_number: 1 },
    { result_type: "stage", rank: 2, rider_name: "Y", rider_id: "y", stage_number: 1 },
    { result_type: "stage", rank: 1, rider_name: "C", rider_id: "c", stage_number: 2 },
  ];

  const embed = buildRaceSimEmbed({ race, resultRows });

  assert.ok(embed.title.includes("Test GP"), `titel skal indeholde "Test GP" — fik: ${embed.title}`);
  assert.ok(embed.description.includes("A"), `beskrivelse skal indeholde GC-vinder "A" — fik: ${embed.description}`);
  assert.ok(embed.description.includes("B"), `beskrivelse skal indeholde etapevinder "B" — fik: ${embed.description}`);
  assert.ok(embed.description.includes("C"), `beskrivelse skal indeholde etapevinder "C" — fik: ${embed.description}`);
  assert.ok(typeof embed.color === "number", "color skal være et tal");
});
