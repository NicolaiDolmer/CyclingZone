// #4147 — beviser at en afbrydelse EFTER hvert enkelt afslutnings-trin bliver gjort
// færdig af næste tick, uden at noget trin får dobbelt effekt.
//
// Metoden: `writeFinalizeStateFn` er både markerings-skriveren OG crash-injektoren.
// Den persisterer markeringen FØRST og kaster derefter — præcis rækkefølgen ved et
// SIGKILL lige efter et trins commit, som er det farligste tidspunkt at dø på (trinnet
// ER kørt, markeringen ER skrevet, men resten af kæden nåede aldrig at starte).
// Derefter køres samme etape igen mod den samme markerings-butik, og vi tæller hvor
// mange gange hvert sideeffekt-bærende kald skete i ALT på tværs af de to kørsler.

import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateStageByIndex } from "./raceRunner.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";

function abil() {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = 50;
  return a;
}
function entrant(id, team_id) {
  return { rider_id: id, team_id, rider_name: id, is_u25: false, abilities: abil() };
}
const ENTRANTS = [
  ...["a1", "a2", "a3", "a4", "a5", "a6"].map((id) => entrant(id, "A")),
  ...["b1", "b2", "b3", "b4", "b5", "b6"].map((id) => entrant(id, "B")),
];
const STAGES_2 = [
  { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
];

function makeSupabase(canned, racesRowRef) {
  const writes = [];
  function rpc(name, params) {
    if (name === "apply_stage_result") {
      return Promise.resolve({ data: { lock_won: true, rows_imported: params.p_result_rows?.length ?? 0 }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }
  function from(table) {
    const rows = table === "races" ? [racesRowRef] : canned[table] || [];
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, or() { return b; },
      is() { return b; }, not() { return b; }, gt() { return b; }, order() { return b; },
      limit() { return b; }, range() { return b; }, gte() { return b; }, lt() { return b; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      insert(r) { writes.push({ table, op: "insert", rows: r }); return Promise.resolve({ error: null }); },
      upsert(r) { writes.push({ table, op: "upsert", rows: r }); return Promise.resolve({ error: null }); },
      update(obj) {
        writes.push({ table, op: "update", obj });
        if (table === "races") Object.assign(racesRowRef, obj);
        const u = {
          eq() { return u; }, in() { return u; }, is() { return u; },
          select() { return Promise.resolve({ data: [{ id: racesRowRef.id }], error: null }); },
          then(res) { return Promise.resolve({ error: null }).then(res); },
        };
        return u;
      },
      delete() {
        const d = { eq() { return d; }, in() { return d; }, then(res) { return Promise.resolve({ error: null }).then(res); } };
        return d;
      },
      then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
    };
    return b;
  }
  return { from, rpc, __writes: writes };
}

/**
 * Ét fuldt scenarie: kør etapen, dø efter `crashAfterStep`, kør den igen.
 * Returnerer tællerne for de sideeffekt-bærende kald summeret over BEGGE kørsler.
 */
async function runWithCrashAfter(crashAfterStep, { stageIndex = 1, stages = STAGES_2 } = {}) {
  const racesRow = {
    id: "race-1", season_id: "s1", name: "Test GP", race_type: "stage_race",
    race_class: "ProSeries", stages: stages.length, stages_completed: stageIndex, status: "scheduled",
  };
  const canned = {
    race_stage_profiles: stages,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: false, birthdate: "1995-01-01" })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: "s1", number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
  };

  // Markerings-butikken lever på tværs af de to kørsler — som DB'en gør i prod.
  const store = { finalize_state: null, finalize_updated_at: null };
  const counts = { applyStageResult: 0, fatigue: 0, restDay: 0, notifyDiscord: 0, notifyInApp: 0, board: 0, standings: 0, matview: 0 };
  let crashed = false;

  const deps = {
    checkFinalizeResumable: async () => true,
    readFinalizeStateFn: async () => ({ ...store }),
    writeFinalizeStateFn: async (_sb, _id, state, { now = new Date() } = {}) => {
      store.finalize_state = state;
      store.finalize_updated_at = state ? now.toISOString() : null;
      // Crash-injektor: markeringen ER landet, og så dør processen.
      const done = state?.done ?? [];
      if (!crashed && crashAfterStep && done[done.length - 1] === crashAfterStep) {
        crashed = true;
        throw new Error(`SIMULERET SIGKILL efter trin '${crashAfterStep}'`);
      }
      return true;
    },
    applyStageResult: async (_c, { resultRows }) => { counts.applyStageResult++; return { lockWon: true, rowsImported: resultRows.length }; },
    ensureSeasonStandings: async () => { counts.standings++; },
    updateStandings: async () => {},
    recomputeRaceDays: async () => { counts.board++; return 12; },
    processBoardWeekend: async () => ({}),
    applyFatigue: async () => { counts.fatigue++; },
    applyGrandTourRestDayFatigue: async () => { counts.restDay++; },
    notifyDiscord: async () => { counts.notifyDiscord++; },
    notifyInApp: async () => { counts.notifyInApp++; },
    notifyStageInApp: async () => { counts.notifyInApp++; },
  };

  const supabase = makeSupabase(canned, racesRow);
  let firstError = null;
  try {
    await simulateStageByIndex({ supabase, race: { ...racesRow }, stageIndex, ...deps });
  } catch (err) {
    firstError = err;
  }

  // ── Næste cron-tick: samme etape tages op igen med den markering der overlevede.
  const supabase2 = makeSupabase(canned, racesRow);
  const second = await simulateStageByIndex({ supabase: supabase2, race: { ...racesRow }, stageIndex, ...deps });

  return { counts, store, racesRow, firstError, second };
}

const FINAL_STAGE_STEPS = ["write", "standings", "matview", "enrichment", "fatigue", "board", "notify", "status-flush"];

for (const step of FINAL_STAGE_STEPS) {
  test(`#4147 afbrudt EFTER '${step}' på final-etapen → næste tick gør løbet færdigt uden dobbelt effekt`, async () => {
    const { counts, store, racesRow, firstError } = await runWithCrashAfter(step);

    assert.ok(firstError, "første kørsel skulle være afbrudt");
    assert.match(firstError.message, /SIMULERET SIGKILL/);

    // Løbet ER færdigt efter genoptagelsen.
    assert.equal(racesRow.status, "completed", "status blev aldrig flippet efter genoptagelsen");
    // Markeringen er ryddet — ingen igangværende afslutning tilbage.
    assert.equal(store.finalize_state, null, "markeringen blev ikke ryddet efter fuld afslutning");

    // Ingen dobbelt effekt på de trin der ikke tåler gentagelse.
    assert.equal(counts.applyStageResult, 1, "result-write kørte ikke præcis én gang");
    assert.equal(counts.fatigue, 1, "trætheds-skrivningen kørte ikke præcis én gang");
    assert.equal(counts.notifyDiscord, 1, "Discord-embed blev sendt et forkert antal gange");
    assert.equal(counts.notifyInApp, 1, "in-app-notifikationen blev sendt et forkert antal gange");
  });
}

test("#4147 afbrudt EFTER 'write' på en MELLEM-etape → berigelsen bliver gjort færdig (klassen med 34 tabte etaper)", async () => {
  const stages = [
    { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
    { stage_number: 2, profile_type: "hilly", demand_vector: DEMAND_VECTORS.hilly },
    { stage_number: 3, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  ];
  const { counts, store, racesRow, firstError } = await runWithCrashAfter("write", { stageIndex: 1, stages });

  assert.ok(firstError, "første kørsel skulle være afbrudt");
  // Mellem-etape: løbet er IKKE færdigt, men afslutningen af etapen er det.
  assert.equal(racesRow.status, "scheduled");
  assert.equal(store.finalize_state, null, "mellem-etapens markering blev ikke ryddet");
  assert.equal(counts.applyStageResult, 1, "result-write må ikke køre igen — rækkerne er skrevet");
  assert.equal(counts.fatigue, 1);
  assert.equal(counts.notifyInApp, 1, "etape-notifikationen blev sendt et forkert antal gange");
  // Mellem-etaper rører hverken board eller matview.
  assert.equal(counts.board, 0);
});

test("#4147 flaget OFF → ingen markering skrives overhovedet (adfærd som før)", async () => {
  const racesRow = {
    id: "race-off", season_id: "s1", name: "Flag Off", race_type: "stage_race",
    race_class: "ProSeries", stages: 2, stages_completed: 1, status: "scheduled",
  };
  const canned = {
    race_stage_profiles: STAGES_2,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: false, birthdate: "1995-01-01" })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: "s1", number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
  };
  let stateWrites = 0;
  let stateReads = 0;
  const supabase = makeSupabase(canned, racesRow);
  await simulateStageByIndex({
    supabase, race: { ...racesRow }, stageIndex: 1,
    checkFinalizeResumable: async () => false,
    readFinalizeStateFn: async () => { stateReads++; return null; },
    writeFinalizeStateFn: async () => { stateWrites++; return true; },
    applyStageResult: async (_c, { resultRows }) => ({ lockWon: true, rowsImported: resultRows.length }),
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async () => ({}),
    applyFatigue: async () => {},
  });
  assert.equal(stateReads, 0, "flaget OFF må ikke læse markeringen");
  assert.equal(stateWrites, 0, "flaget OFF må ikke skrive markeringen");
  assert.equal(racesRow.status, "completed", "den normale sti skal stadig afslutte løbet");
});

test("#4147 markering tilbage på et allerede completed løb (crash mellem status-flush og rydning) → ryddes, ingen gen-afvikling", async () => {
  const racesRow = {
    id: "race-done", season_id: "s1", name: "Done", race_type: "stage_race",
    race_class: "ProSeries", stages: 2, stages_completed: 2, status: "completed",
  };
  const canned = {
    race_stage_profiles: STAGES_2,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: false, birthdate: "1995-01-01" })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: "s1", number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
  };
  const store = {
    finalize_state: { stage_index: 1, stage_number: 2, final: true, started_at: null, done: FINAL_STAGE_STEPS },
    finalize_updated_at: "2026-09-04T18:00:00.000Z",
  };
  let applyCalls = 0;
  const res = await simulateStageByIndex({
    supabase: makeSupabase(canned, racesRow), race: { ...racesRow }, stageIndex: 1,
    checkFinalizeResumable: async () => true,
    readFinalizeStateFn: async () => ({ ...store }),
    writeFinalizeStateFn: async (_sb, _id, state) => { store.finalize_state = state; return true; },
    applyStageResult: async () => { applyCalls++; return { lockWon: true, rowsImported: 0 }; },
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async () => ({}),
    applyFatigue: async () => {},
  });
  assert.equal(applyCalls, 0, "et færdigt løb må ALDRIG gen-afvikles");
  assert.equal(store.finalize_state, null, "den efterladte markering blev ikke ryddet");
  assert.equal(res.alreadyComplete, true);
});
