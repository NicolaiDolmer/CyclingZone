// #7644 (ejer-valg B 4/11): tænd-ledningen for loftet paa nedkoerslens samling pr. km.
// Kun app_config descent_regroup_cap_7644 = "on" taender; raceRunner sender kontakten til
// broen KUN under s5_profiles_v3 (og senere); vaerdien er med i run-identiteten
// (input_checksum) og i motor-argumenterne, saa #1857-genafspilningen genskaber den.
//
// Slukket = bit-identisk med merge-basen FOER kontakten: __fixtures__/raceRunner7644FlagOff.json
// er skrevet af merge-basens kode (sourceCommit i filen) med de samme scenarier
// (__fixtures__/raceRunner7644Scenarios.js) og genereres aldrig med den nye kode.
// Kun hashes; syntetisk fixture, ingen prod-data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DESCENT_REGROUP_CAP_7644_FLAG_KEY, evaluateDescentRegroupCap7644Flag, isDescentRegroupCap7644Enabled } from "./descentRegroupCap7644Flag.js";
import { resolveRaceEngineV4, v4DescentRegroupCap7644Arg } from "./raceRunner.js";
import { ENGINE_VERSION_V4, createRaceEngineV4Adapter, loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { buildSnapshotRows, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";
import {
  OFF_DIGEST_CASES_7644, RACE_7644, computeOffDigests7644, stageByStage7644, stages7644, wholeRace7644,
} from "./__fixtures__/raceRunner7644Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/raceRunner7644FlagOff.json", import.meta.url), "utf8"));

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

test("#7644 flag: kun den eksakte streng 'on' taender", () => {
  assert.equal(DESCENT_REGROUP_CAP_7644_FLAG_KEY, "descent_regroup_cap_7644");
  assert.equal(evaluateDescentRegroupCap7644Flag("on"), true);
  for (const v of ["off", "beta", true, false, null, undefined, "ON", 1, "true"]) {
    assert.equal(evaluateDescentRegroupCap7644Flag(v), false, `${JSON.stringify(v)} er slukket`);
  }
});

test("#7644 flag: app_config-opslaget, fail-safe slukket ved fravaer og fejl", async () => {
  const on = configStub("on");
  assert.equal(await isDescentRegroupCap7644Enabled(on), true);
  assert.deepEqual(on.seen, [["app_config", "key", "descent_regroup_cap_7644"]]);
  assert.equal(await isDescentRegroupCap7644Enabled(configStub(undefined)), false, "raekken mangler");
  assert.equal(await isDescentRegroupCap7644Enabled(configStub("off")), false, "seedet off");
  assert.equal(await isDescentRegroupCap7644Enabled(configStub("beta")), false, "ingen beta-tilstand");
  assert.equal(await isDescentRegroupCap7644Enabled(configStub("on", { error: { message: "x" } })), false, "opslagsfejl");
  assert.equal(await isDescentRegroupCap7644Enabled(configStub("on", { throws: true })), false, "kast");
  assert.equal(await isDescentRegroupCap7644Enabled(null), false, "ingen klient");
});

test("#7644 flag: registreret i stadie-kataloget som motor-flag", () => {
  assert.equal(isStageFlagKey(DESCENT_REGROUP_CAP_7644_FLAG_KEY), true);
  assert.equal(findStageFlag(DESCENT_REGROUP_CAP_7644_FLAG_KEY).area, "race-engine");
});

test("#7644 flag: migrationen seeder raekken 'off', additivt og idempotent", () => {
  const sql = readFileSync(new URL("../../database/2026-11-04-7644-descent-regroup-cap-flag.sql", import.meta.url), "utf8");
  assert.match(sql, /'descent_regroup_cap_7644',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i);
});

// ── raceRunner: laesning + argument ───────────────────────────────────────

