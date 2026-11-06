// #7733: planryttere og hele hold forsvandt midt i etapeloeb uden spor. Startreglerne (pulje
// og trup) blev genkoert paa hver etape, saa et hold der skiftede pulje eller en rytter der
// skiftede trup faldt ud af et loeb han allerede var i.
//
// Slukket = bit-identisk med merge-basen FOER kontakten:
// __fixtures__/startedFieldLock7733FlagOff.json er skrevet af merge-basens kode (sourceCommit i
// filen) med de samme scenarier (__fixtures__/startedFieldLock7733Scenarios.js) og genereres
// aldrig med den nye kode. Kun hashes og antal; syntetisk, ingen prod-data.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  STARTED_FIELD_LOCK_7733_FLAG_KEY, evaluateStartedFieldLock7733Flag, isStartedFieldLock7733Enabled,
} from "./startedFieldLock7733Flag.js";
import { FRESH_FLAG_KEYS } from "./featureStage.js";
import { PLAYER_VISIBLE_FLAG_KEYS, findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { loadEntrantsForRace } from "./raceRunner.js";
import {
  OFF_DIGEST_CASES_7733, RACE_7733, RIDERS_7733, STAGES_7733, TEAMS_7733,
  computeOffDigests7733, makeSupabase7733, runStage7733, worldAfterStart7733,
} from "./__fixtures__/startedFieldLock7733Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/startedFieldLock7733FlagOff.json", import.meta.url), "utf8"));

// Stubben svarer ikke paa alle berigelsens opslag; den stoej maa ikke fylde testrunnerens IPC (#3172).
for (const method of ["log", "warn", "error"]) mock.method(console, method, () => {});

const poolRiders = Array.from({ length: 6 }, (_, i) => `pool-${i}`);

// ── Kontakten ──────────────────────────────────────────────────────────────

test("kun den eksakte streng on taender", () => {
  assert.equal(evaluateStartedFieldLock7733Flag("on"), true);
  for (const value of ["off", "beta", true, "ON", null, undefined, 1]) {
    assert.equal(evaluateStartedFieldLock7733Flag(value), false, String(value));
  }
});

test("kontakten laeses fra app_config og er slukket uden raekke", async () => {
  assert.equal(await isStartedFieldLock7733Enabled(makeSupabase7733({}, { flag: "on" })), true);
  assert.equal(await isStartedFieldLock7733Enabled(makeSupabase7733({})), false);
});

test("kontakten staar i kataloget, caches aldrig og er ikke spillersynlig", () => {
  assert.equal(STARTED_FIELD_LOCK_7733_FLAG_KEY, "started_field_lock_7733");
  assert.ok(isStageFlagKey(STARTED_FIELD_LOCK_7733_FLAG_KEY));
  assert.equal(findStageFlag(STARTED_FIELD_LOCK_7733_FLAG_KEY).area, "race-engine");
  assert.ok(FRESH_FLAG_KEYS.has(STARTED_FIELD_LOCK_7733_FLAG_KEY));
  assert.ok(![...PLAYER_VISIBLE_FLAG_KEYS].includes(STARTED_FIELD_LOCK_7733_FLAG_KEY));
});

// ── Slukket: bit-identisk med merge-basen ──────────────────────────────────

test("slukket: alle scenarier giver merge-basens hashes", async () => {
  const digests = await computeOffDigests7733();
  for (const { key } of OFF_DIGEST_CASES_7733) {
    assert.deepEqual(digests[key], FROZEN[key], key);
  }
});

test("slukket: fejlen er stadig der, hold og ryttere falder ud", async () => {
  const { stageRiderIds } = await runStage7733();
  for (const id of poolRiders) assert.ok(!stageRiderIds.includes(id), id);
  assert.ok(!stageRiderIds.includes(RIDERS_7733.movedSquad));
});

test("slukket: uden stempel aendrer en taendt kontakt intet paa et startet loeb", async () => {
  const off = await runStage7733();
  const failing = await runStage7733({
    flag: "on",
    extraDeps: { readStartedFieldLock7733: async () => false },
  });
  assert.deepEqual(failing.stageRiderIds, off.stageRiderIds);
});

