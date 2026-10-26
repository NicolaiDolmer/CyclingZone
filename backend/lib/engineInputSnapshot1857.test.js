// #1857: motorens fulde input pr. etape — optagelse, privat skrivning og
// bit-identisk genafspilning. Beviset er en fixture der køres gennem den RIGTIGE
// raceRunner-sti (buildRaceResults / buildStageRowsAccumulated) med en optager,
// pakkes til præcis den tabel-række prod skriver, pakkes ud igen og køres om.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRaceResults, buildStageRowsAccumulated } from "./raceRunner.js";
import { loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import {
  ENGINE_INPUT_FORMAT,
  ENGINE_INPUT_SNAPSHOT_TABLE,
  buildSnapshotRows,
  compareRanked,
  createEngineInputRecorder,
  decodeSnapshot,
  decodeValue,
  encodeValue,
  hashEngineOutput,
  isMissingSnapshotTableError,
  persistEngineInputSnapshots,
  replayEngineInput,
  runRecordedEngineCall,
} from "./engineInputSnapshot1857.js";

// ── Fixture (syntetisk; ingen prod-data) ───────────────────────────────────

function abil(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

function entrants(n = 16, teams = 2) {
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
      form: 40 + (i % 30),
      fatigue: (i * 3) % 30,
      ...(i % perTeam === 0 ? { race_role: "captain" } : {}),
    };
  });
}

const RACE = { id: "race-1857-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 2 };

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

/** Optag → tabel-rækker → afkod → genafspil. Returnerer pr. etape. */
async function roundTrip(recorder, opts = {}) {
  const rows = await buildSnapshotRows({ raceId: RACE.id, recorder });
  const out = [];
  for (const row of rows) {
    const payload = decodeSnapshot(row);
    const replay = await replayEngineInput(payload, opts);
    out.push({ row, payload, replay });
  }
  return out;
}

// ── Codec ──────────────────────────────────────────────────────────────────

test("codec: Map/Set/NaN/±Infinity/-0/undefined/BigInt/Date/huller/$t-nøgler overlever tabsfrit", () => {
  const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
  const value = {
    m: new Map([["a", 1], [2, { x: new Set([1, 2]) }]]),
    nums: [NaN, Infinity, -Infinity, -0, 0, 1.5],
    u: undefined,
    big: 12345678901234567890n,
    d: new Date("2026-10-26T10:00:00.000Z"),
    sparse,
    tricky: { $t: "map", v: "ikke et tag" },
    nested: [{ a: [undefined, null] }],
  };
  const back = decodeValue(JSON.parse(JSON.stringify(encodeValue(value))));
  assert.deepEqual(back.m, value.m);
  assert.ok(Number.isNaN(back.nums[0]));
  assert.equal(back.nums[1], Infinity);
  assert.equal(back.nums[2], -Infinity);
  assert.ok(Object.is(back.nums[3], -0), "-0 bevares");
  assert.ok(Object.is(back.nums[4], 0));
  assert.ok(Object.prototype.hasOwnProperty.call(back, "u") && back.u === undefined, "undefined-nøgle bevares");
  assert.equal(back.big, value.big);
  assert.equal(back.d.toISOString(), value.d.toISOString());
  assert.equal(back.sparse.length, 3);
  assert.equal(back.sparse[1], undefined);
  assert.deepEqual(back.tricky, { $t: "map", v: "ikke et tag" });
  assert.deepEqual(back.nested, [{ a: [undefined, null] }]);
});

test("codec: funktioner og cirkulære referencer afvises (optages aldrig halvt)", () => {
  assert.throws(() => encodeValue({ f: () => 1 }), /cannot store/);
  const a = {}; a.self = a;
  assert.throws(() => encodeValue(a), /circular/);
  // Samme objekt to steder (ikke cirkulært) er fint.
  const shared = { x: 1 };
  assert.deepEqual(decodeValue(encodeValue([shared, shared])), [{ x: 1 }, { x: 1 }]);
});

// ── Optageren ændrer intet ─────────────────────────────────────────────────

test("recorder=null: runRecordedEngineCall er præcis call(args)", () => {
  const args = { a: 1 };
  const result = { ok: true };
  let seen = null;
  assert.equal(runRecordedEngineCall(null, { stageNumber: 1, engine: "v3" }, args, (x) => { seen = x; return result; }), result);
  assert.equal(seen, args, "samme objekt, ingen kopi");
});

test("en optager ændrer ikke resultatet (v3 whole-race, bit-identisk med uden optager)", () => {
  const base = { race: RACE, stages: STAGES, entrants: entrants(), pointsLookup: {}, v3: true };
  const without = buildRaceResults(base);
  const recorder = createEngineInputRecorder({ raceId: RACE.id, build: null });
  const withRec = buildRaceResults({ ...base, entrants: entrants(), engineInputRecorder: recorder });
  assert.deepEqual(withRec.resultRows, without.resultRows);
  assert.deepEqual(withRec.runs, without.runs);
  assert.equal(recorder.calls.length, STAGES.length);
  assert.equal(recorder.errors.length, 0);
});

test("fejl i optagelsen (fx en funktion i args) vælter aldrig motorkaldet; fejlen samles til Sentry", async () => {
  const recorder = createEngineInputRecorder({ raceId: RACE.id });
  const result = runRecordedEngineCall(recorder, { stageNumber: 1, engine: "v3" }, { bad: () => 1 }, () => ({ ranked: [] }));
  assert.deepEqual(result, { ranked: [] });
  assert.equal(recorder.calls.length, 0);
  assert.equal(recorder.errors.length, 1);
  const captured = [];
  const status = await persistEngineInputSnapshots({ supabase: {}, race: RACE, recorder, captureExceptionFn: (e, ctx) => captured.push([e, ctx]) });
  assert.equal(status.written, 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0][1].tags.stage, "engine-input-snapshot");
});

