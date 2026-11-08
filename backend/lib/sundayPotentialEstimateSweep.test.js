// #7685: søndagskørslen af gemte potentiale-skøn. Tallene i PARAMS er syntetiske
// testværdier, ikke kalibreringen (den er privat, hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { POTENTIAL_ESTIMATE_PARAMS_KEY, POTENTIAL_ESTIMATES_TABLE } from "./potentialEstimateWriter.js";
import { runSundayPotentialEstimateSweep, runSundayPotentialEstimateTick } from "./sundayPotentialEstimateSweep.js";
import { POTENTIAL_ESTIMATE_SUNDAY_WALL_CLOCK } from "./cronMonitorRegistry.js";
import { SUNDAY_VALUE_FROM_HOUR } from "./economyConstants.js";
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

const SUNDAY = new Date("2026-11-08T13:30:00.000Z"); // 14:30 dansk tid
const LATER = new Date("2026-11-08T15:00:00.000Z");

const ticks = (riderId, teamId, n) => Array.from({ length: n }, (_, i) => ({
  rider_id: riderId, team_id: teamId, season_id: "s1", game_day: i + 1, tick_date: `2026-10-${String(i + 1).padStart(2, "0")}`,
}));

const client = ({ flag = "on", params = PARAMS, ...tables } = {}) => createFakeSupabase({
  app_config: [{ key: "potential_estimate_writes", value: flag }],
  private_config: params ? [{ key: POTENTIAL_ESTIMATE_PARAMS_KEY, value: params }] : [],
  teams: [{ id: "t1", is_ai: false, is_bank: false }],
  riders: [],
  [POTENTIAL_ESTIMATES_TABLE]: [],
  team_staff: [],
  team_facilities: [],
  scout_actions: [],
  training_rider_ticks: [],
  rider_training_scores: [],
  training_day_runs: [],
  ...tables,
});

const run = (supabase, now = SUNDAY) => runSundayPotentialEstimateSweep({ supabase, now, state: { cleanRunDate: null } });
const estimates = (sb) => sb.state[POTENTIAL_ESTIMATES_TABLE];

test("selv-gated: kun søndag og fra værdiernes time", async () => {
  const sb = client();
  assert.equal((await run(sb, new Date("2026-11-09T13:30:00.000Z"))).skipped, "not_sunday");
  assert.equal((await run(sb, new Date("2026-11-08T08:00:00.000Z"))).skipped, "before_window");
  assert.equal((await run(sb, SUNDAY)).ran, true);
});

test("skemaet ligger i jobbets vindue", () => {
  assert.equal(POTENTIAL_ESTIMATE_SUNDAY_WALL_CLOCK.hour, SUNDAY_VALUE_FROM_HOUR);
  assert.deepEqual(POTENTIAL_ESTIMATE_SUNDAY_WALL_CLOCK.weekdays, ["sun"]);
});

test("flag slukket eller kalibrering mangler: intet læses, intet skrives", async () => {
  const riders = [{ id: "r1", team_id: "t1", talent_ceiling: 70, is_retired: false }];
  const off = client({ flag: "off", riders, training_rider_ticks: ticks("r1", "t1", 6) });
  assert.equal((await run(off)).skipped, "flag_off");
  assert.equal(estimates(off).length, 0);
  const noParams = client({ params: null, riders, training_rider_ticks: ticks("r1", "t1", 6) });
  assert.equal((await run(noParams)).skipped, "params_missing");
  assert.equal(estimates(noParams).length, 0);
});

test("i dag: alle ryttere har talent_ceiling NULL, så intet skrives", async () => {
  const sb = client({
    riders: [{ id: "r1", team_id: "t1", talent_ceiling: null, is_retired: false }, { id: "r2", team_id: "t2", talent_ceiling: null, is_retired: false }],
    training_rider_ticks: ticks("r1", "t1", 25),
    scout_actions: [{ id: "a1", team_id: "t1", rider_id: "r2" }],
  });
  const result = await run(sb);
  assert.equal(result.written, 0);
  assert.equal(estimates(sb).length, 0);
});

test("egne ryttere: første skøn ved grænsen, ingen under den", async () => {
  const sb = client({
    riders: [{ id: "r1", team_id: "t1", talent_ceiling: 70, is_retired: false }, { id: "r2", team_id: "t1", talent_ceiling: 60, is_retired: false }],
    training_rider_ticks: [...ticks("r1", "t1", 5), ...ticks("r2", "t1", 4)],
  });
  assert.equal((await run(sb)).written, 1);
  assert.deepEqual(estimates(sb).map((r) => [r.rider_id, r.write_reason]), [["r1", "sunday"]]);
});

