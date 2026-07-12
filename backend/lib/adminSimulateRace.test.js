import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runAdminSimulateRace,
  runAdminSimulateStage,
  getRaceEngineStatus,
  buildRaceSimEmbed,
} from "./adminSimulateRace.js";

// ── Mock-supabase ─────────────────────────────────────────────────────────────
// Matches raceRunner.test.js-mønstret; udvider med count-head for
// getRaceEngineStatus-tælle-queries.
function makeSupabase(canned = {}) {
  const writes = [];
  const selects = []; // {table, fields} — så regressions-tests kan inspicere SELECT-strenge
  function from(table) {
    let _count = null;
    const b = {
      select(fields, opts = {}) {
        selects.push({ table, fields });
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
  return { from, __writes: writes, __selects: selects };
}

// ── Regression (incident 2026-06-23): race-SELECT SKAL bære league_division_id ────
// Pulje-filteret i fillMissingTeamEntries (raceRunner.js #1688) afhænger af
// race.league_division_id. Da runAdminSimulateStage/runAdminSimulateRace ikke
// selekterede kolonnen, så filteret racePoolId=null og tog de 24 stærkeste hold i
// HELE ligaen → krydskontaminering på tværs af puljer. Disse tests fanger
// regressionen ved at inspicere races-SELECT-strengen + race-objektet videregivet.
test("runAdminSimulateStage: races-SELECT inkluderer league_division_id (incident 2026-06-23)", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],
    races: [{ id: "r1", season_id: "s1", name: "GP", race_type: "stage_race", race_class: "ProSeries", stages: 1, stages_completed: 0, status: "scheduled", league_division_id: 4 }],
    race_stage_profiles: [{ id: "p1" }], // 1/1 → profil-guard OK
  });
  let captured = null;
  await runAdminSimulateStage({ supabase, raceId: "r1", simulateStageByIndex: async (args) => { captured = args; return { stageNumber: 1, isFinalStage: true }; } });
  const racesSelect = supabase.__selects.filter((s) => s.table === "races").map((s) => s.fields).join(" ");
  assert.ok(racesSelect.includes("league_division_id"), `races-SELECT skal inkludere league_division_id — fik: ${racesSelect}`);
  assert.equal(captured.race.league_division_id, 4, "pulje-id skal bæres videre til motoren");
});

test("runAdminSimulateRace: races-SELECT inkluderer league_division_id (incident 2026-06-23)", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],
    races: [{ id: "r1", season_id: "s1", name: "GP", race_type: "stage_race", race_class: "ProSeries", stages: 1, edition_year: 2026, status: "scheduled", league_division_id: 4 }],
    race_stage_profiles: [{ id: "p1" }], // 1/1 → profil-guard OK
  });
  let captured = null;
  await runAdminSimulateRace({ supabase, raceId: "r1", simulateRace: async (args) => { captured = args; return { rows: 1 }; } });
  const racesSelect = supabase.__selects.filter((s) => s.table === "races").map((s) => s.fields).join(" ");
  assert.ok(racesSelect.includes("league_division_id"), `races-SELECT skal inkludere league_division_id — fik: ${racesSelect}`);
  assert.equal(captured.race.league_division_id, 4, "pulje-id skal bæres videre til motoren");
});

// ── runAdminSimulateRace ──────────────────────────────────────────────────────