// ── Bit-identisk genafspilning ─────────────────────────────────────────────

test("v3 whole-race: hver etape genafspilles bit-identisk fra sin egen tabel-række", async () => {
  for (const v3 of [false, true]) {
    const recorder = createEngineInputRecorder({ raceId: RACE.id, build: "abc123" });
    buildRaceResults({ race: RACE, stages: STAGES, entrants: entrants(), pointsLookup: {}, v3, engineInputRecorder: recorder });
    const trips = await roundTrip(recorder);
    assert.equal(trips.length, STAGES.length);
    for (const { row, payload, replay } of trips) {
      assert.equal(row.format, ENGINE_INPUT_FORMAT);
      assert.equal(row.engine, "v3");
      assert.equal(row.engine_build, "abc123");
      assert.equal(payload.inputSha256, row.input_sha256, "payloaden er uændret efter gzip/base64");
      assert.equal(replay.outputSha256, row.output_sha256, `v3=${v3} etape ${row.stage_number} skal være bit-identisk`);
    }
  }
});

test("v3: træthed akkumuleret mellem etaper er fanget pr. etape (etape 2's input ≠ etape 1's)", async () => {
  const recorder = createEngineInputRecorder({ raceId: RACE.id });
  buildRaceResults({ race: RACE, stages: STAGES, entrants: entrants(), pointsLookup: {}, v3: true, engineInputRecorder: recorder });
  const [s1, s2] = await roundTrip(recorder);
  const f1 = s1.payload.args.entrants.map((e) => e.fatigue);
  const f2 = s2.payload.args.entrants.map((e) => e.fatigue);
  assert.notDeepEqual(f1, f2, "etape 2 skal se trætheden efter etape 1, ikke start-trætheden");
  assert.ok(s1.payload.args.entrants.every((e) => e.abilities && typeof e.abilities === "object"), "evner er med");
  assert.ok(s1.payload.args.entrants.some((e) => e.race_role), "roller er med");
  assert.ok(s1.payload.args.entrants.some((e) => e.form != null), "form er med");
  assert.equal(typeof s1.payload.args.seed, "number");
  assert.equal(s1.payload.seedInput.length > 0, true);
});

