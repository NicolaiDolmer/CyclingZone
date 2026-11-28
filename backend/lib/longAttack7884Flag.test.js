// #8828: kontakten long_attack_7884 med startstempel (samme kontrakt som #8799, stemplet laeses foer
// kontakten som #8801). Kun "on" taender; et stemplet loeb koerer faerdigt med reglen; "stop" er
// noedstoppet; API'et tager kun imod stederne, naar loebet vil koere med dem.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LONG_ATTACK_7884_FLAG_KEY, bindLongAttack7884, isLongAttack7884Enabled, longAttack7884OpenForRaceStamped } from "./longAttack7884Flag.js";
import { resolveRaceEngineV4, v4LongAttack7884Arg } from "./raceRunner.js";
import { ENGINE_VERSION_V4 } from "./raceEngineV4Bridge.js";
import { findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { FRESH_FLAG_KEYS } from "./featureStage.js";

const COLUMN = "long_attack_7884";

function configStub(value) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }) }) }),
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

const RACE = { id: "race-8828-bind", stages_completed: 0 };
const ENGINE = Object.freeze({ version: ENGINE_VERSION_V4, simulateStage: () => ({}) });
const readOn = async () => "on";
const readOff = async () => "off";
const readStop = async () => "stop";

test("#8828 flag: noeglen, app_config-opslaget og kataloget; kun 'on' taender", async () => {
  assert.equal(LONG_ATTACK_7884_FLAG_KEY, COLUMN);
  assert.equal(await isLongAttack7884Enabled(configStub("on")), true);
  for (const v of [undefined, "off", "beta", "stop", true]) assert.equal(await isLongAttack7884Enabled(configStub(v)), false, String(v));
  assert.equal(isStageFlagKey(COLUMN), true);
  assert.equal(findStageFlag(COLUMN).area, "race-engine");
  assert.equal(FRESH_FLAG_KEYS.has(COLUMN), true, "motorens input laeses friskt");
});

