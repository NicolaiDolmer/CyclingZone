// #7726 (ejer 5/11): kontakten der fjerner enkeltstartens ekstra terning.
// Kun app_config itt_no_day_roll_7726 = "on" taender, kun under s5_profiles_v3, og kun for
// loeb der ikke var startet: stemplet races.itt_no_day_roll_7726 saettes ved foerste etape-claim.
//
// Slukket = bit-identisk med merge-basen FOER kontakten: __fixtures__/raceRunner7726FlagOff.json
// er skrevet af merge-basens kode (sourceCommit i filen) med de samme scenarier
// (__fixtures__/raceRunner7726Scenarios.js) og genereres aldrig med den nye kode.
// Kun hashes; syntetisk fixture, ingen prod-data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ITT_NO_DAY_ROLL_7726_FLAG_KEY, bindIttNoDayRoll7726, evaluateIttNoDayRoll7726Flag, isIttNoDayRoll7726Enabled,
} from "./ittNoDayRoll7726Flag.js";
import { resolveRaceEngineV4, v4IttNoDayRoll7726Arg } from "./raceRunner.js";
import { ENGINE_VERSION_V4, createRaceEngineV4Adapter, loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { buildSnapshotRows, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";
import {
  OFF_DIGEST_CASES_7726, RACE_7726, computeOffDigests7726, stageByStage7726, stages7726, wholeRace7726,
} from "./__fixtures__/raceRunner7726Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/raceRunner7726FlagOff.json", import.meta.url), "utf8"));

// ── Flaget ─────────────────────────────────────────────────────────────

function configStub(value, { error = null, throws = false } = {}) {
  const seen = [];
  return {
    seen,
    from(table) {
      if (throws) throw new Error("boom");
      return {
        select: () => ({
          eq: (col, key) => {
            seen.push([table, col, key]);
            return { maybeSingle: async () => (error ? { data: null, error } : { data: value === undefined ? null : { value }, error: null }) };
          },
        }),
      };
    },
  };
}

test("#7726 flag: kun den eksakte streng 'on' taender", () => {
  assert.equal(ITT_NO_DAY_ROLL_7726_FLAG_KEY, "itt_no_day_roll_7726");
  assert.equal(evaluateIttNoDayRoll7726Flag("on"), true);
  for (const v of ["off", "beta", true, false, null, undefined, "ON", 1, "true"]) {
    assert.equal(evaluateIttNoDayRoll7726Flag(v), false, `${JSON.stringify(v)} er slukket`);
  }
});

test("#7726 flag: app_config-opslaget, fail-safe slukket ved fravaer og fejl", async () => {
  const on = configStub("on");
  assert.equal(await isIttNoDayRoll7726Enabled(on), true);
  assert.deepEqual(on.seen, [["app_config", "key", "itt_no_day_roll_7726"]]);
  assert.equal(await isIttNoDayRoll7726Enabled(configStub(undefined)), false, "raekken mangler");
  assert.equal(await isIttNoDayRoll7726Enabled(configStub("off")), false, "seedet off");
  assert.equal(await isIttNoDayRoll7726Enabled(configStub("beta")), false, "ingen beta-tilstand");
  assert.equal(await isIttNoDayRoll7726Enabled(configStub("on", { error: { message: "x" } })), false, "opslagsfejl");
  assert.equal(await isIttNoDayRoll7726Enabled(configStub("on", { throws: true })), false, "kast");
  assert.equal(await isIttNoDayRoll7726Enabled(null), false, "ingen klient");
});

test("#7726 flag: registreret i stadie-kataloget som motor-flag", () => {
  assert.equal(isStageFlagKey(ITT_NO_DAY_ROLL_7726_FLAG_KEY), true);
  assert.equal(findStageFlag(ITT_NO_DAY_ROLL_7726_FLAG_KEY).area, "race-engine");
});

test("#7726 flag: migrationen seeder raekken 'off' og tilfoejer stemplet, additivt og idempotent", () => {
  const sql = readFileSync(new URL("../../database/2026-11-06-7726-itt-no-day-roll.sql", import.meta.url), "utf8");
  assert.match(sql, /'itt_no_day_roll_7726',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS itt_no_day_roll_7726 boolean;/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i);
});

