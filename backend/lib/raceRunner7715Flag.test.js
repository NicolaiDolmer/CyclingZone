// #7715: tænd-ledningen for meget trætte ryttere. Kun app_config time_limit_fatigue_7715 = "on"
// tilbyder reglen; den gælder kun et løb der fik den bundet ved sin første etape, og kun
// under s5_profiles_v3 (og senere). Værdien er med i run-identiteten og i motor-argumenterne,
// så #1857-genafspilningen genskaber den.
//
// Slukket = bit-identisk med merge-basen FØR kontakten: __fixtures__/raceRunner7715FlagOff.json
// er skrevet af merge-basens kode (sourceCommit i filen) med de samme scenarier og genereres
// aldrig med den nye kode. Kun hashes; syntetisk fixture, ingen prod-data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TIME_LIMIT_FATIGUE_7715_FLAG_KEY,
  bindRaceTimeLimitFatigue7715,
  evaluateTimeLimitFatigue7715Flag,
  isTimeLimitFatigue7715Enabled,
  loadFatigueOutStages7715,
  raceTimeLimitFatigue7715Applies,
  riderOwnLevel7715,
  timeLimitFatigueSeverities7715,
  timeLimitRiskByRider7715,
} from "./timeLimitFatigue7715.js";
import { resolveRaceEngineV4, v4TimeLimitFatigue7715Arg, withRaceTimeLimitFatigue7715 } from "./raceRunner.js";
import { ENGINE_VERSION_V4, loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { FRESH_FLAG_KEYS } from "./featureStage.js";
import { findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { buildSnapshotRows, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";
import {
  OFF_DIGEST_CASES_7715, RACE_7715, computeOffDigests7715Runner, digests7715, entrants7715, stageByStage7715, stages7715, tiredRiderIds7715, wholeRace7715,
} from "./__fixtures__/raceRunner7715Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/raceRunner7715FlagOff.json", import.meta.url), "utf8"));

function configStub(value) {
  const seen = [];
  return {
    seen,
    from(table) {
      return { select: () => ({ eq: (col, key) => { seen.push([table, col, key]); return { maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }; } }) };
    },
  };
}