test("#7644 resolveRaceEngineV4: flaget laeses een gang; slukket/fejl = samme motor som foer", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const base = {
    supabase: {}, race: RACE_7644, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [],
    checkFormPeaksEnabled: async () => true, checkDayForm6649Enabled: async () => false, checkQueenStageGap7236Enabled: async () => false,
  };
  const off = await resolveRaceEngineV4({ ...base, checkDescentRegroupCap7644Enabled: async () => false });
  assert.equal(off.v4Engine, engine, "slukket: intet wrapper-lag, ingen markering");
  const failed = await resolveRaceEngineV4({ ...base, checkDescentRegroupCap7644Enabled: async () => { throw new Error("db"); } });
  assert.equal(failed.v4Engine, engine, "fejl i opslaget = slukket, motoren koerer stadig");
  const dflt = await resolveRaceEngineV4(base);
  assert.equal(dflt.v4Engine, engine, "default-opslaget uden app_config-raekke = slukket");
  let calls = 0;
  const on = await resolveRaceEngineV4({ ...base, checkDescentRegroupCap7644Enabled: async () => { calls += 1; return true; } });
  assert.equal(calls, 1);
  assert.equal(on.v4Engine.descentRegroupCap7644, true);
  assert.equal(on.v4Engine.version, ENGINE_VERSION_V4);
  assert.equal("descentRegroupCap7644" in engine, false, "den indlaeste motor muteres aldrig");
  // Sammen med de andre kontakter: alle markeringer bevares.
  const all = await resolveRaceEngineV4({ ...base, checkFormPeaksEnabled: async () => false, checkDayForm6649Enabled: async () => true, checkQueenStageGap7236Enabled: async () => true, checkDescentRegroupCap7644Enabled: async () => true });
  assert.equal(all.v4Engine.formPeaks, false);
  assert.equal(all.v4Engine.dayForm6649, true);
  assert.equal(all.v4Engine.queenStageGap7236, true);
  assert.equal(all.v4Engine.descentRegroupCap7644, true);
  // v4 slukket: flaget laeses slet ikke.
  let read = false;
  const v3 = await resolveRaceEngineV4({ ...base, checkV4Enabled: async () => false, checkDescentRegroupCap7644Enabled: async () => { read = true; return true; } });
  assert.equal(v3.v4Engine, null);
  assert.equal(read, false);
});

test("#7644 v4DescentRegroupCap7644Arg: kun taendt flag OG s5_profiles_v3 eller nyere", () => {
  const on = { descentRegroupCap7644: true };
  assert.deepEqual(v4DescentRegroupCap7644Arg(on, "s5_profiles_v3"), { descentRegroupCap7644: true });
  for (const rev of ["legacy", "orders_gc_v1", "s5_profiles_v1", "s5_profiles_v2", undefined, null]) {
    assert.deepEqual(v4DescentRegroupCap7644Arg(on, rev), {}, `revision ${rev}`);
  }
  assert.deepEqual(v4DescentRegroupCap7644Arg({}, "s5_profiles_v3"), {});
  assert.deepEqual(v4DescentRegroupCap7644Arg(null, "s5_profiles_v3"), {});
});

// ── Slukket = bit-identisk med merge-basen ─────────────────────────────────

test("#7644 slukket: den frosne fixture er fra merge-basen og daekker praecis scenarierne", () => {
  assert.match(FROZEN.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(FROZEN).filter((k) => k !== "sourceCommit" && k !== "note"), OFF_DIGEST_CASES_7644.map((c) => c.key));
});

test("#7644 slukket: checksum, motor-input og output er bit-identiske med merge-basen", async () => {
  const now = await computeOffDigests7644();
  for (const c of OFF_DIGEST_CASES_7644) {
    assert.deepEqual(now[c.key], FROZEN[c.key], c.key);
  }
});

// ── Taendt: kontakten naar broen, run-identiteten og genafspilningen ──────

async function snapshots(recorder) {
  const rows = await buildSnapshotRows({ raceId: RACE_7644.id, recorder });
  return rows.map((row) => ({ row, payload: decodeSnapshot(row) }));
}