// Test 1: flag OFF + dryRun=false → 409 (fra flag-check); simulateRace stub ikke kaldt.
// Giver fulde profiler (3/3) så profil-guard passeres og 409 stammer fra flag-check.
test("runAdminSimulateRace: flag OFF + dryRun=false → 409, simulateRace ikke kaldt", async () => {
  const supabase = makeSupabase({
    app_config: [],   // tom → flag OFF
    races: [{ id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, edition_year: 2026, status: "scheduled" }],
    race_stage_profiles: [{ id: "p1" }, { id: "p2" }, { id: "p3" }], // 3/3 profiler → profil-guard OK
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
  assert.ok(err.message.includes("RACE_ENGINE_V2_ENABLED"), `forventet flag-besked, fik: ${err.message}`);
  assert.equal(stubCalled, false, "simulateRace-stub må ikke kaldes når flag er OFF");
});

// Test 2: flag OFF + dryRun=true → tilladt; stub kaldt med dryRun:true + race.
// Giver fulde profiler (3/3) så profil-guard passeres — dryRun springer flag-check over.
test("runAdminSimulateRace: flag OFF + dryRun=true → tilladt, stub kaldt med dryRun:true", async () => {
  const race = { id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, edition_year: 2026, status: "scheduled" };
  const supabase = makeSupabase({
    app_config: [],   // flag OFF
    races: [race],
    race_stage_profiles: [{ id: "p1" }, { id: "p2" }, { id: "p3" }], // 3/3 profiler → profil-guard OK
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
  assert.ok(err.message.includes("already simulated") || err.message.includes("completed"), `uventet besked: ${err.message}`);
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

// Test 6-ny-a: stages=3 men kun 1 profil → 409 "Delvise"; stub ikke kaldt (heller ikke ved dryRun=true).
test("runAdminSimulateRace: delvise stage-profiler (1/3) → 409 Delvise, simulateRace ikke kaldt", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],   // flag ON — sikrer 409 kommer fra profil-guard, ikke flag
    races: [{ id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, edition_year: 2026, status: "scheduled" }],
    race_stage_profiles: [{ id: "p1" }], // kun 1 profil → 1/3 → delvis
  });
  let stubCalled = false;
  const stub = async () => { stubCalled = true; return {}; };

  // dryRun=true — profil-guard blokerer uanset dryRun
  let err = null;
  try {
    await runAdminSimulateRace({ supabase, raceId: "r1", dryRun: true, simulateRace: stub });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "skal kaste ved dryRun=true med delvise profiler");
  assert.equal(err.status, 409, `forventet 409, fik ${err.status}: ${err.message}`);
  assert.ok(err.message.includes("Partial"), `forventet "Partial" i besked, fik: ${err.message}`);
  assert.equal(stubCalled, false, "simulateRace-stub må ikke kaldes ved delvise profiler");
});

// Test 6-ny-b: nul profiler (0/3) → 409 "Delvise"; simulateRace stub ikke kaldt.
test("runAdminSimulateRace: nul stage-profiler (0/3) → 409 Delvise, simulateRace ikke kaldt", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],   // flag ON
    races: [{ id: "r2", season_id: "s1", name: "Blank GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, edition_year: 2026, status: "scheduled" }],
    // race_stage_profiles ikke i canned → count = 0
  });
  let stubCalled = false;
  const stub = async () => { stubCalled = true; return {}; };

  let err = null;
  try {
    await runAdminSimulateRace({ supabase, raceId: "r2", dryRun: false, simulateRace: stub });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "skal kaste");
  assert.equal(err.status, 409);
  assert.ok(err.message.includes("Partial"), `forventet "Partial" i besked, fik: ${err.message}`);
  assert.equal(stubCalled, false, "simulateRace-stub må ikke kaldes ved nul profiler");
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
    race_stage_profiles: [{ id: "p1" }, { id: "p2" }, { id: "p3" }], // 3/3 profiler → ready:true (>= stages)
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
  assert.equal(r.profile_count, 3, "profile_count skal være 3 (matcher mock: 3 race_stage_profiles)");
  assert.equal(r.ready, true, "ready skal være true når profile_count >= stages (3/3)");
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

// S4 (#1176): DNF-linje — kun når der rent faktisk er abandons blandt incidents.
test("buildRaceSimEmbed: incidents med abandons → DNF-linje med navn + årsag", () => {
  const race = { id: "r1", name: "Test GP" };
  const resultRows = [
    { result_type: "gc", rank: 1, rider_name: "A", rider_id: "a", stage_number: null },
  ];
  const incidents = [
    { stage_number: 2, rider_id: "b4", kind: "crash", outcome: "abandon", rider_name: "Jens Berg" },
    { stage_number: 2, rider_id: "b5", kind: "mechanical", outcome: "abandon", rider_name: "Ole Holm" },
    { stage_number: 1, rider_id: "b6", kind: "crash", outcome: "time_loss", rider_name: "Ada Time", time_loss_seconds: 60 },
  ];

  const embed = buildRaceSimEmbed({ race, resultRows, incidents });

  assert.ok(embed.description.includes("DNF"), `beskrivelse skal indeholde en DNF-linje — fik: ${embed.description}`);
  assert.ok(embed.description.includes("Jens Berg (styrt)"), `forventet "Jens Berg (styrt)" — fik: ${embed.description}`);
  assert.ok(embed.description.includes("Ole Holm (mekanisk defekt)"), `forventet "Ole Holm (mekanisk defekt)" — fik: ${embed.description}`);
  assert.ok(!embed.description.includes("Ada Time"), "time_loss (ikke abandon) må ikke optræde i DNF-linjen");
});

// Ingen abandons/ingen incidents-param → ingen DNF-linje (dormant flag-off-adfærd).
test("buildRaceSimEmbed: ingen abandons → ingen DNF-linje, ingen crash på manglende incidents-param", () => {
  const race = { id: "r1", name: "Test GP" };
  const resultRows = [{ result_type: "gc", rank: 1, rider_name: "A", rider_id: "a", stage_number: null }];

  const embedNoIncidents = buildRaceSimEmbed({ race, resultRows });
  assert.ok(!embedNoIncidents.description.includes("DNF"), "ingen incidents-param → ingen DNF-linje");

  const embedTimeLossOnly = buildRaceSimEmbed({
    race, resultRows,
    incidents: [{ stage_number: 1, rider_id: "b1", kind: "crash", outcome: "time_loss", rider_name: "B", time_loss_seconds: 40 }],
  });
  assert.ok(!embedTimeLossOnly.description.includes("DNF"), "kun time_loss (ingen abandon) → ingen DNF-linje");
});

// ── runAdminSimulateStage (WS1 Fase 3) ────────────────────────────────────────

// stageIndex udledes af stages_completed; flag ON → stub kaldt med korrekt index.
test("runAdminSimulateStage: stageIndex = stages_completed; stub kaldt med korrekt index", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }], // flag ON
    races: [{ id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, stages_completed: 1, status: "scheduled" }],
    race_stage_profiles: [{ id: "p1" }, { id: "p2" }, { id: "p3" }], // 3/3 → profil-guard OK
  });
  let captured = null;
  const stub = async (args) => { captured = args; return { stageNumber: 2, isFinalStage: false }; };

  const result = await runAdminSimulateStage({ supabase, raceId: "r1", simulateStageByIndex: stub });

  assert.ok(captured, "simulateStageByIndex-stub skal kaldes");
  assert.equal(captured.stageIndex, 1, "stageIndex skal udledes af stages_completed (1)");
  assert.equal(captured.race.id, "r1");
  assert.equal(result.stageNumber, 2);
});

