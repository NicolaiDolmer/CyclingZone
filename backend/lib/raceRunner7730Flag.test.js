// #7730: taend-ledningen for at jagten afgoeres af de hold der jager. Kun app_config team_chase_7730
// = "on" taender, kun under s5_profiles_v3 (og senere), og kun for et loeb der blev bundet ved sin
// foerste etape-claim. Vaerdien er med i run-identiteten og i motor-argumenterne.
//
// Slukket = bit-identisk med merge-basen FOER kontakten: __fixtures__/raceRunner7730FlagOff.json er
// skrevet af merge-basens kode (sourceCommit i filen) med de samme scenarier
// (__fixtures__/raceRunner7730Scenarios.js) og genereres aldrig med den nye kode.
// Kun hashes; syntetisk fixture, ingen prod-data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TEAM_CHASE_7730_EMERGENCY_STOP, TEAM_CHASE_7730_FLAG_KEY, bindTeamChase7730, evaluateTeamChase7730Flag, isTeamChase7730Enabled } from "./teamChase7730Flag.js";
import { resolveRaceEngineV4, v4TeamChase7730Arg } from "./raceRunner.js";
import { ENGINE_VERSION_V4, loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { buildSnapshotRows, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";
import { ENGINE_SEEDS_7730, OFF_DIGEST_CASES_7730, RACE_7730, computeOffDigests7730Runner, digests7730, wholeRace7730 } from "./__fixtures__/raceRunner7730Scenarios.js";
import { chaseFloorTargetGapSeconds } from "./engine/v4/mechanics/breakaway.ts";
import { rngFor } from "./engine/v4/rng.ts";
import { stageRaceRuns } from "./engine/v4/testUtils/stageRaceField6804.ts";
import { BREAKAWAY_EXTRA_TUNING } from "./engine/v4/tuning.ts";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/raceRunner7730FlagOff.json", import.meta.url), "utf8"));

function configStub(value) {
  const seen = [];
  return {
    seen,
    from(table) {
      return { select: () => ({ eq: (col, key) => { seen.push([table, col, key]); return { maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }; } }) };
    },
  };
}

/** Et loeb i races-tabellen, med kun de kald bindingen bruger. */
function raceTable(row, { readError = null, updateError = null } = {}) {
  const calls = { reads: 0, updates: [] };
  const supabase = {
    from(table) {
      assert.equal(table, "races");
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => { calls.reads += 1; return readError ? { data: null, error: readError } : { data: { ...row }, error: null }; } }) }),
        update: (patch) => {
          const filters = [];
          const chain = {
            eq: (col, value) => { filters.push(["eq", col, value]); return chain; },
            is: (col, value) => { filters.push(["is", col, value]); return chain; },
            then: (done) => {
              calls.updates.push({ patch, filters });
              if (!updateError && row.team_chase_7730 == null && row.stages_completed === 0) Object.assign(row, patch);
              return Promise.resolve({ error: updateError }).then(done);
            },
          };
          return chain;
        },
      };
    },
  };
  return { supabase, calls, row };
}

const ENGINE = Object.freeze({ version: ENGINE_VERSION_V4, teamChase7730: true });
const PLAIN = Object.freeze({ version: ENGINE_VERSION_V4 });
const bind = (table, over = {}) => bindTeamChase7730({ supabase: table.supabase, race: { id: "r1" }, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: true, ...over });
const MISSING = { code: "42703", message: "column races.team_chase_7730 does not exist" };

// ── Flaget ───────────────────────────────────────────────────

test("#7730 flag: kun den eksakte streng 'on' taender", () => {
  assert.equal(TEAM_CHASE_7730_FLAG_KEY, "team_chase_7730");
  assert.equal(evaluateTeamChase7730Flag("on"), true);
  for (const v of ["off", "beta", "stop", true, false, null, undefined, "ON", 1, "true"]) assert.equal(evaluateTeamChase7730Flag(v), false, `${JSON.stringify(v)} er slukket`);
});