test("datoer tælles, ikke løbsdage, og kun på dette hold", async () => {
  const sameDate = ticks("r1", "t1", 8).map((tick) => ({ ...tick, tick_date: "2026-10-01" }));
  const sb = client({
    riders: [{ id: "r1", team_id: "t1", talent_ceiling: 70, is_retired: false }],
    training_rider_ticks: [...sameDate, ...ticks("r1", "t9", 8)],
  });
  assert.equal((await run(sb)).written, 0);
});

// Rækker fra før dato-afregningen: rider_training_scores (løbsdags-stien) og
// training_day_runs (kalenderdags-stien). 3 + 2 datoer er grænsen på 5.
const legacyScores = (riderId, teamId, n) => Array.from({ length: n }, (_, i) => ({
  id: `${riderId}-${teamId}-${i}`, rider_id: riderId, team_id: teamId, tick_date: `2026-09-${String(i + 15).padStart(2, "0")}`,
}));
const legacyRun = (teamId, tickDate, riders, gameDay = null) => ({ team_id: teamId, tick_date: tickDate, game_day: gameDay, report: { riders } });
const trained = (riderId) => ({ rider_id: riderId, status: "normal" });

test("træning fra de gamle stier tæller med", async () => {
  const sb = client({
    riders: [{ id: "r1", team_id: "t1", talent_ceiling: 70, is_retired: false }],
    rider_training_scores: legacyScores("r1", "t1", 3),
    training_day_runs: [legacyRun("t1", "2026-07-01", [trained("r1")]), legacyRun("t1", "2026-07-02", [trained("r1")])],
  });
  assert.equal((await run(sb)).written, 1);
});

// De to næste står med 4 sikre datoer, så én ekstra dato fra et lækket filter giver et skøn.
test("samme dato i flere kilder tæller én gang", async () => {
  const sb = client({
    riders: [{ id: "r1", team_id: "t1", talent_ceiling: 70, is_retired: false }],
    training_rider_ticks: ticks("r1", "t1", 4),
    rider_training_scores: [{ id: "a", rider_id: "r1", team_id: "t1", tick_date: "2026-10-01" }],
    training_day_runs: [legacyRun("t1", "2026-10-02", [trained("r1")])],
  });
  assert.equal((await run(sb)).written, 0);
});

test("gammel træning på et andet hold, hviledage og uafsluttede rapporter tæller ikke", async () => {
  const sb = client({
    riders: [{ id: "r1", team_id: "t1", talent_ceiling: 70, is_retired: false }],
    training_rider_ticks: ticks("r1", "t1", 4),
    rider_training_scores: legacyScores("r1", "t9", 8),
    training_day_runs: [
      legacyRun("t9", "2026-07-01", [trained("r1")]),
      legacyRun("t1", "2026-07-02", [{ rider_id: "r1", status: "rest", injured: true }]),
      legacyRun("t1", "2026-07-03", [trained("r2")]),
      { team_id: "t1", tick_date: "2026-07-04", game_day: null, report: { pending: true, token: "x" } },
      legacyRun("t1", "2026-10-20", [trained("r1")], 7),
    ],
  });
  assert.equal((await run(sb)).written, 0);
});

test("fremmed rytter: kun når loftet har flyttet sig", async () => {
  const state = {
    riders: [{ id: "r1", team_id: "t2", talent_ceiling: 70, is_retired: false }],
    scout_actions: [{ id: "a1", team_id: "t1", rider_id: "r1" }],
    team_staff: [{ team_id: "t1", role: "scouting", status: "active", tier: 3 }],
  };
  const sb = client(state);
  await run(sb);
  assert.equal(estimates(sb)[0].write_reason, "backfill");
  const before = { ...estimates(sb)[0] };

  sb.state.team_staff[0].tier = 5; // en bedre scout er ikke ny viden om rytteren
  assert.equal((await run(sb, LATER)).written, 0);
  assert.deepEqual(estimates(sb)[0], before);

  sb.state.riders[0].talent_ceiling = 76;
  assert.equal((await run(sb, LATER)).written, 1);
  assert.equal(estimates(sb)[0].write_reason, "sunday");
  assert.equal(estimates(sb)[0].ceiling_at_write, 76);
  assert.equal(estimates(sb)[0].knowledge_key, "s1t3");
});