/** races-tabellen for én række; registrerer skrivninger og filtrene på dem. */
function racesStub(initial, { readError = null, updateError = null } = {}) {
  const state = { row: initial, updates: [] };
  return {
    state,
    from(table) {
      assert.equal(table, "races");
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => (readError ? { data: null, error: readError } : { data: state.row, error: null }) }) }),
        update: (patch) => {
          const filters = [];
          const chain = {
            eq: (col, value) => { filters.push(["eq", col, value]); return chain; },
            is: (col, value) => { filters.push(["is", col, value]); return chain; },
            then: (resolve) => {
              state.updates.push({ patch, filters });
              if (updateError) return resolve({ error: updateError });
              if (state.row.time_limit_fatigue_7715 == null && state.row.stages_completed === 0) state.row = { ...state.row, ...patch };
              return resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

const MISSING_COLUMN = { code: "42703", message: "column races.time_limit_fatigue_7715 does not exist" };
const RACE = { id: "r1", stages_completed: 0 };

function fatigueOut(outputs) {
  const ids = new Set();
  for (const output of outputs) {
    for (const e of output.v4Output?.timeline?.events ?? output.timeline?.events ?? []) {
      if (e.type === "outside_time_limit") for (const id of e.params?.fatigue_rider_ids ?? []) ids.add(id);
    }
  }
  return [...ids].sort();
}

// ── Flaget ───────────────────────────────────────────────────

test("#7715 flag: kun den eksakte streng 'on' tænder", () => {
  assert.equal(TIME_LIMIT_FATIGUE_7715_FLAG_KEY, "time_limit_fatigue_7715");
  assert.equal(evaluateTimeLimitFatigue7715Flag("on"), true);
  for (const v of ["off", "beta", true, false, null, undefined, "ON", 1, "true"]) {
    assert.equal(evaluateTimeLimitFatigue7715Flag(v), false, `${JSON.stringify(v)} er slukket`);
  }
});

test("#7715 flag: app_config-opslaget, fail-safe slukket, i kataloget og aldrig cachet", async () => {
  const on = configStub("on");
  assert.equal(await isTimeLimitFatigue7715Enabled(on), true);
  assert.deepEqual(on.seen, [["app_config", "key", "time_limit_fatigue_7715"]]);
  assert.equal(await isTimeLimitFatigue7715Enabled(configStub(undefined)), false);
  assert.equal(await isTimeLimitFatigue7715Enabled(configStub("beta")), false);
  assert.equal(isStageFlagKey("time_limit_fatigue_7715"), true);
  assert.equal(findStageFlag("time_limit_fatigue_7715").area, "race-engine");
  assert.equal(FRESH_FLAG_KEYS.has("time_limit_fatigue_7715"), true);
});

test("#7715 resolveRaceEngineV4: slukket = samme motor-objekt, fejl = slukket, tændt = kun et tilbud", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const base = {
    supabase: {}, race: RACE_7715, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [],
    checkFormPeaksEnabled: async () => true, checkDayForm6649Enabled: async () => false, checkQueenStageGap7236Enabled: async () => false,
    checkStagePlanDroppedFront7635Enabled: async () => false, checkDescentRegroupCap7644Enabled: async () => false, checkSplitAttackCause7640Enabled: async () => false,
    checkLetGoOrder7557Enabled: async () => false,
  };
  assert.equal((await resolveRaceEngineV4({ ...base, checkTimeLimitFatigue7715Enabled: async () => false })).v4Engine, engine);
  assert.equal((await resolveRaceEngineV4({ ...base, checkTimeLimitFatigue7715Enabled: async () => { throw new Error("db"); } })).v4Engine, engine);
  const on = await resolveRaceEngineV4({ ...base, checkTimeLimitFatigue7715Enabled: async () => true });
  assert.equal(on.v4Engine.timeLimitFatigue7715Offered, true);
  assert.equal(on.v4Engine.timeLimitFatigue7715, undefined, "tilbuddet alene sender intet til motoren");
  assert.equal("timeLimitFatigue7715Offered" in engine, false, "den indlæste motor muteres aldrig");
});

// ── Kun løb der ikke er startet ───────────────────────────────

test("#7715 withRaceTimeLimitFatigue7715: et bundet løb kører færdigt uden tilbud, og nødstop fjerner reglen", async () => {
  const engine = { version: "v4" };
  const bound = await withRaceTimeLimitFatigue7715({ v4Engine: engine, rulesRevision: "s5_profiles_v3", readBound: async () => true });
  assert.equal(bound.timeLimitFatigue7715, true);
  assert.equal(await withRaceTimeLimitFatigue7715({ v4Engine: engine, rulesRevision: "s5_profiles_v3", readBound: async () => false }), engine);
});

test("#7715 withRaceTimeLimitFatigue7715: uden tilbud bindes intet, og motoren er urørt", async () => {
  const engine = { simulateStage: () => ({}) };
  const bind = () => { throw new Error("må ikke kaldes"); };
  assert.equal(await withRaceTimeLimitFatigue7715({ v4Engine: engine, rulesRevision: "s5_profiles_v3", bind, readBound: async () => false }), engine);
  assert.equal(await withRaceTimeLimitFatigue7715({ v4Engine: null, rulesRevision: "s5_profiles_v3", bind }), null);
  const offered = { ...engine, timeLimitFatigue7715Offered: true };
  assert.equal(await withRaceTimeLimitFatigue7715({ v4Engine: offered, rulesRevision: "s5_profiles_v2", bind }), offered, "ældre revision");
});

test("#7715 withRaceTimeLimitFatigue7715: bindingen afgør", async () => {
  const offered = { timeLimitFatigue7715Offered: true };
  const yes = await withRaceTimeLimitFatigue7715({ v4Engine: offered, rulesRevision: "s5_profiles_v3", bind: async () => true });
  assert.equal(yes.timeLimitFatigue7715, true);
  assert.equal(await withRaceTimeLimitFatigue7715({ v4Engine: offered, rulesRevision: "s5_profiles_v3", bind: async () => false }), offered);
});

test("#7715 bind: første claim på et ikke-startet løb binder, betinget på NULL og 0 etaper", async () => {
  const db = racesStub({ time_limit_fatigue_7715: null, stages_completed: 0 });
  assert.equal(await bindRaceTimeLimitFatigue7715({ supabase: db, race: RACE, firstStageClaim: true }), true);
  assert.deepEqual(db.state.updates[0].filters, [["eq", "id", "r1"], ["is", "time_limit_fatigue_7715", null], ["eq", "stages_completed", 0]]);
});

test("#7715 bind: et løb der allerede kører, får aldrig reglen midt i løbet", async () => {
  const running = racesStub({ time_limit_fatigue_7715: null, stages_completed: 2 });
  assert.equal(await bindRaceTimeLimitFatigue7715({ supabase: running, race: { id: "r1", stages_completed: 2 }, firstStageClaim: false }), false);
  assert.equal(await bindRaceTimeLimitFatigue7715({ supabase: running, race: { id: "r1", stages_completed: 2 }, firstStageClaim: true }), false);
  assert.equal(running.state.updates.length, 0);
  const retry = racesStub({ time_limit_fatigue_7715: null, stages_completed: 0 });
  assert.equal(await bindRaceTimeLimitFatigue7715({ supabase: retry, race: RACE, firstStageClaim: false }), false, "kun første claim binder");
});

test("#7715 bind: et bundet løb bliver ved, og dryRun skriver intet", async () => {
  const bound = racesStub({ time_limit_fatigue_7715: true, stages_completed: 3 });
  assert.equal(await bindRaceTimeLimitFatigue7715({ supabase: bound, race: { id: "r1", stages_completed: 3 }, firstStageClaim: false }), true);
  const dry = racesStub({ time_limit_fatigue_7715: null, stages_completed: 0 });
  assert.equal(await bindRaceTimeLimitFatigue7715({ supabase: dry, race: RACE, firstStageClaim: true, dryRun: true }), true);
  assert.equal(dry.state.updates.length, 0);
});

test("#7715 bind: manglende kolonne (migrationen ikke kørt) = slukket, andre fejl kaster", async () => {
  assert.equal(await bindRaceTimeLimitFatigue7715({ supabase: racesStub({}, { readError: MISSING_COLUMN }), race: RACE, firstStageClaim: true }), false);
  assert.equal(await bindRaceTimeLimitFatigue7715({ supabase: racesStub({ time_limit_fatigue_7715: null, stages_completed: 0 }, { updateError: MISSING_COLUMN }), race: RACE, firstStageClaim: true }), false);
  await assert.rejects(bindRaceTimeLimitFatigue7715({ supabase: racesStub({}, { readError: { message: "boom" } }), race: RACE, firstStageClaim: true }), /kunne ikke laeses/);
});

test("#7715 applies: varslet følger samme regel som motoren", async () => {
  const on = async () => true;
  const off = async () => false;
  assert.equal(await raceTimeLimitFatigue7715Applies({ supabase: {}, race: RACE, checkEnabled: off }), false, "slukket: intet opslag");
  assert.equal(await raceTimeLimitFatigue7715Applies({ supabase: {}, race: RACE, checkEnabled: async () => { throw new Error("db"); } }), false);
  assert.equal(await raceTimeLimitFatigue7715Applies({ supabase: {}, race: RACE, checkEnabled: on }), true, "ikke startet");
  const started = { id: "r1", stages_completed: 1 };
  assert.equal(await raceTimeLimitFatigue7715Applies({ supabase: racesStub({ time_limit_fatigue_7715: true }), race: started, checkEnabled: on }), true);
  assert.equal(await raceTimeLimitFatigue7715Applies({ supabase: racesStub({ time_limit_fatigue_7715: null }), race: started, checkEnabled: on }), false);
  assert.equal(await raceTimeLimitFatigue7715Applies({ supabase: racesStub({}, { readError: MISSING_COLUMN }), race: started, checkEnabled: on }), false);
});

test("#7715 v4TimeLimitFatigue7715Arg: kun bundet og s5_profiles_v3 eller nyere", () => {
  assert.deepEqual(v4TimeLimitFatigue7715Arg({ timeLimitFatigue7715: true }, "s5_profiles_v3"), { timeLimitFatigue7715: true });
  assert.deepEqual(v4TimeLimitFatigue7715Arg({ timeLimitFatigue7715: true }, "s5_profiles_v2"), {});
  assert.deepEqual(v4TimeLimitFatigue7715Arg({ timeLimitFatigue7715Offered: true }, "s5_profiles_v3"), {}, "et tilbud alene er ikke en binding");
  assert.deepEqual(v4TimeLimitFatigue7715Arg(null, "s5_profiles_v3"), {});
});

// ── Varslet og motoren regner ens ─────────────────────────────

test("#7715 varslet: kun haarde etaper, kun de udkørte, og fladen får aldrig et tal", () => {
  const stages = stages7715();
  const risk = timeLimitRiskByRider7715({ riders: entrants7715(), stages, race: { ...RACE_7715, stages_completed: 0, engine_rules_revision: "s5_profiles_v3" } });
  const tired = new Set(tiredRiderIds7715());
  assert.ok(Object.keys(risk).length > 0, "scenariet skal ramme");
  for (const [riderId, byStage] of Object.entries(risk)) {
    assert.ok(tired.has(riderId), riderId);
    for (const [stageNumber, flag] of Object.entries(byStage)) {
      assert.equal(flag, true);
      assert.notEqual(stages.find((s) => String(s.stage_number) === stageNumber).profile_type, "flat");
    }
  }
});

test("#7715 varslet: regner intet under en ældre revision", () => {
  const risk = timeLimitRiskByRider7715({ riders: entrants7715(), stages: stages7715(), race: { ...RACE_7715, stages_completed: 2, engine_rules_revision: "s5_profiles_v2" } });
  assert.deepEqual(risk, {});
});

test("#7715 eget niveau: snittet af evnerne, intet tal uden evner", () => {
  assert.equal(riderOwnLevel7715(null), null);
  assert.ok(riderOwnLevel7715({ climbing: 99 }) > 0);
  assert.deepEqual(timeLimitFatigueSeverities7715({ riders: entrants7715(), stageRow: null, revision: "s5_profiles_v3" }), {});
});

function timelinesStub(rows, { error = null, bound = true } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      if (table === "races") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { time_limit_fatigue_7715: bound ? true : null, stages_completed: 2 }, error: null }) }) }) };
      assert.equal(table, "race_stage_timelines");
      return { select: () => ({ eq: () => ({ order: async () => (error ? { data: null, error } : { data: rows, error: null }) }) }) };
    },
  };
}

