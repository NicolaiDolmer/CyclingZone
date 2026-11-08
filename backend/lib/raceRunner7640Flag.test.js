// #7640 (ejer-go 4/11): tænd-ledningen for aarsagen paa et klatre-split der koerer FREM.
// Kun app_config split_attack_cause_7640 = "on" taender; raceRunner sender kontakten til
// broen KUN under s5_profiles_v3 (og senere); vaerdien er med i run-identiteten
// (input_checksum) og i motor-argumenterne, saa #1857-genafspilningen genskaber den.
//
// Slukket = bit-identisk med merge-basen FOER ledningen: __fixtures__/raceRunner7640FlagOff.json
// er skrevet af merge-basens kode (sourceCommit i filen) med de samme scenarier
// (__fixtures__/raceRunner7640Scenarios.js) og genereres aldrig med den nye kode.
// Kun hashes; syntetisk fixture, ingen prod-data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SPLIT_ATTACK_CAUSE_7640_FLAG_KEY, evaluateSplitAttackCause7640Flag, isSplitAttackCause7640Enabled } from "./splitAttackCause7640Flag.js";
import { resolveRaceEngineV4, v4SplitAttackCause7640Arg } from "./raceRunner.js";
import { ENGINE_VERSION_V4, createRaceEngineV4Adapter, loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { buildSnapshotRows, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";
import {
  OFF_DIGEST_CASES_7640, RACE_7640, computeOffDigests7640Runner, digests7640, stageByStage7640, stages7640, wholeRace7640,
} from "./__fixtures__/raceRunner7640Scenarios.js";
import { digest7640 } from "./__fixtures__/splitAttack7640Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/raceRunner7640FlagOff.json", import.meta.url), "utf8"));
const ATTACK = "attack";

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

test("#7640 flag: kun den eksakte streng 'on' taender", () => {
  assert.equal(SPLIT_ATTACK_CAUSE_7640_FLAG_KEY, "split_attack_cause_7640");
  assert.equal(evaluateSplitAttackCause7640Flag("on"), true);
  for (const v of ["off", "beta", true, false, null, undefined, "ON", 1, "true"]) {
    assert.equal(evaluateSplitAttackCause7640Flag(v), false, `${JSON.stringify(v)} er slukket`);
  }
});

test("#7640 flag: app_config-opslaget, fail-safe slukket ved fravaer og fejl", async () => {
  const on = configStub("on");
  assert.equal(await isSplitAttackCause7640Enabled(on), true);
  assert.deepEqual(on.seen, [["app_config", "key", "split_attack_cause_7640"]]);
  assert.equal(await isSplitAttackCause7640Enabled(configStub(undefined)), false, "raekken mangler");
  assert.equal(await isSplitAttackCause7640Enabled(configStub("beta")), false, "ingen beta-tilstand");
  assert.equal(await isSplitAttackCause7640Enabled(configStub("on", { error: { message: "x" } })), false, "opslagsfejl");
  assert.equal(await isSplitAttackCause7640Enabled(configStub("on", { throws: true })), false, "kast");
  assert.equal(await isSplitAttackCause7640Enabled(null), false, "ingen klient");
});

test("#7640 flag: registreret i stadie-kataloget som motor-flag", () => {
  assert.equal(isStageFlagKey(SPLIT_ATTACK_CAUSE_7640_FLAG_KEY), true);
  assert.equal(findStageFlag(SPLIT_ATTACK_CAUSE_7640_FLAG_KEY).area, "race-engine");
});

// ── raceRunner: laesning + argument ───────────────────────────────────────