test("#7730 flag: app_config-opslaget, fail-safe slukket, og det staar i kataloget", async () => {
  const on = configStub("on");
  assert.equal(await isTeamChase7730Enabled(on), true);
  assert.deepEqual(on.seen, [["app_config", "key", "team_chase_7730"]]);
  assert.equal(await isTeamChase7730Enabled(configStub(undefined)), false);
  assert.equal(isStageFlagKey("team_chase_7730"), true);
  assert.equal(findStageFlag("team_chase_7730").area, "race-engine");
});

test("#7730 flag: migrationen seeder raekken 'off' og tilfoejer stemplet, additivt og idempotent", () => {
  const sql = readFileSync(new URL("../../database/2026-11-06-7730-race-team-chase-binding.sql", import.meta.url), "utf8");
  assert.match(sql, /'team_chase_7730',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS team_chase_7730 boolean;/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i);
});

test("#7730 resolveRaceEngineV4: slukket = samme motor-objekt, fejl = slukket, taendt er kun et forslag til bindingen", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const base = { supabase: {}, race: RACE_7730, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [], checkFormPeaksEnabled: async () => true, checkDayForm6649Enabled: async () => false, checkQueenStageGap7236Enabled: async () => false, checkStagePlanDroppedFront7635Enabled: async () => false, checkDescentRegroupCap7644Enabled: async () => false, checkSplitAttackCause7640Enabled: async () => false, checkLetGoOrder7557Enabled: async () => false };
  assert.equal((await resolveRaceEngineV4({ ...base, checkTeamChase7730Enabled: async () => false })).v4Engine, engine);
  assert.equal((await resolveRaceEngineV4({ ...base, checkTeamChase7730Enabled: async () => { throw new Error("db"); } })).v4Engine, engine);
  const on = (await resolveRaceEngineV4({ ...base, checkTeamChase7730Enabled: async () => true })).v4Engine;
  assert.equal(on.teamChase7730, true);
  const started = raceTable({ team_chase_7730: null, stages_completed: 1 });
  const bound = await bind(started, { v4Engine: on, firstStageClaim: false });
  assert.deepEqual(v4TeamChase7730Arg(bound, "s5_profiles_v3"), {}, "flaget alene omfatter intet startet loeb");
  assert.equal("teamChase7730" in engine, false, "den indlaeste motor muteres aldrig");
});

test("#7730 v4TeamChase7730Arg: kun et omfattet loeb OG s5_profiles_v3 eller nyere", () => {
  const on = { teamChase7730: true };
  assert.deepEqual(v4TeamChase7730Arg(on, "s5_profiles_v3"), { teamChase7730: true });
  for (const rev of ["legacy", "orders_gc_v1", "s5_profiles_v1", "s5_profiles_v2", undefined, null]) assert.deepEqual(v4TeamChase7730Arg(on, rev), {}, `revision ${rev}`);
  assert.deepEqual(v4TeamChase7730Arg({ teamChase7730: "on" }, "s5_profiles_v3"), {}, "kun boolean true");
  assert.deepEqual(v4TeamChase7730Arg(null, "s5_profiles_v3"), {});
});

// ── Kun loeb der ikke er startet ───────────────────────────────

test("#7730 binding: uden v4-motor eller paa en aeldre revision sker intet, og markeringen fjernes", async () => {
  const table = raceTable({ team_chase_7730: true, stages_completed: 0 });
  assert.equal(await bind(table, { v4Engine: null }), null);
  assert.deepEqual(await bind(table, { rulesRevision: "s5_profiles_v2" }), PLAIN);
  assert.equal(await bind(table, { v4Engine: PLAIN, rulesRevision: "s5_profiles_v2" }), PLAIN);
  assert.deepEqual([table.calls.reads, table.calls.updates.length], [0, 0]);
});

test("#7730 binding: slukket og ikke stemplet = samme motor, intet skrives", async () => {
  const table = raceTable({ team_chase_7730: null, stages_completed: 0 });
  assert.equal(await bind(table, { v4Engine: PLAIN }), PLAIN);
  assert.equal(table.calls.updates.length, 0);
});

