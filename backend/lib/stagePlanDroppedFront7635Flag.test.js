// #7635 (ejer 4/11, loesning A): tænd-ledningen for etapeplanens "sat"-regel.
// Kun app_config stage_plan_dropped_front_7635 = "on" taender; raceRunner sender kontakten til
// broen KUN under s5_profiles_v3 (og senere); vaerdien er med i run-identiteten
// (input_checksum) og i motor-argumenterne, saa #1857-genafspilningen genskaber den.
//
// Slukket = bit-identisk med merge-basen FOER kontakten:
// __fixtures__/stagePlanDroppedFront7635FlagOff.json er skrevet af merge-basens kode
// (sourceCommit i filen) med de samme scenarier (__fixtures__/stagePlanDroppedFront7635Scenarios.js,
// etapeplaner for alle hold) og genereres aldrig med den nye kode. Kun hashes; syntetisk, ingen prod-data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  STAGE_PLAN_DROPPED_FRONT_7635_FLAG_KEY, evaluateStagePlanDroppedFront7635Flag, isStagePlanDroppedFront7635Enabled,
} from "./stagePlanDroppedFront7635Flag.js";
import { resolveRaceEngineV4, v4StagePlanDroppedFront7635Arg } from "./raceRunner.js";
import { ENGINE_VERSION_V4, createRaceEngineV4Adapter, loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { PLAYER_VISIBLE_BINARY_FLAG_KEYS, PLAYER_VISIBLE_FLAG_KEYS, findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { buildSnapshotRows, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";
import {
  OFF_DIGEST_CASES_7635, RACE_7635, computeOffDigests7635, stageByStage7635, stages7635, wholeRace7635,
} from "./__fixtures__/stagePlanDroppedFront7635Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/stagePlanDroppedFront7635FlagOff.json", import.meta.url), "utf8"));

// ── Flaget ─────────────────────────────────────────────────────────────────

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

test("#7635 flag: kun den eksakte streng 'on' taender", () => {
  assert.equal(STAGE_PLAN_DROPPED_FRONT_7635_FLAG_KEY, "stage_plan_dropped_front_7635");
  assert.equal(evaluateStagePlanDroppedFront7635Flag("on"), true);
  for (const v of ["off", "beta", true, false, null, undefined, "ON", 1, "true"]) {
    assert.equal(evaluateStagePlanDroppedFront7635Flag(v), false, `${JSON.stringify(v)} er slukket`);
  }
});

test("#7635 flag: app_config-opslaget, fail-safe slukket ved fravaer og fejl", async () => {
  const on = configStub("on");
  assert.equal(await isStagePlanDroppedFront7635Enabled(on), true);
  assert.deepEqual(on.seen, [["app_config", "key", "stage_plan_dropped_front_7635"]]);
  assert.equal(await isStagePlanDroppedFront7635Enabled(configStub(undefined)), false, "raekken mangler");
  assert.equal(await isStagePlanDroppedFront7635Enabled(configStub("beta")), false, "ingen beta-tilstand");
  assert.equal(await isStagePlanDroppedFront7635Enabled(configStub("on", { error: { message: "x" } })), false, "opslagsfejl");
  assert.equal(await isStagePlanDroppedFront7635Enabled(configStub("on", { throws: true })), false, "kast");
  assert.equal(await isStagePlanDroppedFront7635Enabled(null), false, "ingen klient");
});

test("#7635 flag: motor-flag i kataloget, og binaert spiller-synligt (resumeet laeser det)", () => {
  assert.equal(isStageFlagKey(STAGE_PLAN_DROPPED_FRONT_7635_FLAG_KEY), true);
  assert.equal(findStageFlag(STAGE_PLAN_DROPPED_FRONT_7635_FLAG_KEY).area, "race-engine");
  assert.ok(PLAYER_VISIBLE_FLAG_KEYS.includes(STAGE_PLAN_DROPPED_FRONT_7635_FLAG_KEY));
  assert.ok(PLAYER_VISIBLE_BINARY_FLAG_KEYS.includes(STAGE_PLAN_DROPPED_FRONT_7635_FLAG_KEY), "beta = off ogsaa paa fladen, som i motoren");
});