test("v4 stage-by-stage: etapen genafspilles bit-identisk (ordrer, rute, revision, seed)", async () => {
  const v4Engine = await loadRaceEngineV4();
  const recorder = createEngineInputRecorder({ raceId: RACE.id });
  const teamOrderRows = [{ team_id: "team-A", race_id: RACE.id, stage_number: 1, rider_id: "r000", effort: "high" }];
  buildStageRowsAccumulated({
    race: RACE, stagesSorted: STAGES, stageIndex: 0, entrants: entrants(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine, teamOrderRows, rulesRevision: "s5_profiles_v3", engineInputRecorder: recorder,
  });
  const [trip] = await roundTrip(recorder);
  assert.equal(trip.row.engine, "v4");
  assert.equal(trip.row.rules_revision, "s5_profiles_v3");
  assert.equal(trip.payload.args.rulesRevision, "s5_profiles_v3");
  assert.deepEqual(trip.payload.args.teamOrderRows, teamOrderRows);
  assert.equal(trip.payload.args.raceStages.length, STAGES.length);
  assert.equal(trip.replay.outputSha256, trip.row.output_sha256);
});

test("v4 whole-race med formtoppe slukket: genafspilningen genskaber formPeaks=false", async () => {
  const real = await loadRaceEngineV4();
  const v4Engine = { ...real, formPeaks: false, simulateStage: (args) => real.simulateStage({ ...args, formPeaks: false }) };
  const recorder = createEngineInputRecorder({ raceId: RACE.id });
  buildRaceResults({ race: RACE, stages: STAGES, entrants: entrants(), pointsLookup: {}, v3: true, v4Engine, rulesRevision: "s5_profiles_v2", engineInputRecorder: recorder });
  const trips = await roundTrip(recorder);
  assert.equal(trips.length, 2);
  for (const { payload, row, replay } of trips) {
    assert.equal(payload.formPeaksOff, true);
    assert.equal(replay.outputSha256, row.output_sha256, `etape ${row.stage_number}`);
  }
});

test("kandidat-revision: samme etape køres under en anden revision og sammenlignes", async () => {
  const v4Engine = await loadRaceEngineV4();
  const recorder = createEngineInputRecorder({ raceId: RACE.id });
  buildStageRowsAccumulated({
    race: RACE, stagesSorted: STAGES, stageIndex: 0, entrants: entrants(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine, rulesRevision: "s5_profiles_v3", engineInputRecorder: recorder,
  });
  const rows = await buildSnapshotRows({ raceId: RACE.id, recorder });
  const payload = decodeSnapshot(rows[0]);
  const base = await replayEngineInput(payload);
  const cand = await replayEngineInput(payload, { revisionOverride: "legacy" });
  assert.equal(payload.args.rulesRevision, "s5_profiles_v3", "override muterer ikke snapshot'et");
  const diff = compareRanked(base.result.ranked, cand.result.ranked);
  assert.equal(diff.total, base.result.ranked.length);
  assert.equal(typeof diff.sameWinner, "boolean");
  assert.ok(diff.moves.length > 0);
  // v3-etaper kan ikke køres under en v4-revision.
  await assert.rejects(replayEngineInput({ engine: "v3", args: {} }, { revisionOverride: "legacy" }), /requires a v4 stage/);
});

test("output-hashen fanger en ændring (en anden seed giver en anden hash)", async () => {
  const recorder = createEngineInputRecorder({ raceId: RACE.id });
  buildRaceResults({ race: { ...RACE, race_type: "one_day", stages: 1 }, stages: [STAGES[0]], entrants: entrants(), pointsLookup: {}, v3: true, engineInputRecorder: recorder });
  const [trip] = await roundTrip(recorder);
  const tampered = await replayEngineInput({ ...trip.payload, args: { ...trip.payload.args, seed: trip.payload.args.seed + 1 } });
  assert.notEqual(tampered.outputSha256, trip.row.output_sha256);
  assert.equal(hashEngineOutput(trip.replay.result), trip.row.output_sha256);
});

// ── Privat skrivning: kaster aldrig ────────────────────────────────────────

function recordedRecorder() {
  const recorder = createEngineInputRecorder({ raceId: RACE.id });
  buildRaceResults({ race: RACE, stages: STAGES, entrants: entrants(), pointsLookup: {}, v3: true, engineInputRecorder: recorder });
  return recorder;
}

function fakeSupabase(upsertImpl) {
  const calls = [];
  return {
    calls,
    from(table) {
      return { upsert: (rows, opts) => { calls.push({ table, rows, opts }); return upsertImpl(rows, opts); } };
    },
  };
}

test("persist: upsert på (race_id, stage_number) i den private tabel; rækkerne kan genafspilles", async () => {
  const sb = fakeSupabase(async () => ({ error: null }));
  const captured = [];
  const status = await persistEngineInputSnapshots({ supabase: sb, race: RACE, recorder: recordedRecorder(), captureExceptionFn: (e) => captured.push(e) });
  assert.equal(status.written, 2);
  assert.equal(captured.length, 0);
  assert.equal(sb.calls.length, 1);
  assert.equal(sb.calls[0].table, ENGINE_INPUT_SNAPSHOT_TABLE);
  assert.deepEqual(sb.calls[0].opts, { onConflict: "race_id,stage_number" });
  const row = sb.calls[0].rows[1];
  assert.equal(row.race_id, RACE.id);
  assert.equal(row.stage_number, 2);
  assert.ok(row.stored_bytes > 0 && row.input_bytes > row.stored_bytes, "gzip skal komprimere");
  const replay = await replayEngineInput(decodeSnapshot(row));
  assert.equal(replay.outputSha256, row.output_sha256);
});

test("persist: manglende tabel (42P01 / PGRST205) springes stille over — ingen Sentry-støj før migrationen", async () => {
  for (const error of [{ code: "42P01", message: 'relation "race_stage_engine_inputs" does not exist' }, { code: "PGRST205", message: "Could not find the table 'public.race_stage_engine_inputs' in the schema cache" }]) {
    const captured = [];
    const status = await persistEngineInputSnapshots({ supabase: fakeSupabase(async () => ({ error })), race: RACE, recorder: recordedRecorder(), captureExceptionFn: (e) => captured.push(e) });
    assert.deepEqual(status, { written: 0, skipped: "missing-table" });
    assert.equal(captured.length, 0);
  }
  assert.equal(isMissingSnapshotTableError({ code: "23505", message: "duplicate" }), false);
});

test("persist: andre fejl, kast og timeout går til Sentry og vælter ALDRIG afviklingen", async () => {
  const cases = [
    fakeSupabase(async () => ({ error: { code: "57014", message: "statement timeout" } })),
    fakeSupabase(() => { throw new Error("netværk nede"); }),
    fakeSupabase(() => new Promise(() => {})), // hænger for evigt
    { from() { throw new Error("klient ødelagt"); } },
  ];
  for (const supabase of cases) {
    const captured = [];
    const status = await persistEngineInputSnapshots({ supabase, race: RACE, recorder: recordedRecorder(), captureExceptionFn: (e, ctx) => captured.push(ctx), timeoutMs: 20 });
    assert.deepEqual(status, { written: 0, skipped: "error" });
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].fingerprint, ["engine-input-snapshot-failed"]);
  }
});