test("#7730 binding: et loeb der ikke er startet, bindes betinget ved sin foerste claim", async () => {
  const table = raceTable({ team_chase_7730: null, stages_completed: 0 });
  const out = await bind(table);
  assert.equal(out.teamChase7730, true);
  assert.equal(table.row.team_chase_7730, true);
  assert.deepEqual(table.calls.updates[0].filters, [["eq", "id", "r1"], ["is", "team_chase_7730", null], ["eq", "stages_completed", 0]]);
});

test("#7730 binding: et startet loeb omfattes aldrig, heller ikke naar flaget taendes midt i det", async () => {
  for (const over of [{ firstStageClaim: false }, { firstStageClaim: true }]) {
    const table = raceTable({ team_chase_7730: null, stages_completed: 2 });
    assert.deepEqual(await bind(table, over), PLAIN);
    assert.equal(table.calls.updates.length, 0, "intet skrives");
  }
  const notClaim = raceTable({ team_chase_7730: null, stages_completed: 0 });
  assert.deepEqual(await bind(notClaim, { firstStageClaim: false }), PLAIN, "en genoptagelse uden claim binder ikke");
});

test("#7730 binding: et bundet loeb beholder kontakten paa senere etaper og ved retry", async () => {
  const table = raceTable({ team_chase_7730: true, stages_completed: 3 });
  assert.equal((await bind(table, { firstStageClaim: false })).teamChase7730, true);
  assert.equal(table.calls.updates.length, 0);
});

test("#7730 slukke-regel: slukket rammer kun nye loeb; et stemplet loeb koerer faerdigt, ogsaa ved opslagsfejl", async () => {
  const stamped = () => raceTable({ team_chase_7730: true, stages_completed: 2 });
  for (const value of ["off", "beta", null, undefined, true, "STOP"]) {
    const out = await bind(stamped(), { v4Engine: PLAIN, firstStageClaim: false, readStage: async () => value });
    assert.equal(out.teamChase7730, true, `${JSON.stringify(value)} stopper ikke et stemplet loeb`);
  }
  const failing = await bind(stamped(), { v4Engine: PLAIN, firstStageClaim: false, readStage: async () => { throw new Error("db"); } });
  assert.equal(failing.teamChase7730, true, "en opslagsfejl aendrer aldrig et loeb i gang");
  const throwing = await bind(stamped(), { v4Engine: PLAIN, firstStageClaim: false, readStage: () => { throw new Error("sync"); } });
  assert.equal(throwing.teamChase7730, true, "heller ikke en synkron fejl");
  const fresh = raceTable({ team_chase_7730: null, stages_completed: 0 });
  assert.equal(await bind(fresh, { v4Engine: PLAIN, readStage: async () => "off" }), PLAIN, "et nyt loeb faar den ikke");
});

test("#7730 slukke-regel: 'stop' er ejerens noedstop og fjerner reglen fra stemplede loeb", async () => {
  const seen = [];
  const table = raceTable({ team_chase_7730: true, stages_completed: 2 });
  const out = await bind(table, { v4Engine: PLAIN, firstStageClaim: false, readStage: async (_db, key) => { seen.push(key); return TEAM_CHASE_7730_EMERGENCY_STOP; } });
  assert.equal(TEAM_CHASE_7730_EMERGENCY_STOP, "stop");
  assert.equal(out, PLAIN);
  assert.deepEqual(seen, ["team_chase_7730"]);
  assert.equal(table.calls.updates.length, 0, "stemplet slettes aldrig");
  assert.equal(evaluateTeamChase7730Flag("stop"), false, "stop taender aldrig");
});

test("#7730 binding: en anden claim vandt eller loebet startede imens = den gemte vaerdi gaelder", async () => {
  const table = raceTable({ team_chase_7730: null, stages_completed: 0 });
  const realFrom = table.supabase.from;
  table.supabase.from = (name) => {
    const api = realFrom(name);
    return { ...api, update: (patch) => { table.row.stages_completed = 1; return api.update(patch); } };
  };
  assert.deepEqual(await bind(table), PLAIN);
  assert.equal(table.row.team_chase_7730, null);
});