test("#7635 migrationen seeder 'off', additivt og idempotent", () => {
  const sql = readFileSync(new URL("../../database/2026-11-04-7635-stage-plan-dropped-front-flag.sql", import.meta.url), "utf8");
  assert.match(sql, /'stage_plan_dropped_front_7635',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING;/);
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i);
});

// ── raceRunner: laesning + argument ───────────────────────────────────────

test("#7635 resolveRaceEngineV4: flaget laeses een gang; slukket/fejl = samme motor som foer", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const base = {
    supabase: {}, race: RACE_7635, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [],
    checkFormPeaksEnabled: async () => true, checkDayForm6649Enabled: async () => false, checkQueenStageGap7236Enabled: async () => false,
  };
  const off = await resolveRaceEngineV4({ ...base, checkStagePlanDroppedFront7635Enabled: async () => false });
  assert.equal(off.v4Engine, engine, "slukket: intet wrapper-lag, ingen markering");
  const failed = await resolveRaceEngineV4({ ...base, checkStagePlanDroppedFront7635Enabled: async () => { throw new Error("db"); } });
  assert.equal(failed.v4Engine, engine, "fejl i opslaget = slukket");
  assert.equal((await resolveRaceEngineV4(base)).v4Engine, engine, "default-opslaget uden app_config-raekke = slukket");
  let calls = 0;
  const on = await resolveRaceEngineV4({ ...base, checkStagePlanDroppedFront7635Enabled: async () => { calls += 1; return true; } });
  assert.equal(calls, 1);
  assert.equal(on.v4Engine.stagePlanDroppedFront7635, true);
  assert.equal("stagePlanDroppedFront7635" in engine, false, "den indlaeste motor muteres aldrig");
  const all = await resolveRaceEngineV4({ ...base, checkDayForm6649Enabled: async () => true, checkQueenStageGap7236Enabled: async () => true, checkStagePlanDroppedFront7635Enabled: async () => true });
  assert.equal(all.v4Engine.dayForm6649, true);
  assert.equal(all.v4Engine.queenStageGap7236, true);
  assert.equal(all.v4Engine.stagePlanDroppedFront7635, true);
  let read = false;
  const v3 = await resolveRaceEngineV4({ ...base, checkV4Enabled: async () => false, checkStagePlanDroppedFront7635Enabled: async () => { read = true; return true; } });
  assert.equal(v3.v4Engine, null);
  assert.equal(read, false, "v4 slukket: flaget laeses slet ikke");
});

test("#7635 v4StagePlanDroppedFront7635Arg: kun taendt flag OG s5_profiles_v3 eller nyere", () => {
  const on = { stagePlanDroppedFront7635: true };
  assert.deepEqual(v4StagePlanDroppedFront7635Arg(on, "s5_profiles_v3"), { stagePlanDroppedFront7635: true });
  for (const rev of ["legacy", "orders_gc_v1", "s5_profiles_v1", "s5_profiles_v2", undefined, null]) {
    assert.deepEqual(v4StagePlanDroppedFront7635Arg(on, rev), {}, `revision ${rev}`);
  }
  assert.deepEqual(v4StagePlanDroppedFront7635Arg({}, "s5_profiles_v3"), {});
  assert.deepEqual(v4StagePlanDroppedFront7635Arg(null, "s5_profiles_v3"), {});
});

// ── Slukket = bit-identisk med merge-basen ─────────────────────────────────

test("#7635 slukket: den frosne fixture er fra merge-basen og daekker praecis scenarierne", () => {
  assert.match(FROZEN.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(FROZEN).filter((k) => k !== "sourceCommit" && k !== "note"), OFF_DIGEST_CASES_7635.map((c) => c.key));
});

test("#7635 slukket: checksum, motor-input og output er bit-identiske med merge-basen (etapeplaner aktive)", async () => {
  const now = await computeOffDigests7635();
  for (const c of OFF_DIGEST_CASES_7635) {
    assert.deepEqual(now[c.key], FROZEN[c.key], c.key);
  }
});

// ── Taendt: kontakten naar broen, run-identiteten og genafspilningen ──────