test("#7715 forklaringen: kun egne ryttere motoren satte ud af træthed, ikke andre OTL", async () => {
  const rows = [
    { stage_number: 1, events: [{ type: "finish" }] },
    { stage_number: 2, events: [{ type: "outside_time_limit", params: { rider_ids: ["a", "b", "c"], rider_count: 3, fatigue_rider_ids: ["a", "c"] } }] },
  ];
  const out = await loadFatigueOutStages7715({ supabase: timelinesStub(rows), race: RACE, riderIds: ["a", "b"] });
  assert.deepEqual([...out], [["a", 2]]);
});

test("#7715 forklaringen: ingen udgåede = intet opslag, og en fejl vælter aldrig fladen", async () => {
  const none = timelinesStub([]);
  assert.equal((await loadFatigueOutStages7715({ supabase: none, race: RACE, riderIds: [] })).size, 0);
  assert.deepEqual(none.calls, []);
  assert.equal((await loadFatigueOutStages7715({ supabase: timelinesStub([], { error: { message: "boom" } }), race: RACE, riderIds: ["a"] })).size, 0);
  assert.equal((await loadFatigueOutStages7715({ supabase: { from() { throw new Error("db"); } }, race: RACE, riderIds: ["a"] })).size, 0);
});

// ── Slukket = bit-identisk med merge-basen ─────────────────────