// ── raceRunner: laesning + argument ───────────────────────────────────────

test("#7726 resolveRaceEngineV4: flaget laeses een gang; slukket/fejl = samme motor som foer", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const base = {
    supabase: {}, race: RACE_7726, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [],
    checkFormPeaksEnabled: async () => true, checkDayForm6649Enabled: async () => false, checkQueenStageGap7236Enabled: async () => false,
  };
  const off = await resolveRaceEngineV4({ ...base, checkIttNoDayRoll7726Enabled: async () => false });
  assert.equal(off.v4Engine, engine, "slukket: intet wrapper-lag, ingen markering");
  const failed = await resolveRaceEngineV4({ ...base, checkIttNoDayRoll7726Enabled: async () => { throw new Error("db"); } });
  assert.equal(failed.v4Engine, engine, "fejl i opslaget = slukket, motoren koerer stadig");
  const dflt = await resolveRaceEngineV4(base);
  assert.equal(dflt.v4Engine, engine, "default-opslaget uden app_config-raekke = slukket");
  let calls = 0;
  const on = await resolveRaceEngineV4({ ...base, checkIttNoDayRoll7726Enabled: async () => { calls += 1; return true; } });
  assert.equal(calls, 1);
  assert.equal(on.v4Engine.ittNoDayRoll7726, true);
  assert.equal(on.v4Engine.version, ENGINE_VERSION_V4);
  assert.equal("ittNoDayRoll7726" in engine, false, "den indlaeste motor muteres aldrig");
  // v4 slukket: flaget laeses slet ikke.
  let read = false;
  const v3 = await resolveRaceEngineV4({ ...base, checkV4Enabled: async () => false, checkIttNoDayRoll7726Enabled: async () => { read = true; return true; } });
  assert.equal(v3.v4Engine, null);
  assert.equal(read, false);
});

test("#7726 v4IttNoDayRoll7726Arg: kun markering OG s5_profiles_v3 eller nyere", () => {
  const on = { ittNoDayRoll7726: true };
  assert.deepEqual(v4IttNoDayRoll7726Arg(on, "s5_profiles_v3"), { ittNoDayRoll7726: true });
  for (const rev of ["legacy", "orders_gc_v1", "s5_profiles_v1", "s5_profiles_v2", undefined, null]) {
    assert.deepEqual(v4IttNoDayRoll7726Arg(on, rev), {}, `revision ${rev}`);
  }
  assert.deepEqual(v4IttNoDayRoll7726Arg({}, "s5_profiles_v3"), {});
  assert.deepEqual(v4IttNoDayRoll7726Arg(null, "s5_profiles_v3"), {});
});

// ── Stemplet: kun loeb der ikke er startet ─────────────────────────────────

/** Races-tabellen for ét loeb. `afterUpdate` efterligner en claim der vinder imens. */
function racesStub(row, { readError = null, updateError = null, afterUpdate = null } = {}) {
  const log = { reads: 0, updates: [] };
  const state = { ...row };
  const client = {
    from(table) {
      assert.equal(table, "races");
      return {
        select(cols) {
          assert.equal(cols, "itt_no_day_roll_7726, stages_completed");
          return {
            eq: () => ({
              maybeSingle: async () => {
                log.reads += 1;
                return readError ? { data: null, error: readError } : { data: { ...state }, error: null };
              },
            }),
          };
        },
        update(patch) {
          const filters = [];
          const chain = {
            eq(col, value) { filters.push(["eq", col, value]); return chain; },
            is(col, value) { filters.push(["is", col, value]); return chain; },
            then(resolve) {
              log.updates.push({ patch, filters });
              if (!updateError) Object.assign(state, afterUpdate ?? patch);
              resolve({ error: updateError });
            },
          };
          return chain;
        },
      };
    },
  };
  return { client, log, state };
}

const MARKED = Object.freeze({ version: ENGINE_VERSION_V4, ittNoDayRoll7726: true });
const bindArgs = (client, over = {}) => ({ supabase: client, race: { id: "r1", stages_completed: 0 }, v4Engine: MARKED, rulesRevision: "s5_profiles_v3", firstStageClaim: true, ...over });
const MISSING = { code: "42703", message: "column races.itt_no_day_roll_7726 does not exist" };

