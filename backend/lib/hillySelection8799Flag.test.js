// #8799: én kontakt (app_config hilly_selection_8799) for selektionen paa kuperet og mellembjerg
// (#7645) og afslutningerne paa kuperet og boelget (#8189), med startstempel.
//
// Kun "on" taender; raceRunner sender kontakten til broen KUN under s5_profiles_v3 (og senere) og
// KUN for et loeb, der blev stemplet ved sin foerste etape. Vaerdien er med i run-identiteten
// (input_checksum) og i motor-argumenterne, saa #1857-genafspilningen genskaber den.
//
// Slukket = bit-identisk med merge-basen FOER kontakten: __fixtures__/raceRunner8799FlagOff.json
// er skrevet af merge-basens kode (sourceCommit i filen) med de samme scenarier
// (__fixtures__/raceRunner8799Scenarios.js) og genereres aldrig med den nye kode. Kun hashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { HILLY_SELECTION_8799_FLAG_KEY, bindHillySelection8799, evaluateHillySelection8799Flag, isHillySelection8799Enabled } from "./hillySelection8799Flag.js";
import { resolveRaceEngineV4, v4HillySelection8799Arg } from "./raceRunner.js";
import { ENGINE_VERSION_V4, loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { buildSnapshotRows, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";
import { OFF_DIGEST_CASES_8799, RACE_8799, computeOffDigests8799, digests8799, stageByStage8799, wholeRace8799 } from "./__fixtures__/raceRunner8799Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/raceRunner8799FlagOff.json", import.meta.url), "utf8"));
const COLUMN = "hilly_selection_8799";

function configStub(value) {
  const seen = [];
  return {
    seen,
    from(table) {
      return {
        select: () => ({
          eq: (col, key) => {
            seen.push([table, col, key]);
            return { maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) };
          },
        }),
      };
    },
  };
}