test("#7640 resolveRaceEngineV4: flaget laeses een gang; slukket/fejl = samme motor som foer", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const base = {
    supabase: {}, race: RACE_7640, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [],
    checkFormPeaksEnabled: async () => true, checkDayForm6649Enabled: async () => false, checkQueenStageGap7236Enabled: async () => false,
    checkStagePlanDroppedFront7635Enabled: async () => false, checkDescentRegroupCap7644Enabled: async () => false,
  };
  const off = await resolveRaceEngineV4({ ...base, checkSplitAttackCause7640Enabled: async () => false });
  assert.equal(off.v4Engine, engine, "slukket: intet wrapper-lag, ingen markering");
  const failed = await resolveRaceEngineV4({ ...base, checkSplitAttackCause7640Enabled: async () => { throw new Error("db"); } });
  assert.equal(failed.v4Engine, engine, "fejl i opslaget = slukket, motoren koerer stadig");
  const dflt = await resolveRaceEngineV4(base);
  assert.equal(dflt.v4Engine, engine, "default-opslaget uden app_config-raekke = slukket");
  let calls = 0;
  const on = await resolveRaceEngineV4({ ...base, checkSplitAttackCause7640Enabled: async () => { calls += 1; return true; } });
  assert.equal(calls, 1);
  assert.equal(on.v4Engine.splitAttackCause7640, true);
  assert.equal(on.v4Engine.version, ENGINE_VERSION_V4);
  assert.equal("splitAttackCause7640" in engine, false, "den indlaeste motor muteres aldrig");
  // Sammen med de andre kontakter: alle markeringer bevares.
  const all = await resolveRaceEngineV4({
    ...base, checkFormPeaksEnabled: async () => false, checkDayForm6649Enabled: async () => true, checkQueenStageGap7236Enabled: async () => true,
    checkStagePlanDroppedFront7635Enabled: async () => true, checkDescentRegroupCap7644Enabled: async () => true, checkSplitAttackCause7640Enabled: async () => true,
  });
  assert.equal(all.v4Engine.formPeaks, false);
  assert.equal(all.v4Engine.dayForm6649, true);
  assert.equal(all.v4Engine.queenStageGap7236, true);
  assert.equal(all.v4Engine.stagePlanDroppedFront7635, true);
  assert.equal(all.v4Engine.descentRegroupCap7644, true);
  assert.equal(all.v4Engine.splitAttackCause7640, true);
  // v4 slukket: flaget laeses slet ikke.
  let read = false;
  const v3 = await resolveRaceEngineV4({ ...base, checkV4Enabled: async () => false, checkSplitAttackCause7640Enabled: async () => { read = true; return true; } });
  assert.equal(v3.v4Engine, null);
  assert.equal(read, false);
});

test("#7640 v4SplitAttackCause7640Arg: kun taendt flag OG s5_profiles_v3 eller nyere", () => {
  const on = { splitAttackCause7640: true };
  assert.deepEqual(v4SplitAttackCause7640Arg(on, "s5_profiles_v3"), { splitAttackCause7640: true });
  for (const rev of ["legacy", "orders_gc_v1", "s5_profiles_v1", "s5_profiles_v2", undefined, null]) {
    assert.deepEqual(v4SplitAttackCause7640Arg(on, rev), {}, `revision ${rev}`);
  }
  assert.deepEqual(v4SplitAttackCause7640Arg({}, "s5_profiles_v3"), {});
  assert.deepEqual(v4SplitAttackCause7640Arg({ splitAttackCause7640: "on" }, "s5_profiles_v3"), {}, "kun boolean true");
  assert.deepEqual(v4SplitAttackCause7640Arg(null, "s5_profiles_v3"), {});
});

// ── Slukket = bit-identisk med merge-basen ─────────────────────────────────

test("#7640 slukket: den frosne fixture er fra merge-basen og daekker praecis scenarierne", () => {
  assert.match(FROZEN.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(FROZEN).filter((k) => k !== "sourceCommit" && k !== "note"), OFF_DIGEST_CASES_7640.map((c) => c.key));
});

test("#7640 slukket: checksum, motor-input og output er bit-identiske med merge-basen", async () => {
  const now = await computeOffDigests7640Runner();
  for (const c of OFF_DIGEST_CASES_7640) {
    assert.deepEqual(now[c.key], FROZEN[c.key], c.key);
  }
});

// ── Taendt: kontakten naar broen, run-identiteten og genafspilningen ──────

async function snapshots(recorder) {
  const rows = await buildSnapshotRows({ raceId: RACE_7640.id, recorder });
  return rows.map((row) => ({ row, payload: decodeSnapshot(row) }));
}

function splitCauses(result) {
  const causes = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v instanceof Map) { v.forEach(walk); return; }
    if (v === null || typeof v !== "object") return;
    if (v.type === "peloton_splits" && v.params) causes.push({ cause: v.params.cause, ahead: Number(v.params.gap_seconds) < 0 });
    Object.values(v).forEach(walk);
  };
  walk(result);
  return causes;
}