test("#7715 slukket: den frosne fixture er fra merge-basen og dækker præcis scenarierne", () => {
  assert.match(FROZEN.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(FROZEN).filter((k) => k !== "sourceCommit" && k !== "note"), OFF_DIGEST_CASES_7715.map((c) => c.key));
});

test("#7715 slukket: checksum, motor-input og output er bit-identiske med merge-basen", async () => {
  const now = await computeOffDigests7715Runner();
  for (const c of OFF_DIGEST_CASES_7715) assert.deepEqual(now[c.key], FROZEN[c.key], c.key);
});

test("#7715 tilbud uden binding: stadig bit-identisk med merge-basen", async () => {
  const engine = await loadRaceEngineV4();
  const now = await computeOffDigests7715Runner({ ...engine, timeLimitFatigue7715Offered: true });
  for (const c of OFF_DIGEST_CASES_7715) assert.deepEqual(now[c.key], FROZEN[c.key], c.key);
});

// ── Tændt ──────────────────────────────────────────────────────

test("#7715 slukket: scenariet viser fejlen (ingen rytter ryger ud på sin træthed)", async () => {
  const off = wholeRace7715(await loadRaceEngineV4(), "s5_profiles_v3");
  assert.deepEqual(fatigueOut(off.outputs), []);
});

