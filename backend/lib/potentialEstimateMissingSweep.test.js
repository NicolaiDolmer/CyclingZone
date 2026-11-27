// #8604 Del 1: ingen egen rytter uden tal. Tallene i PARAMS er syntetiske testværdier.
import { test } from "node:test";
import assert from "node:assert/strict";

import { POTENTIAL_ESTIMATE_PARAMS_KEY, POTENTIAL_ESTIMATES_TABLE } from "./potentialEstimateWriter.js";
import { missingOwnRidersByTeam, runPotentialEstimateMissingSweep, runPotentialEstimateMissingTick } from "./potentialEstimateMissingSweep.js";
import { buildPotentialView } from "./potentialEstimateRead.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

const PARAMS = Object.freeze({
  salt: "test",
  weights: { shared: 0.6, pair: 0.6, level: 0.53 },
  clip: 2,
  minU: 1,
  words: { sureAtOrBelow: 3, fairAtOrBelow: 6 },
  scout: { maxLooks: 3, defaultTier: 1, uByLooks: [8, 5, 3], tierFactor: [1, 0.9, 0.8, 0.7, 0.6] },
  own: { firstEstimateDates: 5, staffSpeedWeight: 0.5, steps: [{ fromDates: 0, u: 7 }, { fromDates: 12, u: 4 }, { fromDates: 20, u: 2 }] },
});
const NOW = new Date("2026-11-26T10:00:00.000Z");

const ticks = (riderId, teamId, n) => Array.from({ length: n }, (_, i) => ({
  rider_id: riderId, team_id: teamId, season_id: "s1", game_day: i + 1, tick_date: `2026-11-${String(10 + i).padStart(2, "0")}`,
}));

// #8810: timesweepet ligger bag prognosis_model2; testene af selve sweepet kører med den tændt.
const client = ({ flag = "on", model2 = "on", ...tables } = {}) => createFakeSupabase({
  app_config: [
    { key: "potential_estimate_writes", value: flag },
    ...(model2 == null ? [] : [{ key: "prognosis_model2", value: model2 }]),
  ],
  private_config: [{ key: POTENTIAL_ESTIMATE_PARAMS_KEY, value: PARAMS }],
  teams: [{ id: "t1", is_ai: false, is_bank: false }, { id: "ai", is_ai: true, is_bank: false }],
  [POTENTIAL_ESTIMATES_TABLE]: [],
  team_staff: [],
  team_facilities: [],
  scout_actions: [],
  training_rider_ticks: [],
  rider_training_scores: [],
  training_day_runs: [],
  ...tables,
});

const rider = (id, extra = {}) => ({ id, team_id: "t1", talent_ceiling: 70, is_retired: false, is_academy: false, ...extra });

test("ren gruppering: kun egne ryttere på menneskehold uden række for nuværende hold", () => {
  const riders = [rider("a"), rider("b"), rider("c", { team_id: "ai" }), rider("d", { is_retired: true }), rider("e", { team_id: null })];
  const stored = [{ rider_id: "b", team_id: "t1" }, { rider_id: "a", team_id: "old" }];
  const byTeam = missingOwnRidersByTeam(riders, stored, ["t1"]);
  assert.deepEqual([...byTeam.keys()], ["t1"]);
  assert.deepEqual(byTeam.get("t1").map((r) => r.id), ["a"]);
});

test("købt rytter uden kig og uden datoer får sit skøn, akademitalent under grænsen venter", async () => {
  const sb = client({
    riders: [rider("bought"), rider("youth", { is_academy: true }), rider("youth5", { is_academy: true })],
    training_rider_ticks: [...ticks("youth", "t1", 2), ...ticks("youth5", "t1", 5)],
  });
  const result = await runPotentialEstimateMissingSweep({ supabase: sb, now: NOW });
  assert.equal(result.ran, true);
  const rows = sb.state[POTENTIAL_ESTIMATES_TABLE];
  assert.deepEqual(rows.map((row) => row.rider_id).sort(), ["bought", "youth5"]);
  assert.ok(rows.every((row) => row.write_reason === "backfill" && row.team_id === "t1"));
});

test("idempotent: anden kørsel skriver intet og rører ikke en gemt række", async () => {
  const sb = client({ riders: [rider("bought")] });
  await runPotentialEstimateMissingSweep({ supabase: sb, now: NOW });
  const first = JSON.stringify(sb.state[POTENTIAL_ESTIMATES_TABLE]);
  const again = await runPotentialEstimateMissingSweep({ supabase: sb, now: new Date("2026-11-26T11:00:00.000Z") });
  assert.equal(again.written, 0);
  assert.equal(JSON.stringify(sb.state[POTENTIAL_ESTIMATES_TABLE]), first);
});

test("slukket skrivekontakt: intet læses ud over kontakten, intet skrives", async () => {
  const sb = client({ flag: "off", riders: [rider("bought")] });
  const tables = [];
  const from = sb.from;
  sb.from = (table) => { tables.push(table); return from(table); };
  assert.deepEqual(await runPotentialEstimateMissingSweep({ supabase: sb, now: NOW }), { ran: false, skipped: "flag_off" });
  assert.deepEqual([...new Set(tables)], ["app_config"]);
});

test("#8810: prognosis_model2 slukket, manglende eller beta: kun kontakten læses, intet skrives", async () => {
  for (const model2 of ["off", "beta", null]) {
    const sb = client({ model2, riders: [rider("bought"), rider("youth5", { is_academy: true })], training_rider_ticks: ticks("youth5", "t1", 5) });
    const tables = [];
    const from = sb.from;
    sb.from = (table) => { tables.push(table); return from(table); };
    assert.deepEqual(await runPotentialEstimateMissingSweep({ supabase: sb, now: NOW }), { ran: false, skipped: "model2_off" }, String(model2));
    assert.deepEqual([...new Set(tables)], ["app_config"], String(model2));
    assert.deepEqual(sb.state[POTENTIAL_ESTIMATES_TABLE], [], String(model2));
  }
});

test("tick: et fejlende hold giver ét samlet Sentry-event og vælter ikke kørslen", async () => {
  const sb = client({ riders: [rider("bought")] });
  const from = sb.from;
  sb.from = (table) => {
    if (table === "team_staff") throw new Error("boom");
    return from(table);
  };
  const captured = [];
  const result = await runPotentialEstimateMissingTick({ supabase: sb, now: NOW, capture: (err) => captured.push(err.message) });
  assert.equal(result.failedTeams, 1);
  assert.equal(captured.length, 1);
  assert.match(captured[0], /potential-estimate-missing: 1 teams failed/);
});

test("læsningen: med Model 2 står eget akademitalent uden skøn i Læres, også efter grænsen", () => {
  const on = { learningUntilWritten: true };
  assert.deepEqual(buildPotentialView({ learningYouth: true, trainings: 2, ...on }), { hidden: true, reason: "learning", trainings: 2, trainingsNeeded: 5 });
  assert.deepEqual(buildPotentialView({ learningYouth: true, trainings: 9, ...on }), { hidden: true, reason: "learning", trainings: 5, trainingsNeeded: 5 });
  assert.deepEqual(buildPotentialView({ learningYouth: false, trainings: 9, ...on }), { hidden: true, reason: "unscouted" });
  // #8810: slukket er reglen som før #8604.
  assert.deepEqual(buildPotentialView({ learningYouth: true, trainings: 9 }), { hidden: true, reason: "unscouted" });
});