// P0 2/7: stages_completed >= stages + status != completed = finalization-pending →
// recovery: stub kaldes med FINAL-etapens index (simulateStageByIndex' finalization-
// Pending-sti er idempotent). Tidligere 409'ede denne tilstand → 13 løb sad fast for evigt.
test("runAdminSimulateStage: alle etaper kørt men ikke completed → recovery med final-etapens index", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],
    races: [{ id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, stages_completed: 3, status: "scheduled" }],
    race_stage_profiles: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
  });
  let captured = null;
  const result = await runAdminSimulateStage({
    supabase, raceId: "r1",
    simulateStageByIndex: async (args) => { captured = args; return { stageNumber: 3, isFinalStage: true }; },
  });
  assert.ok(captured, "stub SKAL kaldes (recovery)");
  assert.equal(captured.stageIndex, 2, "recovery skal bruge final-etapens index (stages-1)");
  assert.equal(result.stageNumber, 3);
});

// #2090: stale-tick-guard — kaldet var møntet på én etape, men løbet er imens bumpet.
test("runAdminSimulateStage: expectedStageIndex mismatch → 409, stub ikke kaldt (#2090)", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],
    // Scheduleren udvalgte etape-index 0 (stage 1 forfalden), men et overlappende
    // run har imens bumpet stages_completed til 1 → frisk næste etape = index 1.
    races: [{ id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 5, stages_completed: 1, status: "scheduled" }],
    race_stage_profiles: [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }, { id: "p5" }],
  });
  let stubCalled = false;
  let err = null;
  try {
    await runAdminSimulateStage({ supabase, raceId: "r1", expectedStageIndex: 0, simulateStageByIndex: async () => { stubCalled = true; return {}; } });
  } catch (e) { err = e; }
  assert.ok(err, "skal kaste");
  assert.equal(err.status, 409);
  assert.ok(String(err.message).includes("Stale tick"), `forventede stale-tick-fejl, fik: ${err.message}`);
  assert.equal(stubCalled, false, "stub må ikke kaldes ved stale tick");
});

test("runAdminSimulateStage: expectedStageIndex match → kører normalt (#2090)", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],
    races: [{ id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 5, stages_completed: 1, status: "scheduled" }],
    race_stage_profiles: [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }, { id: "p5" }],
  });
  let captured = null;
  await runAdminSimulateStage({ supabase, raceId: "r1", expectedStageIndex: 1, simulateStageByIndex: async (args) => { captured = args; return {}; } });
  assert.ok(captured, "stub skal kaldes ved match");
  assert.equal(captured.stageIndex, 1);
});