test("#7715 tændt: en udkørt rytter ryger ud på bjerget, med træthed som årsag, og kun dem med mærket", async () => {
  const engine = await loadRaceEngineV4();
  const on = stageByStage7715({ ...engine, timeLimitFatigue7715: true }, "s5_profiles_v3", 1);
  const out = fatigueOut(on.outputs);
  assert.ok(out.length > 0, "scenariet skal ramme");
  const tired = new Set(tiredRiderIds7715());
  for (const id of out) assert.ok(tired.has(id), id);
});

test("#7715 tændt: run-identiteten ændres, og genafspilningen genskaber etapen", async () => {
  const engine = await loadRaceEngineV4();
  const on = wholeRace7715({ ...engine, timeLimitFatigue7715: true }, "s5_profiles_v3");
  const digests = await digests7715(on);
  assert.notDeepEqual(digests.inputChecksums, FROZEN["wholeRace:s5_profiles_v3"].inputChecksums);
  const rows = await buildSnapshotRows({ raceId: RACE_7715.id, recorder: on.recorder });
  for (const row of rows) {
    const replay = await replayEngineInput(decodeSnapshot(row));
    assert.equal(replay.outputSha256, row.output_sha256, `etape ${row.stage_number}`);
  }
});

test("#7715 tændt: under s5_profiles_v2 gør kontakten intet", async () => {
  const engine = await loadRaceEngineV4();
  const off = await digests7715(wholeRace7715(engine, "s5_profiles_v2"));
  const on = await digests7715(wholeRace7715({ ...engine, timeLimitFatigue7715: true }, "s5_profiles_v2"));
  assert.deepEqual(on, off);
});

test("#7715 forklaringen: et løb uden binding læser aldrig tidslinjerne", async () => {
  const stub = timelinesStub([], { bound: false });
  assert.equal((await loadFatigueOutStages7715({ supabase: stub, race: RACE, riderIds: ["a"] })).size, 0);
  assert.deepEqual(stub.calls, ["races"]);
});