test("idempotent: en ny kørsel samme søndag skriver intet", async () => {
  const sb = client({
    riders: [{ id: "r1", team_id: "t1", talent_ceiling: 70, is_retired: false }],
    training_rider_ticks: ticks("r1", "t1", 12),
  });
  await run(sb);
  const before = { ...estimates(sb)[0] };
  const second = await run(sb, LATER);
  assert.equal(second.written, 0);
  assert.equal(second.kept, 1);
  assert.deepEqual(estimates(sb)[0], before);
});

test("en fejlfri kørsel læser ikke igen resten af søndagen; en ny søndag gør", async () => {
  const sb = client();
  const state = { cleanRunDate: null };
  assert.equal((await runSundayPotentialEstimateSweep({ supabase: sb, now: SUNDAY, state })).ran, true);
  assert.equal((await runSundayPotentialEstimateSweep({ supabase: sb, now: LATER, state })).skipped, "already_ran");
  assert.equal((await runSundayPotentialEstimateSweep({ supabase: sb, now: new Date("2026-11-15T13:30:00.000Z"), state })).ran, true);
});

test("AI-hold, banken og pensionerede ryttere får intet skøn", async () => {
  const sb = client({
    teams: [{ id: "t1", is_ai: false, is_bank: false }, { id: "ai", is_ai: true, is_bank: false }, { id: "bank", is_ai: false, is_bank: true }],
    riders: [
      { id: "r1", team_id: "ai", talent_ceiling: 70, is_retired: false },
      { id: "r2", team_id: "bank", talent_ceiling: 70, is_retired: false },
      { id: "r3", team_id: "t1", talent_ceiling: 70, is_retired: true },
    ],
    training_rider_ticks: [...ticks("r1", "ai", 6), ...ticks("r2", "bank", 6), ...ticks("r3", "t1", 6)],
  });
  await run(sb);
  assert.equal(estimates(sb).length, 0);
});

function failingFor(sb, teamId) {
  const from = sb.from;
  sb.from = (table) => {
    const api = from(table);
    if (table !== POTENTIAL_ESTIMATES_TABLE) return api;
    return { ...api, upsert: (rows, opts) => (rows[0].team_id === teamId ? { select: async () => ({ error: { message: "boom" } }) } : api.upsert(rows, opts)) };
  };
  return () => { sb.from = from; };
}

test("ét hold der fejler, stopper ikke de andre, og næste time tager det igen", async () => {
  const sb = client({
    teams: [{ id: "t1", is_ai: false, is_bank: false }, { id: "t2", is_ai: false, is_bank: false }],
    riders: [{ id: "r1", team_id: "t1", talent_ceiling: 70, is_retired: false }, { id: "r2", team_id: "t2", talent_ceiling: 70, is_retired: false }],
    training_rider_ticks: [...ticks("r1", "t1", 6), ...ticks("r2", "t2", 6)],
  });
  const state = { cleanRunDate: null };
  const restore = failingFor(sb, "t1");
  const original = console.error;
  console.error = () => {};
  let first;
  try {
    first = await runSundayPotentialEstimateSweep({ supabase: sb, now: SUNDAY, state });
  } finally {
    console.error = original;
    restore();
  }
  assert.equal(first.failedTeams, 1);
  assert.deepEqual(estimates(sb).map((r) => r.team_id), ["t2"]);
  assert.equal(state.cleanRunDate, null);

  const second = await runSundayPotentialEstimateSweep({ supabase: sb, now: LATER, state });
  assert.equal(second.failedTeams, 0);
  assert.deepEqual(estimates(sb).map((r) => r.team_id).sort(), ["t1", "t2"]);
});

test("tick: tændt flag uden kalibrering er en alarm, slukket flag er ikke", async () => {
  const captured = [];
  const capture = (err) => captured.push(err.message);
  await runSundayPotentialEstimateTick({ supabase: client({ flag: "off" }), now: new Date("2026-11-22T13:30:00.000Z"), capture });
  assert.deepEqual(captured, []);
  await runSundayPotentialEstimateTick({ supabase: client({ params: null }), now: new Date("2026-11-22T13:30:00.000Z"), capture });
  assert.equal(captured.length, 1);
  assert.match(captured[0], /calibration/);
});