test("#7726 bind: v3-motor = intet DB-kald; slukket uden stempel = samme objekt og intet skrives", async () => {
  const noDb = { from() { throw new Error("intet DB-kald paa v3-motoren"); } };
  assert.equal(await bindIttNoDayRoll7726(bindArgs(noDb, { v4Engine: null })), null);
  const engine = { version: ENGINE_VERSION_V4 };
  const { client, log } = racesStub({ itt_no_day_roll_7726: null, stages_completed: 0 });
  assert.equal(await bindIttNoDayRoll7726(bindArgs(client, { v4Engine: engine })), engine);
  assert.equal(log.updates.length, 0);
  const missing = racesStub({}, { readError: MISSING });
  assert.equal(await bindIttNoDayRoll7726(bindArgs(missing.client, { v4Engine: engine })), engine);
});

test("#7726 bind: slukket kontakt rammer kun nye loeb; et stemplet loeb koerer faerdigt (ejer 6/11)", async () => {
  const engine = { version: ENGINE_VERSION_V4 };
  const off = async () => "off";
  const { client, log } = racesStub({ itt_no_day_roll_7726: true, stages_completed: 3 });
  const out = await bindIttNoDayRoll7726(bindArgs(client, { v4Engine: engine, firstStageClaim: false, readStage: off }));
  assert.equal(out.ittNoDayRoll7726, true);
  assert.equal(log.updates.length, 0);
  const failing = async () => { throw new Error("opslag fejlede"); };
  const kept = await bindIttNoDayRoll7726(bindArgs(client, { v4Engine: engine, firstStageClaim: false, readStage: failing }));
  assert.equal(kept.ittNoDayRoll7726, true, "en opslagsfejl aendrer aldrig et loeb i gang");
});

test("#7726 bind: noedstop 'stop' fjerner reglen fra et stemplet loeb", async () => {
  const engine = { version: ENGINE_VERSION_V4 };
  const { client } = racesStub({ itt_no_day_roll_7726: true, stages_completed: 3 });
  const out = await bindIttNoDayRoll7726(bindArgs(client, { v4Engine: engine, firstStageClaim: false, readStage: async () => "stop" }));
  assert.equal(out, engine);
});

test("#7726 bind: aeldre revision faar aldrig kontakten og skriver intet", async () => {
  const noDb = { from() { throw new Error("intet DB-kald"); } };
  const out = await bindIttNoDayRoll7726(bindArgs(noDb, { rulesRevision: "s5_profiles_v2" }));
  assert.equal("ittNoDayRoll7726" in out, false);
  assert.equal(out.version, ENGINE_VERSION_V4);
});

test("#7726 bind: et ikke-startet loeb stemples ved foerste claim, atomisk og kun hvis det stadig er ustartet", async () => {
  const { client, log, state } = racesStub({ itt_no_day_roll_7726: null, stages_completed: 0 });
  const out = await bindIttNoDayRoll7726(bindArgs(client));
  assert.equal(out, MARKED);
  assert.equal(state.itt_no_day_roll_7726, true);
  assert.deepEqual(log.updates, [{
    patch: { itt_no_day_roll_7726: true },
    filters: [["eq", "id", "r1"], ["is", "itt_no_day_roll_7726", null], ["eq", "stages_completed", 0]],
  }]);
  assert.equal(log.reads, 2, "genlaeses efter skrivningen");
});

test("#7726 bind: et stemplet loeb beholder kontakten paa senere etaper og skriver intet", async () => {
  const { client, log } = racesStub({ itt_no_day_roll_7726: true, stages_completed: 3 });
  const out = await bindIttNoDayRoll7726(bindArgs(client, { firstStageClaim: false }));
  assert.equal(out, MARKED);
  assert.equal(log.updates.length, 0);
});

