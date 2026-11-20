// #6110 ejer 19/11: "Hold uden division skal ikke træne." Kontakten training_calendar_tick_ai_only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCalendarTickAiOnly, TRAINING_CALENDAR_TICK_AI_ONLY_KEY } from "./trainingCalendarTickFlag.js";
import { isLegacyCalendarTickTeam } from "./trainingDateClose.js";
import { buildSweepPlan } from "./trainingDayCloseTrigger.js";
import { STAGE_FLAGS } from "./stageFlagCatalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** En stedfortræder for app_config med én værdi (eller en fejl). */
function fakeConfig(value, { error = null } = {}) {
  return {
    from() {
      const b = {
        select() { return b; },
        eq() { return b; },
        maybeSingle() { return Promise.resolve(error ? { data: null, error } : { data: value === undefined ? null : { value }, error: null }); },
        single() { return b.maybeSingle(); },
        limit() { return b; },
        then(resolve, reject) { return b.maybeSingle().then(resolve, reject); },
      };
      return b;
    },
  };
}

const AI = { id: "ai", league_division_id: null, is_ai: true, parked_at: null };
const HUMAN = { id: "human", league_division_id: null, is_ai: false, parked_at: null };
const PARKED = { id: "parked", league_division_id: null, is_ai: false, parked_at: "2026-10-28T00:00:00Z" };
const IN_DIVISION = { id: "div", league_division_id: "d1", is_ai: false, parked_at: null };

test("slukket (som i dag): ethvert ikke-parkeret hold uden division får reservevejens tick", () => {
  assert.equal(isLegacyCalendarTickTeam(AI), true);
  assert.equal(isLegacyCalendarTickTeam(HUMAN), true);
  assert.equal(isLegacyCalendarTickTeam(PARKED), false);
  assert.equal(isLegacyCalendarTickTeam(IN_DIVISION), false);
});

test("tændt: kun AI-hold uden division; et menneskehold uden division træner ikke", () => {
  assert.equal(isLegacyCalendarTickTeam(AI, { aiOnly: true }), true);
  assert.equal(isLegacyCalendarTickTeam(HUMAN, { aiOnly: true }), false);
  assert.equal(isLegacyCalendarTickTeam(PARKED, { aiOnly: true }), false);
  assert.equal(isLegacyCalendarTickTeam(IN_DIVISION, { aiOnly: true }), false);
});

test("buildSweepPlan: tændt planlægger ikke menneskehold uden division; slukket som før", () => {
  const args = { teams: [AI, HUMAN, IN_DIVISION], gameDaysByDivisionMap: new Map([["d1", [5]]]), alreadyRanRaceDayKeys: new Set(), alreadyRanLegacyTeamIds: new Set() };
  const off = buildSweepPlan(args).map((p) => `${p.teamId}:${p.gameDay}`);
  assert.deepEqual(off.sort(), ["ai:null", "div:5", "human:null"]);
  const on = buildSweepPlan({ ...args, calendarTickAiOnly: true }).map((p) => `${p.teamId}:${p.gameDay}`);
  assert.deepEqual(on.sort(), ["ai:null", "div:5"]);
});

test("kontakten er binær: kun 'on' tænder; manglende række, beta og en fejl er slukket", async () => {
  assert.equal(await isCalendarTickAiOnly(fakeConfig("on")), true);
  for (const value of ["off", "beta", undefined, null, true]) assert.equal(await isCalendarTickAiOnly(fakeConfig(value)), false, String(value));
  assert.equal(await isCalendarTickAiOnly(fakeConfig("on", { error: { message: "boom" } })), false, "fejl = dagens regel");
});

test("kontakten står i kataloget og seedes off af migrationen", () => {
  assert.ok(STAGE_FLAGS.some((flag) => flag.key === TRAINING_CALENDAR_TICK_AI_ONLY_KEY));
  const sql = readFileSync(resolve(__dirname, "../../database/2026-11-19-6110-training-calendar-tick-ai-only-flag.sql"), "utf8");
  assert.match(sql, /'training_calendar_tick_ai_only'/);
  assert.match(sql, /'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
});