test("#7640 taendt under en aeldre revision: ingen effekt, samme checksum og output som slukket", async () => {
  const real = await loadRaceEngineV4();
  const on = wholeRace7640({ ...real, splitAttackCause7640: true }, "s5_profiles_v2");
  assert.deepEqual(await digests7640(on), FROZEN["wholeRace:s5_profiles_v2"]);
});

test("#7640 taendt under s5_profiles_v3: kontakten i motor-argumenterne, ny run-identitet, kun cause aendres, genafspilningen genskaber den", async () => {
  const real = await loadRaceEngineV4();
  const on = wholeRace7640({ ...real, splitAttackCause7640: true }, "s5_profiles_v3");
  const sn = await snapshots(on.recorder);
  const frozen = FROZEN["wholeRace:s5_profiles_v3"];
  assert.equal(sn.length, stages7640().length);
  let attacks = 0;
  for (let i = 0; i < sn.length; i += 1) {
    assert.equal(sn[i].payload.args.splitAttackCause7640, true, `etape ${i + 1}: kontakten er i motor-argumenterne`);
    assert.notEqual(on.result.runs[i].input_checksum, frozen.inputChecksums[i], `etape ${i + 1}: ny run-identitet`);
    // Grupper, huller, tider og resultater er merge-basens; kun aarsagen paa splittene kan aendres.
    assert.equal(digest7640(on.outputs[i]).withoutCausesSha256, frozen.withoutCausesSha256[i], `etape ${i + 1}: kun cause aendres`);
    for (const s of splitCauses(on.outputs[i])) {
      assert.equal(s.cause === ATTACK, s.ahead, `etape ${i + 1}: angreb <=> split frem`);
      if (s.cause === ATTACK) attacks += 1;
    }
    const replay = await replayEngineInput(sn[i].payload);
    assert.equal(replay.outputSha256, sn[i].row.output_sha256, `etape ${i + 1}: genafspilning bit-identisk`);
  }
  assert.ok(attacks > 0, "scenariet har et angreb frem, ellers beviser testen intet");
  // Uden kontakten i argumenterne giver genafspilningen netop merge-basens slukket-output
  // (kontakten i argumenterne ER forskellen; etape 1 har samme start-input begge veje).
  const { splitAttackCause7640: _drop, ...offArgs } = sn[0].payload.args;
  void _drop;
  const asOff = await replayEngineInput({ ...sn[0].payload, args: offArgs });
  assert.equal(asOff.outputSha256, frozen.outputSha256[0]);
});

test("#7640 stage-by-stage: kontakten i argumenter og checksum + bit-identisk genafspilning", async () => {
  const real = await loadRaceEngineV4();
  const on = stageByStage7640({ ...real, splitAttackCause7640: true }, "s5_profiles_v3", 1);
  const [sn] = await snapshots(on.recorder);
  const frozen = FROZEN["stageByStage:s5_profiles_v3:stage2"];
  assert.equal(sn.payload.args.splitAttackCause7640, true);
  assert.notEqual(on.result.runs[0].input_checksum, frozen.inputChecksums[0], "ny run-identitet");
  assert.equal(digest7640(on.outputs[0]).withoutCausesSha256, frozen.withoutCausesSha256[0], "kun cause aendres");
  assert.ok(splitCauses(on.outputs[0]).some((s) => s.cause === ATTACK), "angrebet frem hedder angreb");
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

test("#7640 broen: raceRunners kontakt bliver til StageInput.split_attack_cause_7640, kun under s5_profiles_v3", async () => {
  const on = await spiedEngine();
  wholeRace7640({ ...on.engine, splitAttackCause7640: true }, "s5_profiles_v3");
  assert.equal(on.inputs.length, stages7640().length);
  assert.ok(on.inputs.every((i) => i.split_attack_cause_7640 === true), "taendt: alle etaper faar kontakten");
  const off = await spiedEngine();
  wholeRace7640(off.engine, "s5_profiles_v3");
  assert.ok(off.inputs.every((i) => !("split_attack_cause_7640" in i)), "slukket: noeglen findes ikke");
  const older = await spiedEngine();
  wholeRace7640({ ...older.engine, splitAttackCause7640: true }, "s5_profiles_v2");
  assert.ok(older.inputs.every((i) => !("split_attack_cause_7640" in i)), "aeldre revision: aldrig");
});