test("#8828 migrationen: kolonnen og app_config 'off', additiv og idempotent", () => {
  const sql = readFileSync(new URL("../../database/2026-11-27-8828-long-attack-binding.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS long_attack_7884 boolean/);
  assert.match(sql, /'long_attack_7884',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
  assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b|\bUPDATE\b/i);
});

test("#8828 resolveRaceEngineV4: slukket = samme motor-objekt, fejl = slukket, taendt = forslag", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const no = async () => false;
  const base = {
    supabase: {}, race: { id: "r", season_id: "s" }, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [],
    checkFormPeaksEnabled: async () => true, checkDayForm6649Enabled: no, checkQueenStageGap7236Enabled: no, checkStagePlanDroppedFront7635Enabled: no,
    checkDescentRegroupCap7644Enabled: no, checkSplitAttackCause7640Enabled: no, checkLetGoOrder7557Enabled: no, checkDayWords7725Enabled: no,
    checkIttNoDayRoll7726Enabled: no, checkTeamChase7730Enabled: no, checkTimeLimitFatigue7715Enabled: no, checkJerseyHunt7855Enabled: no, checkHillySelection8799Enabled: no,
  };
  assert.equal((await resolveRaceEngineV4({ ...base, checkLongAttack7884Enabled: no })).v4Engine, engine);
  assert.equal((await resolveRaceEngineV4({ ...base, checkLongAttack7884Enabled: async () => { throw new Error("db"); } })).v4Engine, engine);
  const on = await resolveRaceEngineV4({ ...base, checkLongAttack7884Enabled: async () => true, checkHillySelection8799Enabled: async () => true });
  assert.equal(on.v4Engine.longAttack7884, true);
  assert.equal(on.v4Engine.hillySelection8799, true, "de andre kontakter bevares");
  assert.equal("longAttack7884" in engine, false, "den indlaeste motor muteres aldrig");
});

test("#8828 v4LongAttack7884Arg: kun markering OG s5_profiles_v3 eller nyere", () => {
  assert.deepEqual(v4LongAttack7884Arg({ longAttack7884: true }, "s5_profiles_v3"), { longAttack7884: true });
  for (const rev of ["legacy", "s5_profiles_v2", undefined]) assert.deepEqual(v4LongAttack7884Arg({ longAttack7884: true }, rev), {});
  assert.deepEqual(v4LongAttack7884Arg({}, "s5_profiles_v3"), {});
  assert.deepEqual(v4LongAttack7884Arg({ longAttack7884: "on" }, "s5_profiles_v3"), {});
});

test("#8828 stempel: et nyt loeb stemples ved foerste etape; startet eller ikke foerste claim = gamle regler", async () => {
  const db = racesStub();
  const bound = await bindLongAttack7884({ supabase: db, race: RACE, v4Engine: { ...ENGINE, longAttack7884: true }, rulesRevision: "s5_profiles_v3", firstStageClaim: true });
  assert.equal(bound.longAttack7884, true);
  assert.equal(db.row[COLUMN], true);
  const started = racesStub({ stagesCompleted: 2 });
  const mid = await bindLongAttack7884({ supabase: started, race: { ...RACE, stages_completed: 2 }, v4Engine: { ...ENGINE, longAttack7884: true }, rulesRevision: "s5_profiles_v3", firstStageClaim: true });
  assert.equal("longAttack7884" in mid, false);
  assert.equal(started.writes.length, 0);
  const notFirst = await bindLongAttack7884({ supabase: racesStub(), race: RACE, v4Engine: { ...ENGINE, longAttack7884: true }, rulesRevision: "s5_profiles_v3", firstStageClaim: false });
  assert.equal("longAttack7884" in notFirst, false);
});

test("#8828 stempel laeses foer kontakten: et stemplet loeb koerer faerdigt; 'stop' er noedstoppet", async () => {
  const kept = await bindLongAttack7884({ supabase: racesStub({ stamp: true, stagesCompleted: 1 }), race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: false, readStage: readOff });
  assert.equal(kept.longAttack7884, true);
  const rerun = await bindLongAttack7884({ supabase: racesStub({ stamp: true }), race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: true, readStage: readOff });
  assert.equal(rerun.longAttack7884, true, "genkoersel af etape 1 paa et stemplet loeb: samme regler (#8801)");
  const lookupFails = await bindLongAttack7884({ supabase: racesStub({ stamp: true, stagesCompleted: 1 }), race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: false, readStage: async () => { throw new Error("db"); } });
  assert.equal(lookupFails.longAttack7884, true);
  const stopped = await bindLongAttack7884({ supabase: racesStub({ stamp: true, stagesCompleted: 1 }), race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: false, readStage: readStop });
  assert.equal(stopped, ENGINE);
});

test("#8828 stempel: kanter (aeldre revision, manglende kolonne, DB-fejl, dryRun, ingen motor)", async () => {
  const v2 = await bindLongAttack7884({ supabase: { from: () => { throw new Error("intet DB-kald"); } }, race: RACE, v4Engine: { ...ENGINE, longAttack7884: true }, rulesRevision: "s5_profiles_v2", firstStageClaim: true });
  assert.equal("longAttack7884" in v2, false);
  const missing = await bindLongAttack7884({ supabase: racesStub({ missingColumn: true }), race: RACE, v4Engine: { ...ENGINE, longAttack7884: true }, rulesRevision: "s5_profiles_v3", firstStageClaim: true });
  assert.equal("longAttack7884" in missing, false);
  await assert.rejects(() => bindLongAttack7884({ supabase: racesStub({ readError: { code: "57014", message: "timeout" } }), race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: true }), /long_attack_7884/);
  const db = racesStub();
  const dry = await bindLongAttack7884({ supabase: db, race: RACE, v4Engine: { ...ENGINE, longAttack7884: true }, rulesRevision: "s5_profiles_v3", firstStageClaim: true, dryRun: true });
  assert.equal(dry.longAttack7884, true);
  assert.equal(db.writes.length, 0, "dryRun skriver aldrig");
  assert.equal(await bindLongAttack7884({ supabase: db, race: RACE, v4Engine: null, rulesRevision: "s5_profiles_v3", firstStageClaim: true }), null);
  assert.equal(await bindLongAttack7884({ supabase: db, race: RACE, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: true }), ENGINE);
});

test("#8828 API: stederne kan kun gemmes, naar loebet vil koere dem; enhver fejl = lukket", async () => {
  assert.equal(await longAttack7884OpenForRaceStamped({ supabase: racesStub(), race: RACE, readStage: readOn }), true, "taendt, ikke startet");
  assert.equal(await longAttack7884OpenForRaceStamped({ supabase: racesStub({ stagesCompleted: 1 }), race: RACE, readStage: readOn }), false, "taendt, men startet uden stempel");
  assert.equal(await longAttack7884OpenForRaceStamped({ supabase: racesStub(), race: RACE, readStage: readOff }), false);
  assert.equal(await longAttack7884OpenForRaceStamped({ supabase: racesStub({ stamp: true, stagesCompleted: 2 }), race: RACE, readStage: readOff }), true, "stemplet koerer faerdigt");
  assert.equal(await longAttack7884OpenForRaceStamped({ supabase: racesStub({ stamp: true, stagesCompleted: 2 }), race: RACE, readStage: readStop }), false, "noedstop");
  assert.equal(await longAttack7884OpenForRaceStamped({ supabase: racesStub({ missingColumn: true }), race: RACE, readStage: readOn }), false, "migrationen ikke applied");
  assert.equal(await longAttack7884OpenForRaceStamped({ supabase: racesStub({ readError: { message: "x" } }), race: RACE, readStage: readOn }), false);
  assert.equal(await longAttack7884OpenForRaceStamped({ supabase: racesStub(), race: RACE, readStage: async () => { throw new Error("db"); } }), false);
});