test("persist: recorder=null (dryRun) gør intet", async () => {
  assert.deepEqual(await persistEngineInputSnapshots({ supabase: null, race: RACE, recorder: null }), { written: 0, skipped: "no-recorder" });
});

// ── Størrelse (til PR-body) ────────────────────────────────────────────────

test("størrelse: et prod-stort felt (176 ryttere, 22 hold) giver en lille række pr. etape", async (t) => {
  const v4Engine = await loadRaceEngineV4();
  const field = entrants(176, 22);
  const teamOrderRows = field.filter((_, i) => i % 8 === 0).map((e) => ({ team_id: e.team_id, race_id: RACE.id, stage_number: 1, rider_id: e.rider_id, effort: "high" }));
  const sizes = {};
  for (const [label, v4] of [["v3", null], ["v4", v4Engine]]) {
    const recorder = createEngineInputRecorder({ raceId: RACE.id });
    buildStageRowsAccumulated({
      race: RACE, stagesSorted: STAGES, stageIndex: 1, entrants: field, pointsLookup: {},
      priorStageRows: [], v3: true, v4Engine: v4, teamOrderRows: v4 ? teamOrderRows : [], rulesRevision: v4 ? "s5_profiles_v3" : "legacy", engineInputRecorder: recorder,
    });
    const [row] = await buildSnapshotRows({ raceId: RACE.id, recorder });
    sizes[label] = { input_bytes: row.input_bytes, stored_bytes: row.stored_bytes };
    // Grov loftsvagt: en etape må aldrig fylde mere end 256 KB gemt.
    assert.ok(row.stored_bytes < 256 * 1024, `${label}: ${row.stored_bytes} bytes`);
  }
  t.diagnostic(`engine-input sizes (176 riders): ${JSON.stringify(sizes)}`);
});