test("#7726 bind: et startet loeb uden stempel beholder terningen, ogsaa med kontakten taendt", async () => {
  const started = racesStub({ itt_no_day_roll_7726: null, stages_completed: 2 });
  const out = await bindIttNoDayRoll7726(bindArgs(started.client, { firstStageClaim: false }));
  assert.equal("ittNoDayRoll7726" in out, false);
  assert.equal(started.log.updates.length, 0);
  // Ogsaa selvom kalderen tror det er foerste claim: raekkens stages_completed afgoer.
  const claimed = racesStub({ itt_no_day_roll_7726: null, stages_completed: 1 });
  const out2 = await bindIttNoDayRoll7726(bindArgs(claimed.client));
  assert.equal("ittNoDayRoll7726" in out2, false);
  assert.equal(claimed.log.updates.length, 0);
  // En genoptagelse af foerste etape (ikke en claim) stempler heller ikke.
  const resumed = racesStub({ itt_no_day_roll_7726: null, stages_completed: 0 });
  const out3 = await bindIttNoDayRoll7726(bindArgs(resumed.client, { firstStageClaim: false }));
  assert.equal("ittNoDayRoll7726" in out3, false);
  assert.equal(resumed.log.updates.length, 0);
});

test("#7726 bind: startede loebet imens, gaelder den gemte vaerdi og ikke den vi ville skrive", async () => {
  const { client } = racesStub({ itt_no_day_roll_7726: null, stages_completed: 0 }, { afterUpdate: { stages_completed: 1 } });
  const out = await bindIttNoDayRoll7726(bindArgs(client));
  assert.equal("ittNoDayRoll7726" in out, false);
});

test("#7726 bind: dryRun skriver aldrig, men previewer et ikke-startet loeb med kontakten", async () => {
  const { client, log } = racesStub({ itt_no_day_roll_7726: null, stages_completed: 0 });
  assert.equal(await bindIttNoDayRoll7726(bindArgs(client, { dryRun: true })), MARKED);
  assert.equal(log.updates.length, 0);
});

test("#7726 bind: migrationen er ikke applied = slukket, loebet koerer videre", async () => {
  const onRead = racesStub({}, { readError: MISSING });
  assert.equal("ittNoDayRoll7726" in await bindIttNoDayRoll7726(bindArgs(onRead.client)), false);
  const onWrite = racesStub({ itt_no_day_roll_7726: null, stages_completed: 0 }, { updateError: { code: "PGRST204", message: "Could not find the 'itt_no_day_roll_7726' column" } });
  assert.equal("ittNoDayRoll7726" in await bindIttNoDayRoll7726(bindArgs(onWrite.client)), false);
});

test("#7726 bind: en rigtig DB-fejl stopper etapen hoejlydt i stedet for at koere paa de forkerte regler", async () => {
  const onRead = racesStub({}, { readError: { code: "500", message: "connection lost" } });
  await assert.rejects(bindIttNoDayRoll7726(bindArgs(onRead.client)), /kunne ikke laeses/);
  const onWrite = racesStub({ itt_no_day_roll_7726: null, stages_completed: 0 }, { updateError: { code: "500", message: "connection lost" } });
  await assert.rejects(bindIttNoDayRoll7726(bindArgs(onWrite.client)), /kunne ikke bindes/);
});

// ── Slukket = bit-identisk med merge-basen ─────────────────────────────────

test("#7726 slukket: den frosne fixture er fra merge-basen og daekker praecis scenarierne", () => {
  assert.match(FROZEN.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(FROZEN).filter((k) => k !== "sourceCommit" && k !== "note"), OFF_DIGEST_CASES_7726.map((c) => c.key));
});

test("#7726 slukket: checksum, motor-input og output er bit-identiske med merge-basen", async () => {
  const now = await computeOffDigests7726();
  for (const c of OFF_DIGEST_CASES_7726) {
    assert.deepEqual(now[c.key], FROZEN[c.key], c.key);
  }
});

// ── Taendt: kontakten naar broen, run-identiteten og genafspilningen ──────

async function snapshots(recorder) {
  const rows = await buildSnapshotRows({ raceId: RACE_7726.id, recorder });
  return rows.map((row) => ({ row, payload: decodeSnapshot(row) }));
}

test("#7726 taendt under en aeldre revision: ingen effekt, samme checksum og output som slukket", async () => {
  const real = await loadRaceEngineV4();
  const on = wholeRace7726({ ...real, ittNoDayRoll7726: true }, "s5_profiles_v2");
  const sn = await snapshots(on.recorder);
  const frozen = FROZEN["wholeRace:s5_profiles_v2"];
  assert.deepEqual(on.result.runs.map((r) => r.input_checksum), frozen.inputChecksums);
  assert.deepEqual(sn.map((s) => s.row.input_sha256), frozen.inputSha256);
  assert.deepEqual(sn.map((s) => s.row.output_sha256), frozen.outputSha256);
});