/** Et races-bord i hukommelsen: stemplet, stages_completed og hvad der blev skrevet. */
function racesStub({ stamp = null, stagesCompleted = 0, missingColumn = false, readError = null } = {}) {
  const row = { [COLUMN]: stamp, stages_completed: stagesCompleted };
  const writes = [];
  return {
    row,
    writes,
    from(table) {
      assert.equal(table, "races");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (missingColumn) return { data: null, error: { code: "42703", message: `column races.${COLUMN} does not exist` } };
              if (readError) return { data: null, error: readError };
              return { data: { ...row }, error: null };
            },
          }),
        }),
        update: (patch) => {
          const filters = [];
          const chain = {
            eq: (col, val) => { filters.push(["eq", col, val]); return chain; },
            is: (col, val) => { filters.push(["is", col, val]); return chain; },
            then: (resolve) => {
              writes.push({ patch, filters });
              if (row[COLUMN] === null && row.stages_completed === 0) Object.assign(row, patch);
              resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

const RACE = { id: "race-8799-bind", stages_completed: 0 };
const ENGINE = Object.freeze({ version: ENGINE_VERSION_V4, simulateStage: () => ({}) });
const readOn = async () => "on";
const readStop = async () => "stop";
const readOff = async () => "off";

// ── Flaget ───────────────────────────────────────────────────

test("#8799 flag: kun den eksakte streng 'on' taender", () => {
  assert.equal(HILLY_SELECTION_8799_FLAG_KEY, "hilly_selection_8799");
  assert.equal(evaluateHillySelection8799Flag("on"), true);
  for (const v of ["off", "beta", "stop", true, false, null, undefined, "ON", 1, "true"]) {
    assert.equal(evaluateHillySelection8799Flag(v), false, `${JSON.stringify(v)} er slukket`);
  }
});

test("#8799 flag: app_config-opslaget, fail-safe slukket ved fravaer", async () => {
  const on = configStub("on");
  assert.equal(await isHillySelection8799Enabled(on), true);
  assert.deepEqual(on.seen, [["app_config", "key", "hilly_selection_8799"]]);
  assert.equal(await isHillySelection8799Enabled(configStub(undefined)), false, "raekken mangler");
  assert.equal(await isHillySelection8799Enabled(configStub("beta")), false);
});

test("#8799 flag: staar i flag-kataloget", () => {
  assert.equal(isStageFlagKey("hilly_selection_8799"), true);
  assert.equal(findStageFlag("hilly_selection_8799").area, "race-engine");
});

test("#8799 resolveRaceEngineV4: slukket = samme motor-objekt, fejl = slukket, taendt = markering", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const base = {
    supabase: {}, race: RACE_8799, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [],
    checkFormPeaksEnabled: async () => true, checkDayForm6649Enabled: async () => false, checkQueenStageGap7236Enabled: async () => false,
    checkStagePlanDroppedFront7635Enabled: async () => false, checkDescentRegroupCap7644Enabled: async () => false, checkSplitAttackCause7640Enabled: async () => false,
    checkLetGoOrder7557Enabled: async () => false, checkDayWords7725Enabled: async () => false, checkIttNoDayRoll7726Enabled: async () => false,
    checkTeamChase7730Enabled: async () => false, checkTimeLimitFatigue7715Enabled: async () => false, checkJerseyHunt7855Enabled: async () => false,
  };
  const off = await resolveRaceEngineV4({ ...base, checkHillySelection8799Enabled: async () => false });
  assert.equal(off.v4Engine, engine, "slukket: intet wrapper-lag, ingen markering");
  const failed = await resolveRaceEngineV4({ ...base, checkHillySelection8799Enabled: async () => { throw new Error("db"); } });
  assert.equal(failed.v4Engine, engine, "fejl i opslaget = slukket, motoren koerer stadig");
  const on = await resolveRaceEngineV4({ ...base, checkHillySelection8799Enabled: async () => true });
  assert.equal(on.v4Engine.hillySelection8799, true);
  assert.equal("hillySelection8799" in engine, false, "den indlaeste motor muteres aldrig");
  const all = await resolveRaceEngineV4({ ...base, checkLetGoOrder7557Enabled: async () => true, checkJerseyHunt7855Enabled: async () => true, checkHillySelection8799Enabled: async () => true });
  assert.equal(all.v4Engine.letGoOrder7557, true, "de andre kontakter bevares");
  assert.equal(all.v4Engine.jerseyHunt7855, true);
  assert.equal(all.v4Engine.hillySelection8799, true);
});

test("#8799 v4HillySelection8799Arg: kun markering OG s5_profiles_v3 eller nyere", () => {
  const on = { hillySelection8799: true };
  assert.deepEqual(v4HillySelection8799Arg(on, "s5_profiles_v3"), { hillySelection8799: true });
  for (const rev of ["legacy", "orders_gc_v1", "s5_profiles_v1", "s5_profiles_v2", undefined, null]) {
    assert.deepEqual(v4HillySelection8799Arg(on, rev), {}, `revision ${rev}`);
  }
  assert.deepEqual(v4HillySelection8799Arg({}, "s5_profiles_v3"), {});
  assert.deepEqual(v4HillySelection8799Arg({ hillySelection8799: "on" }, "s5_profiles_v3"), {}, "kun boolean true");
  assert.deepEqual(v4HillySelection8799Arg(null, "s5_profiles_v3"), {});
});

// ── Startstemplet ──────────────────────────────────────────────

test("#8799 stempel: et nyt loeb stemples ved foerste etape og faar reglen", async () => {
  const db = racesStub();
  const bound = await bindHillySelection8799({ supabase: db, race: RACE, v4Engine: { ...ENGINE, hillySelection8799: true }, rulesRevision: "s5_profiles_v3", firstStageClaim: true, readStage: readOn });
  assert.equal(bound.hillySelection8799, true);
  assert.equal(db.row[COLUMN], true);
  assert.equal(db.writes.length, 1);
});

test("#8799 stempel: taendt midt i et etapeloeb = gamle regler, intet skrives", async () => {
  const db = racesStub({ stagesCompleted: 2 });
  const bound = await bindHillySelection8799({ supabase: db, race: { ...RACE, stages_completed: 2 }, v4Engine: { ...ENGINE, hillySelection8799: true }, rulesRevision: "s5_profiles_v3", firstStageClaim: true, readStage: readOn });
  assert.equal("hillySelection8799" in bound, false);
  assert.equal(db.writes.length, 0);
  const notFirst = await bindHillySelection8799({ supabase: racesStub(), race: RACE, v4Engine: { ...ENGINE, hillySelection8799: true }, rulesRevision: "s5_profiles_v3", firstStageClaim: false, readStage: readOn });
  assert.equal("hillySelection8799" in notFirst, false, "kun foerste claim stempler");
});

test("#8799 stempel: et stemplet loeb koerer faerdigt med reglen, ogsaa slukket; 'stop' er noedstoppet", async () => {
  const kept = await bindHillySelection8799({ supabase: racesStub({ stamp: true, stagesCompleted: 1 }), race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: false, readStage: readOff });
  assert.equal(kept.hillySelection8799, true, "slukket kontakt fjerner ikke reglen fra et stemplet loeb");
  const lookupFails = await bindHillySelection8799({ supabase: racesStub({ stamp: true, stagesCompleted: 1 }), race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: false, readStage: async () => { throw new Error("db"); } });
  assert.equal(lookupFails.hillySelection8799, true, "en opslagsfejl aendrer aldrig et loeb i gang");
  const stopped = await bindHillySelection8799({ supabase: racesStub({ stamp: true, stagesCompleted: 1 }), race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: false, readStage: readStop });
  assert.equal(stopped, ENGINE, "noedstop: motoren uden reglen");
});

test("#8799 stempel: kanter (aeldre revision, manglende kolonne, DB-fejl, dryRun, ingen motor)", async () => {
  const v2 = await bindHillySelection8799({ supabase: { from: () => { throw new Error("intet DB-kald under v2"); } }, race: RACE, v4Engine: { ...ENGINE, hillySelection8799: true }, rulesRevision: "s5_profiles_v2", firstStageClaim: true });
  assert.equal("hillySelection8799" in v2, false);
  const missing = await bindHillySelection8799({ supabase: racesStub({ missingColumn: true }), race: RACE, v4Engine: { ...ENGINE, hillySelection8799: true }, rulesRevision: "s5_profiles_v3", firstStageClaim: true });
  assert.equal("hillySelection8799" in missing, false, "migrationen ikke applied = ikke stemplet");
  const missingOff = await bindHillySelection8799({ supabase: racesStub({ missingColumn: true }), race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: true });
  assert.equal(missingOff, ENGINE);
  await assert.rejects(() => bindHillySelection8799({ supabase: racesStub({ readError: { code: "57014", message: "timeout" } }), race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: true }), /hilly_selection_8799/);
  const db = racesStub();
  const dry = await bindHillySelection8799({ supabase: db, race: RACE, v4Engine: { ...ENGINE, hillySelection8799: true }, rulesRevision: "s5_profiles_v3", firstStageClaim: true, dryRun: true });
  assert.equal(dry.hillySelection8799, true);
  assert.equal(db.writes.length, 0, "dryRun skriver aldrig");
  assert.equal(await bindHillySelection8799({ supabase: db, race: RACE, v4Engine: null, rulesRevision: "s5_profiles_v3", firstStageClaim: true }), null);
  const offUnstamped = await bindHillySelection8799({ supabase: db, race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: true });
  assert.equal(offUnstamped, ENGINE, "slukket og ikke stemplet: samme objekt, intet skrives");
  assert.equal(db.writes.length, 0);
});

// ── Slukket = bit-identisk med merge-basen ─────────────────────

test("#8799 slukket: den frosne fixture er fra merge-basen og daekker praecis scenarierne", () => {
  assert.match(FROZEN.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(FROZEN).filter((k) => k !== "sourceCommit" && k !== "note"), OFF_DIGEST_CASES_8799.map((c) => c.key));
});

test("#8799 slukket: checksum, motor-input og output er bit-identiske med merge-basen", async () => {
  const now = await computeOffDigests8799();
  for (const c of OFF_DIGEST_CASES_8799) assert.deepEqual(now[c.key], FROZEN[c.key], c.key);
});

// ── Taendt ─────────────────────────────────────────────────────

test("#8799 taendt: kuperede etaper flytter, run-identiteten aendres, og genafspilningen genskaber etapen", async () => {
  const engine = await loadRaceEngineV4();
  const on = wholeRace8799({ ...engine, hillySelection8799: true }, "s5_profiles_v3");
  const digests = await digests8799(on);
  const frozen = FROZEN["wholeRace:s5_profiles_v3"];
  assert.ok(digests.outputSha256.some((h, i) => h !== frozen.outputSha256[i]), "mindst én etape flytter");
  assert.ok(digests.inputChecksums.every((h, i) => h !== frozen.inputChecksums[i]), "kontakten staar i run-identiteten paa hver etape");
  const rows = await buildSnapshotRows({ raceId: RACE_8799.id, recorder: on.recorder });
  for (const row of rows) {
    const replay = await replayEngineInput(decodeSnapshot(row));
    assert.equal(replay.outputSha256, row.output_sha256, `etape ${row.stage_number}`);
  }
  const stage = await digests8799(stageByStage8799({ ...engine, hillySelection8799: true }, "s5_profiles_v3", 0));
  assert.notDeepEqual(stage.outputSha256, FROZEN["stageByStage:s5_profiles_v3:stage1"].outputSha256, "etape for etape: samme ledning");
});

test("#8799 taendt: under s5_profiles_v2 goer kontakten intet", async () => {
  const engine = await loadRaceEngineV4();
  const on = await digests8799(wholeRace8799({ ...engine, hillySelection8799: true }, "s5_profiles_v2"));
  assert.deepEqual(on, FROZEN["wholeRace:s5_profiles_v2"]);
});