// ── Taendt ─────────────────────────────────────────────────────────────────

test("taendt: holdet der forlod puljen koerer videre med alle sine ryttere", async () => {
  const { stageRiderIds } = await runStage7733({ flag: "on" });
  for (const id of poolRiders) assert.ok(stageRiderIds.includes(id), id);
});

test("taendt: en rytter der skiftede trup koerer videre for samme hold", async () => {
  const { rows, stageRiderIds } = await runStage7733({ flag: "on" });
  assert.ok(stageRiderIds.includes(RIDERS_7733.movedSquad));
  assert.ok(stageRiderIds.includes(RIDERS_7733.academy));
  const row = rows.find((r) => r.result_type === "stage" && r.rider_id === RIDERS_7733.movedSquad);
  assert.equal(row.team_id, TEAMS_7733.mixed);
});

test("taendt: fyret, pensioneret og skadet falder stadig ud", async () => {
  const { stageRiderIds } = await runStage7733({ flag: "on" });
  assert.ok(!stageRiderIds.includes(RIDERS_7733.leftTeam));
  assert.ok(!stageRiderIds.includes(RIDERS_7733.retired));
  assert.ok(!stageRiderIds.includes(RIDERS_7733.injured));
});

test("taendt: den skadede faar stadig sin udgaaelse (#4418)", async () => {
  const { supabase } = await runStage7733({ flag: "on" });
  const rows = supabase.__writes.filter((w) => w.table === "race_incidents" && w.op === "insert").flatMap((w) => w.rows);
  assert.ok(rows.some((r) => r.rider_id === RIDERS_7733.injured && r.outcome === "abandon"));
});

test("taendt: det gaelder ogsaa et seniorloeb", async () => {
  const race = { ...RACE_7733, id: "race-7733-senior", squad: "senior" };
  const { stageRiderIds } = await runStage7733({ race, flag: "on" });
  for (const id of poolRiders) assert.ok(stageRiderIds.includes(id), id);
  assert.ok(stageRiderIds.includes(RIDERS_7733.movedSquad));
});

test("etape 1 laeser aldrig stemplet: startreglerne gaelder fuldt ud ved start", async () => {
  let asked = 0;
  const race = { ...RACE_7733, stages_completed: 0 };
  const supabase = makeSupabase7733(worldAfterStart7733({ race }), { flag: "on" });
  const entrants = await loadEntrantsForRace({
    supabase, race, stages: STAGES_7733, persist: false, allowAutofill: false, today: "2026-10-15",
  });
  assert.ok(!entrants.some((e) => poolRiders.includes(e.rider_id)));
  await runStage7733({
    race, stageIndex: 0, flag: "on",
    extraDeps: { readStartedFieldLock7733: async () => { asked += 1; return true; } },
  });
  assert.equal(asked, 0);
});

test("binding: foerste etape stempler loebet, naar kontakten er taendt", async () => {
  const race = { ...RACE_7733, stages_completed: 0 };
  const { supabase } = await runStage7733({ race, stageIndex: 0, extraDeps: { checkStartedFieldLock7733Enabled: async () => true } });
  assert.ok(supabase.__writes.some((w) => w.table === "races" && w.op === "update" && w.obj.started_field_lock_7733 === true));
});

test("binding: slukket kontakt stempler aldrig", async () => {
  const race = { ...RACE_7733, stages_completed: 0 };
  const { supabase } = await runStage7733({ race, stageIndex: 0 });
  assert.ok(!supabase.__writes.some((w) => w.table === "races" && w.obj?.started_field_lock_7733 !== undefined));
});

test("binding: en laesefejl fra etape 2 stopper etapen i stedet for at fjerne ryttere", async () => {
  await assert.rejects(runStage7733({ extraDeps: { readStartedFieldLock7733: async () => { throw new Error("boom"); } } }), /boom/);
});