test("runAdminSimulateStage: recovery + expectedStageIndex=stages-1 fungerer sammen (#2090)", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],
    races: [{ id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, stages_completed: 3, status: "scheduled" }],
    race_stage_profiles: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
  });
  let captured = null;
  await runAdminSimulateStage({ supabase, raceId: "r1", expectedStageIndex: 2, simulateStageByIndex: async (args) => { captured = args; return {}; } });
  assert.ok(captured, "recovery-stub skal kaldes");
  assert.equal(captured.stageIndex, 2, "recovery bruger final-etapens index og matcher expected");
});

// dryRun har ingen recovery-semantik → 409 bevares dér.
test("runAdminSimulateStage: alle etaper kørt + dryRun → stadig 409, stub ikke kaldt", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],
    races: [{ id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, stages_completed: 3, status: "scheduled" }],
    race_stage_profiles: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
  });
  let stubCalled = false;
  let err = null;
  try {
    await runAdminSimulateStage({ supabase, raceId: "r1", dryRun: true, simulateStageByIndex: async () => { stubCalled = true; return {}; } });
  } catch (e) { err = e; }
  assert.ok(err, "skal kaste");
  assert.equal(err.status, 409);
  assert.equal(stubCalled, false, "stub må ikke kaldes ved dryRun-409");
});

// status=completed → 409.
test("runAdminSimulateStage: completed-løb → 409", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],
    races: [{ id: "r2", season_id: "s1", name: "Afviklet", race_type: "stage_race", race_class: "ProSeries", stages: 3, stages_completed: 3, status: "completed" }],
  });
  let err = null;
  try {
    await runAdminSimulateStage({ supabase, raceId: "r2", simulateStageByIndex: async () => ({}) });
  } catch (e) { err = e; }
  assert.ok(err, "skal kaste");
  assert.equal(err.status, 409);
});

// flag OFF + dryRun=false → 409 (samme flag-check som runAdminSimulateRace).
test("runAdminSimulateStage: flag OFF + dryRun=false → 409, stub ikke kaldt", async () => {
  const supabase = makeSupabase({
    app_config: [], // flag OFF
    races: [{ id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, stages_completed: 0, status: "scheduled" }],
    race_stage_profiles: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
  });
  let stubCalled = false;
  let err = null;
  try {
    await runAdminSimulateStage({ supabase, raceId: "r1", dryRun: false, simulateStageByIndex: async () => { stubCalled = true; return {}; } });
  } catch (e) { err = e; }
  assert.ok(err, "skal kaste");
  assert.equal(err.status, 409);
  assert.ok(err.message.includes("RACE_ENGINE_V2_ENABLED"), `forventet flag-besked, fik: ${err.message}`);
  assert.equal(stubCalled, false);
});

// delvise profiler (1/3) → 409 Delvise.
test("runAdminSimulateStage: delvise profiler (1/3) → 409 Delvise, stub ikke kaldt", async () => {
  const supabase = makeSupabase({
    app_config: [{ value: true }],
    races: [{ id: "r1", season_id: "s1", name: "Test GP", race_type: "stage_race", race_class: "ProSeries", stages: 3, stages_completed: 0, status: "scheduled" }],
    race_stage_profiles: [{ id: "p1" }], // 1/3
  });
  let stubCalled = false;
  let err = null;
  try {
    await runAdminSimulateStage({ supabase, raceId: "r1", simulateStageByIndex: async () => { stubCalled = true; return {}; } });
  } catch (e) { err = e; }
  assert.ok(err, "skal kaste");
  assert.equal(err.status, 409);
  assert.ok(err.message.includes("Partial"), `forventet "Partial", fik: ${err.message}`);
  assert.equal(stubCalled, false);
});

// manglende raceId → 400; ukendt raceId → 404.
test("runAdminSimulateStage: manglende raceId → 400; ukendt → 404", async () => {
  const sb1 = makeSupabase({});
  let err1 = null;
  try { await runAdminSimulateStage({ supabase: sb1, simulateStageByIndex: async () => ({}) }); } catch (e) { err1 = e; }
  assert.equal(err1.status, 400);

  const sb2 = makeSupabase({ races: [] });
  let err2 = null;
  try { await runAdminSimulateStage({ supabase: sb2, raceId: "ukendt", simulateStageByIndex: async () => ({}) }); } catch (e) { err2 = e; }
  assert.equal(err2.status, 404);
});