test("#7644 taendt under en aeldre revision: ingen effekt, samme checksum og output som slukket", async () => {
  const real = await loadRaceEngineV4();
  const on = wholeRace7644({ ...real, descentRegroupCap7644: true }, "s5_profiles_v2");
  const sn = await snapshots(on.recorder);
  const frozen = FROZEN["wholeRace:s5_profiles_v2"];
  assert.deepEqual(on.result.runs.map((r) => r.input_checksum), frozen.inputChecksums);
  assert.deepEqual(sn.map((s) => s.row.input_sha256), frozen.inputSha256);
  assert.deepEqual(sn.map((s) => s.row.output_sha256), frozen.outputSha256);
});

test("#7644 taendt under s5_profiles_v3: motoren faar kontakten, ny run-identitet, bjergetaperne aendres, genafspilningen genskaber den", async () => {
  const real = await loadRaceEngineV4();
  const on = wholeRace7644({ ...real, descentRegroupCap7644: true }, "s5_profiles_v3");
  const sn = await snapshots(on.recorder);
  const frozen = FROZEN["wholeRace:s5_profiles_v3"];
  assert.equal(sn.length, stages7644().length);
  for (let i = 0; i < sn.length; i += 1) {
    assert.equal(sn[i].payload.args.descentRegroupCap7644, true, `etape ${i + 1}: kontakten er i motor-argumenterne`);
    assert.notEqual(on.result.runs[i].input_checksum, frozen.inputChecksums[i], `etape ${i + 1}: ny run-identitet`);
    const replay = await replayEngineInput(sn[i].payload);
    assert.equal(replay.outputSha256, sn[i].row.output_sha256, `etape ${i + 1}: genafspilning bit-identisk`);
  }
  // Den flade etape har ingen nedkoersel efter en top: samme resultat. Bjergetaperne: loftet virker.
  assert.equal(sn[0].row.output_sha256, frozen.outputSha256[0], "flad etape uroert");
  assert.notEqual(sn[1].row.output_sha256, frozen.outputSha256[1], "lang nedkoersel: loftet virker");
  // Fjernes kontakten fra argumenterne, giver genafspilningen netop merge-basens slukket-resultat.
  const { descentRegroupCap7644: _drop, ...offArgs } = sn[0].payload.args;
  void _drop;
  const asOff = await replayEngineInput({ ...sn[0].payload, args: offArgs });
  assert.equal(asOff.outputSha256, frozen.outputSha256[0]);
});

test("#7644 stage-by-stage: kontakten i argumenter og checksum + bit-identisk genafspilning", async () => {
  const real = await loadRaceEngineV4();
  const on = stageByStage7644({ ...real, descentRegroupCap7644: true }, "s5_profiles_v3", 1);
  const [sn] = await snapshots(on.recorder);
  const frozen = FROZEN["stageByStage:s5_profiles_v3:stage2"];
  assert.equal(sn.payload.args.descentRegroupCap7644, true);
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

test("#7644 broen: raceRunners kontakt bliver til StageInput.descent_regroup_cap_7644, kun under s5_profiles_v3", async () => {
  const on = await spiedEngine();
  wholeRace7644({ ...on.engine, descentRegroupCap7644: true }, "s5_profiles_v3");
  assert.equal(on.inputs.length, stages7644().length);
  assert.ok(on.inputs.every((i) => i.descent_regroup_cap_7644 === true), "taendt: alle etaper faar kontakten");
  const off = await spiedEngine();
  wholeRace7644(off.engine, "s5_profiles_v3");
  assert.ok(off.inputs.every((i) => !("descent_regroup_cap_7644" in i)), "slukket: noeglen findes ikke");
  const older = await spiedEngine();
  wholeRace7644({ ...older.engine, descentRegroupCap7644: true }, "s5_profiles_v2");
  assert.ok(older.inputs.every((i) => !("descent_regroup_cap_7644" in i)), "aeldre revision: aldrig");
});