test("#7730 binding: dryRun skriver aldrig, og et ikke-startet loeb previewes som omfattet", async () => {
  const table = raceTable({ team_chase_7730: null, stages_completed: 0 });
  assert.equal((await bind(table, { dryRun: true })).teamChase7730, true);
  assert.equal(table.calls.updates.length, 0);
});

test("#7730 binding: uden kolonnen er loebet ikke omfattet; andre fejl er hoejlydte", async () => {
  assert.deepEqual(await bind(raceTable({}, { readError: MISSING })), PLAIN);
  assert.equal(await bind(raceTable({}, { readError: MISSING }), { v4Engine: PLAIN }), PLAIN);
  assert.deepEqual(await bind(raceTable({ team_chase_7730: null, stages_completed: 0 }, { updateError: MISSING })), PLAIN);
  await assert.rejects(bind(raceTable({}, { readError: { code: "500", message: "boom" } })), /kunne ikke laeses/);
  await assert.rejects(bind(raceTable({}, { readError: { code: "42703", message: "column races.andet does not exist" } })), /kunne ikke laeses/, "kun denne kolonne");
  await assert.rejects(bind(raceTable({ team_chase_7730: null, stages_completed: 0 }, { updateError: { code: "500", message: "boom" } })), /kunne ikke bindes/);
});

// ── Slukket = bit-identisk med merge-basen ─────────────────────

test("#7730 slukket: den frosne fixture er fra merge-basen og daekker praecis scenarierne", () => {
  assert.match(FROZEN.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(FROZEN).filter((k) => !["sourceCommit", "note", "engine"].includes(k)), OFF_DIGEST_CASES_7730.map((c) => c.key));
});

test("#7730 slukket: fixturens seeds rammer begge lodtraekningens udfald, ellers beviser den intet", () => {
  const late = BREAKAWAY_EXTRA_TUNING.chaseFloorLateTargetGapSeconds;
  const outcomes = stageRaceRuns("s5_profiles_v3", ["flat", "rolling"], ENGINE_SEEDS_7730).map((r) => {
    const [, stage, seed] = r.key.match(/#(\d+)@(.+)$/);
    return chaseFloorTargetGapSeconds(r.route, rngFor(`${seed}:${stage}`, "breakaway_chase_floor")(), true) === late;
  });
  assert.ok(outcomes.includes(true) && outcomes.includes(false));
});

test("#7730 slukket: checksum, motor-input og output er bit-identiske med merge-basen", async () => {
  const now = await computeOffDigests7730Runner();
  for (const c of OFF_DIGEST_CASES_7730) assert.deepEqual(now[c.key], FROZEN[c.key], c.key);
  assert.deepEqual(now.engine, FROZEN.engine);
});

// ── Taendt ─────────────────────────────────────────────────────

test("#7730 taendt: run-identiteten aendres, og genafspilningen genskaber etapen", async () => {
  const engine = await loadRaceEngineV4();
  const on = wholeRace7730({ ...engine, teamChase7730: true }, "s5_profiles_v3");
  const digests = await digests7730(on);
  assert.notDeepEqual(digests.inputChecksums, FROZEN["wholeRace:s5_profiles_v3"].inputChecksums);
  const rows = await buildSnapshotRows({ raceId: RACE_7730.id, recorder: on.recorder });
  for (const row of rows) {
    const replay = await replayEngineInput(decodeSnapshot(row));
    assert.equal(replay.outputSha256, row.output_sha256, `etape ${row.stage_number}`);
  }
});

test("#7730 taendt: under s5_profiles_v2 goer kontakten intet", async () => {
  const engine = await loadRaceEngineV4();
  const off = await digests7730(wholeRace7730(engine, "s5_profiles_v2"));
  const on = await digests7730(wholeRace7730({ ...engine, teamChase7730: true }, "s5_profiles_v2"));
  assert.deepEqual(on, off);
});
