// #6649 (ejer 27/10): kontakten for dagsformen. Kun app_config day_form_6649 = "on"
// taender; raceRunner sender den til broen KUN under s5_profiles_v3; vaerdien er med i
// run-identiteten (input_checksum) og i motor-argumenterne, saa #1857-genafspilningen
// genskaber den. Slukket = byte-identisk med foer kontakten. Syntetisk fixture, ingen prod-data.

import { test } from "node:test";
import assert from "node:assert/strict";

import { DAY_FORM_6649_FLAG_KEY, evaluateDayForm6649Flag, isDayForm6649Enabled } from "./dayForm6649Flag.js";
import { buildRaceResults, buildStageRowsAccumulated, resolveRaceEngineV4, v4DayForm6649Arg } from "./raceRunner.js";
import { ENGINE_VERSION_V4, loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import { buildSnapshotRows, createEngineInputRecorder, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";

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

test("#6649 flag: kun den eksakte streng 'on' taender", () => {
  assert.equal(DAY_FORM_6649_FLAG_KEY, "day_form_6649");
  assert.equal(evaluateDayForm6649Flag("on"), true);
  for (const v of ["off", "beta", true, false, null, undefined, "ON", 1, "true"]) {
    assert.equal(evaluateDayForm6649Flag(v), false, `${JSON.stringify(v)} er slukket`);
  }
});

test("#6649 flag: app_config-opslaget, fail-safe slukket ved fravaer og fejl", async () => {
  const on = configStub("on");
  assert.equal(await isDayForm6649Enabled(on), true);
  assert.deepEqual(on.seen, [["app_config", "key", "day_form_6649"]]);
  assert.equal(await isDayForm6649Enabled(configStub(undefined)), false, "raekken mangler");
  assert.equal(await isDayForm6649Enabled(configStub("beta")), false, "ingen beta-tilstand");
  assert.equal(await isDayForm6649Enabled(configStub("on", { error: { message: "x" } })), false, "opslagsfejl");
  assert.equal(await isDayForm6649Enabled(configStub("on", { throws: true })), false, "kast");
  assert.equal(await isDayForm6649Enabled(null), false, "ingen klient");
});

// ── raceRunner: laesning + argument ───────────────────────────────────────

const RACE = { id: "race-6649-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 2 };

test("#6649 resolveRaceEngineV4: flaget laeses een gang; slukket/fejl = samme motor som foer", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const base = { supabase: {}, race: RACE, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [], checkFormPeaksEnabled: async () => true };
  const off = await resolveRaceEngineV4({ ...base, checkDayForm6649Enabled: async () => false });
  assert.equal(off.v4Engine, engine, "slukket: intet wrapper-lag, ingen markering");
  const failed = await resolveRaceEngineV4({ ...base, checkDayForm6649Enabled: async () => { throw new Error("db"); } });
  assert.equal(failed.v4Engine, engine, "fejl i opslaget = slukket, motoren koerer stadig");
  const dflt = await resolveRaceEngineV4(base);
  assert.equal(dflt.v4Engine, engine, "default-opslaget uden app_config-raekke = slukket");
  let calls = 0;
  const on = await resolveRaceEngineV4({ ...base, checkDayForm6649Enabled: async () => { calls += 1; return true; } });
  assert.equal(calls, 1);
  assert.equal(on.v4Engine.dayForm6649, true);
  assert.equal(on.v4Engine.version, ENGINE_VERSION_V4);
  assert.equal("dayForm6649" in engine, false, "den indlaeste motor muteres aldrig");
  // Sammen med slukkede formtoppe: begge markeringer bevares.
  const both = await resolveRaceEngineV4({ ...base, checkFormPeaksEnabled: async () => false, checkDayForm6649Enabled: async () => true });
  assert.equal(both.v4Engine.formPeaks, false);
  assert.equal(both.v4Engine.dayForm6649, true);
  // v4 slukket: flaget laeses slet ikke.
  let read = false;
  const v3 = await resolveRaceEngineV4({ ...base, checkV4Enabled: async () => false, checkDayForm6649Enabled: async () => { read = true; return true; } });
  assert.equal(v3.v4Engine, null);
  assert.equal(read, false);
});

test("#6649 v4DayForm6649Arg: kun taendt flag OG s5_profiles_v3", () => {
  const on = { dayForm6649: true };
  assert.deepEqual(v4DayForm6649Arg(on, "s5_profiles_v3"), { dayForm6649: true });
  for (const rev of ["legacy", "orders_gc_v1", "s5_profiles_v1", "s5_profiles_v2", undefined, null]) {
    assert.deepEqual(v4DayForm6649Arg(on, rev), {}, `revision ${rev}`);
  }
  assert.deepEqual(v4DayForm6649Arg({}, "s5_profiles_v3"), {});
  assert.deepEqual(v4DayForm6649Arg(null, "s5_profiles_v3"), {});
});

// ── Hele stien: argumenter, run-identitet, genafspilning ───────────────────

function abil(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

function entrants(n = 24, teams = 3) {
  const perTeam = Math.ceil(n / teams);
  return Array.from({ length: n }, (_, i) => {
    const team = String.fromCharCode(65 + Math.floor(i / perTeam));
    return {
      rider_id: `r${String(i).padStart(3, "0")}`,
      team_id: `team-${team}`,
      team_name: `Hold ${team}`,
      rider_name: `Rytter ${i}`,
      is_u25: i % 4 === 0,
      abilities: abil(i),
      form: 30 + (i % 40),
      fatigue: (i * 7) % 60,
      ...(i % perTeam === 0 ? { race_role: "captain" } : {}),
    };
  });
}

const STAGES = [
  {
    stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
    demand_vector: DEMAND_VECTORS.flat, distance_km: 180,
    climbs: [], sprints: [{ name: "Sprint", km: 90, kind: "intermediate" }],
    race_id: RACE.id, id: "sp-1",
  },
  {
    stage_number: 2, profile_type: "mountain", finale_type: "long_climb",
    demand_vector: DEMAND_VECTORS.mountain, distance_km: 165,
    climbs: [{ name: "Col", crest_km: 158, category: "1", summit_finish: true }],
    sprints: [{ name: "Sprint", km: 70, kind: "intermediate" }],
    race_id: RACE.id, id: "sp-2",
  },
];

function wholeRace(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE.id });
  const result = buildRaceResults({ race: RACE, stages: STAGES, entrants: entrants(), pointsLookup: {}, v3: true, v4Engine, rulesRevision, engineInputRecorder: recorder });
  return { result, recorder };
}

async function snapshots(recorder) {
  const rows = await buildSnapshotRows({ raceId: RACE.id, recorder });
  return rows.map((row) => ({ row, payload: decodeSnapshot(row) }));
}

test("#6649 slukket: s5_profiles_v3 er byte-identisk med en motor uden kontakten", async () => {
  const real = await loadRaceEngineV4();
  const a = wholeRace(real, "s5_profiles_v3");
  const b = wholeRace({ ...real }, "s5_profiles_v3");
  assert.deepEqual(a.result.runs.map((r) => r.input_checksum), b.result.runs.map((r) => r.input_checksum));
  const sa = await snapshots(a.recorder);
  const sb = await snapshots(b.recorder);
  assert.deepEqual(sa.map((s) => s.row.input_sha256), sb.map((s) => s.row.input_sha256));
  assert.deepEqual(sa.map((s) => s.row.output_sha256), sb.map((s) => s.row.output_sha256));
  assert.ok(sa.every((s) => !("dayForm6649" in s.payload.args)), "ingen dayForm6649-noegle i argumenterne");
});

test("#6649 taendt under en aeldre revision: ingen effekt, samme checksum og output", async () => {
  const real = await loadRaceEngineV4();
  const off = wholeRace(real, "s5_profiles_v2");
  const on = wholeRace({ ...real, dayForm6649: true }, "s5_profiles_v2");
  assert.deepEqual(on.result.runs.map((r) => r.input_checksum), off.result.runs.map((r) => r.input_checksum));
  const so = await snapshots(off.recorder);
  const sn = await snapshots(on.recorder);
  assert.deepEqual(sn.map((s) => s.row.input_sha256), so.map((s) => s.row.input_sha256));
  assert.deepEqual(sn.map((s) => s.row.output_sha256), so.map((s) => s.row.output_sha256));
});

test("#6649 taendt under s5_profiles_v3: motoren faar flaget, ny run-identitet, genafspilningen genskaber det", async () => {
  const real = await loadRaceEngineV4();
  const off = wholeRace(real, "s5_profiles_v3");
  const on = wholeRace({ ...real, dayForm6649: true }, "s5_profiles_v3");
  const so = await snapshots(off.recorder);
  const sn = await snapshots(on.recorder);
  assert.equal(sn.length, STAGES.length);
  for (let i = 0; i < sn.length; i += 1) {
    assert.equal(sn[i].payload.args.dayForm6649, true, `etape ${i + 1}: flaget er i motor-argumenterne`);
    assert.notEqual(on.result.runs[i].input_checksum, off.result.runs[i].input_checksum, `etape ${i + 1}: ny run-identitet`);
    const replay = await replayEngineInput(sn[i].payload);
    assert.equal(replay.outputSha256, sn[i].row.output_sha256, `etape ${i + 1}: genafspilning bit-identisk`);
  }
  // Etape 1 har samme start-input begge veje: fjernes flaget fra argumenterne, giver
  // genafspilningen netop slukket-resultatet (flaget i argumenterne ER forskellen).
  const { dayForm6649: _drop, ...offArgs } = sn[0].payload.args;
  void _drop;
  const asOff = await replayEngineInput({ ...sn[0].payload, args: offArgs });
  assert.equal(asOff.outputSha256, so[0].row.output_sha256);
  assert.ok(sn.some((s, i) => s.row.output_sha256 !== so[i].row.output_sha256), "dagsformen aendrer mindst een etape");
});

test("#6649 stage-by-stage: flaget i argumenter og checksum + bit-identisk genafspilning", async () => {
  const real = await loadRaceEngineV4();
  const run = (v4Engine) => {
    const recorder = createEngineInputRecorder({ raceId: RACE.id });
    const result = buildStageRowsAccumulated({
      race: RACE, stagesSorted: STAGES, stageIndex: 1, entrants: entrants(), pointsLookup: {},
      priorStageRows: [], v3: true, v4Engine, rulesRevision: "s5_profiles_v3", engineInputRecorder: recorder,
    });
    return { result, recorder };
  };
  const off = run(real);
  const on = run({ ...real, dayForm6649: true });
  const [so] = await snapshots(off.recorder);
  const [sn] = await snapshots(on.recorder);
  assert.equal("dayForm6649" in so.payload.args, false);
  assert.equal(sn.payload.args.dayForm6649, true);
  assert.equal(typeof off.result.runs[0].input_checksum, "number");
  assert.notEqual(on.result.runs[0].input_checksum, off.result.runs[0].input_checksum, "ny run-identitet");
  const replay = await replayEngineInput(sn.payload);
  assert.equal(replay.outputSha256, sn.row.output_sha256);
});