test("#7726 taendt under s5_profiles_v3: vejetapen er uroert, enkeltstarterne aendres, genafspilningen genskaber det", async () => {
  const real = await loadRaceEngineV4();
  const on = wholeRace7726({ ...real, ittNoDayRoll7726: true }, "s5_profiles_v3");
  const sn = await snapshots(on.recorder);
  const frozen = FROZEN["wholeRace:s5_profiles_v3"];
  assert.equal(sn.length, stages7726().length);
  for (let i = 0; i < sn.length; i += 1) {
    assert.equal(sn[i].payload.args.ittNoDayRoll7726, true, `etape ${i + 1}: kontakten er i motor-argumenterne`);
    assert.notEqual(on.result.runs[i].input_checksum, frozen.inputChecksums[i], `etape ${i + 1}: ny run-identitet`);
    const replay = await replayEngineInput(sn[i].payload);
    assert.equal(replay.outputSha256, sn[i].row.output_sha256, `etape ${i + 1}: genafspilning bit-identisk`);
  }
  assert.equal(sn[0].row.output_sha256, frozen.outputSha256[0], "vejetapen har ingen terning at fjerne");
  assert.notEqual(sn[1].row.output_sha256, frozen.outputSha256[1], "flad enkeltstart aendres");
  assert.notEqual(sn[2].row.output_sha256, frozen.outputSha256[2], "kuperet enkeltstart aendres");
});

test("#7726 stage-by-stage: kontakten i argumenter og checksum + bit-identisk genafspilning", async () => {
  const real = await loadRaceEngineV4();
  const on = stageByStage7726({ ...real, ittNoDayRoll7726: true }, "s5_profiles_v3", 1);
  const [sn] = await snapshots(on.recorder);
  const frozen = FROZEN["stageByStage:s5_profiles_v3:stage2"];
  assert.equal(sn.payload.args.ittNoDayRoll7726, true);
  assert.notEqual(on.result.runs[0].input_checksum, frozen.inputChecksums[0], "ny run-identitet");
  const replay = await replayEngineInput(sn.payload);
  assert.equal(replay.outputSha256, sn.row.output_sha256);
});

// Den rigtige bro over de rigtige v4-moduler, med en kerne der noterer StageInput.
async function spiedEngine() {
  const [core, tuning, entrants, route, orders, timeline] = await Promise.all([
    import("./engine/v4/index.ts"), import("./engine/v4/tuning.ts"), import("./engine/v4/adapters/entrantAdapter.ts"),
    import("./engine/v4/adapters/routeAdapter.ts"), import("./engine/v4/orders/teamOrdersAdapter.ts"), import("./engine/v4/timeline.ts"),
  ]);
  const inputs = [];
  const spyCore = {
    ...core,
    simulateStageV4: (input) => { inputs.push(input); return core.simulateStageV4(input); },
    simulateStageV4WithTrace: (input) => { inputs.push(input); return core.simulateStageV4WithTrace(input); },
  };
  return { engine: createRaceEngineV4Adapter({ core: spyCore, tuning, entrants, route, orders, timeline }), inputs };
}

test("#7726 broen: raceRunners kontakt bliver til StageInput.itt_no_day_roll_7726, kun under s5_profiles_v3", async () => {
  const on = await spiedEngine();
  wholeRace7726({ ...on.engine, ittNoDayRoll7726: true }, "s5_profiles_v3");
  assert.equal(on.inputs.length, stages7726().length);
  assert.ok(on.inputs.every((i) => i.itt_no_day_roll_7726 === true), "taendt: alle etaper faar kontakten");
  const off = await spiedEngine();
  wholeRace7726(off.engine, "s5_profiles_v3");
  assert.ok(off.inputs.every((i) => !("itt_no_day_roll_7726" in i)), "slukket: noeglen findes ikke");
  const older = await spiedEngine();
  wholeRace7726({ ...older.engine, ittNoDayRoll7726: true }, "s5_profiles_v2");
  assert.ok(older.inputs.every((i) => !("itt_no_day_roll_7726" in i)), "aeldre revision: aldrig");
});