async function snapshots(recorder) {
  const rows = await buildSnapshotRows({ raceId: RACE_7635.id, recorder });
  return rows.map((row) => ({ row, payload: decodeSnapshot(row) }));
}

test("#7635 taendt under en aeldre revision: ingen effekt, samme checksum og output som slukket", async () => {
  const real = await loadRaceEngineV4();
  const on = wholeRace7635({ ...real, stagePlanDroppedFront7635: true }, "s5_profiles_v2");
  const sn = await snapshots(on.recorder);
  const frozen = FROZEN["wholeRace:s5_profiles_v2"];
  assert.deepEqual(on.result.runs.map((r) => r.input_checksum), frozen.inputChecksums);
  assert.deepEqual(sn.map((s) => s.row.input_sha256), frozen.inputSha256);
  assert.deepEqual(sn.map((s) => s.row.output_sha256), frozen.outputSha256);
});

test("#7635 taendt under s5_profiles_v3: kontakten i argumenterne, ny run-identitet, genafspilningen genskaber den", async () => {
  const real = await loadRaceEngineV4();
  const on = wholeRace7635({ ...real, stagePlanDroppedFront7635: true }, "s5_profiles_v3");
  const sn = await snapshots(on.recorder);
  const frozen = FROZEN["wholeRace:s5_profiles_v3"];
  assert.equal(sn.length, stages7635().length);
  let changedOutput = false;
  for (let i = 0; i < sn.length; i += 1) {
    assert.equal(sn[i].payload.args.stagePlanDroppedFront7635, true, `etape ${i + 1}: kontakten er i motor-argumenterne`);
    assert.notEqual(on.result.runs[i].input_checksum, frozen.inputChecksums[i], `etape ${i + 1}: ny run-identitet`);
    const replay = await replayEngineInput(sn[i].payload);
    assert.equal(replay.outputSha256, sn[i].row.output_sha256, `etape ${i + 1}: genafspilning bit-identisk`);
    if (sn[i].row.output_sha256 !== frozen.outputSha256[i]) changedOutput = true;
  }
  assert.ok(changedOutput, "kontakten aendrer mindst én etape i scenarierne (ellers tester de intet)");
  // Etape 1 har samme start-input begge veje: uden kontakten i argumenterne giver
  // genafspilningen netop merge-basens slukket-resultat.
  const { stagePlanDroppedFront7635: _drop, ...offArgs } = sn[0].payload.args;
  void _drop;
  const asOff = await replayEngineInput({ ...sn[0].payload, args: offArgs });
  assert.equal(asOff.outputSha256, frozen.outputSha256[0]);
});

test("#7635 stage-by-stage: kontakten i argumenter og checksum + bit-identisk genafspilning", async () => {
  const real = await loadRaceEngineV4();
  const on = stageByStage7635({ ...real, stagePlanDroppedFront7635: true }, "s5_profiles_v3", 2);
  const [sn] = await snapshots(on.recorder);
  const frozen = FROZEN["stageByStage:s5_profiles_v3:stage3"];
  assert.equal(sn.payload.args.stagePlanDroppedFront7635, true);
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

test("#7635 broen: raceRunners kontakt bliver til StageInput.stage_plan_dropped_front_7635, kun under s5_profiles_v3", async () => {
  const on = await spiedEngine();
  wholeRace7635({ ...on.engine, stagePlanDroppedFront7635: true }, "s5_profiles_v3");
  assert.equal(on.inputs.length, stages7635().length);
  assert.ok(on.inputs.every((i) => i.stage_plan_dropped_front_7635 === true), "taendt: alle etaper faar kontakten");
  const off = await spiedEngine();
  wholeRace7635(off.engine, "s5_profiles_v3");
  assert.ok(off.inputs.every((i) => !("stage_plan_dropped_front_7635" in i)), "slukket: noeglen findes ikke");
  const older = await spiedEngine();
  wholeRace7635({ ...older.engine, stagePlanDroppedFront7635: true }, "s5_profiles_v2");
  assert.ok(older.inputs.every((i) => !("stage_plan_dropped_front_7635" in i)), "aeldre revision: aldrig");
});
