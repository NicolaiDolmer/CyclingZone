// #7685: holdskifte-sweepet. Tallene i PARAMS er syntetiske testværdier, ikke
// kalibreringen (den er privat, hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { POTENTIAL_ESTIMATE_PARAMS_KEY, POTENTIAL_ESTIMATES_TABLE } from "./potentialEstimateWriter.js";
import { runPotentialEstimateTeamChangeSweep, runPotentialEstimateTeamChangeTick } from "./potentialEstimateTeamChangeSweep.js";
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

const NOW = new Date("2026-11-05T12:00:00.000Z");
const JUST_NOW = "2026-11-05T11:30:00.000Z";
const LONG_AGO = "2026-10-01T11:30:00.000Z";

const ticks = (riderId, teamId, n) => Array.from({ length: n }, (_, i) => ({
  rider_id: riderId, team_id: teamId, season_id: "s1", game_day: i + 1, tick_date: `2026-10-${String(i + 1).padStart(2, "0")}`,
}));

const rider = (over = {}) => ({ id: "r1", team_id: "t1", talent_ceiling: 70, is_retired: false, acquired_at: JUST_NOW, ...over });

const client = ({ flag = "on", params = PARAMS, ...tables } = {}) => createFakeSupabase({
  app_config: [{ key: "potential_estimate_writes", value: flag }],
  private_config: params ? [{ key: POTENTIAL_ESTIMATE_PARAMS_KEY, value: params }] : [],
  teams: [{ id: "t1", is_ai: false, is_bank: false }, { id: "t2", is_ai: false, is_bank: false }],
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

const run = (supabase) => runPotentialEstimateTeamChangeSweep({ supabase, now: NOW });
const estimates = (sb) => sb.state[POTENTIAL_ESTIMATES_TABLE];

const storedRow = (over = {}) => ({
  rider_id: "r1", team_id: "t1", value: 68, certainty: "unsure", uncertainty: 7, knowledge_key: "own0", ceiling_at_write: 70,
  params_version: "old", write_reason: "sunday", previous_value: null, previous_certainty: null, changed_at: null,
  computed_at: "2026-09-01T00:00:00.000Z", ...over,
});

test("flag slukket eller kalibrering mangler: intet skrives", async () => {
  const state = { riders: [rider()], scout_actions: [{ id: "a1", team_id: "t1", rider_id: "r1" }] };
  const off = client({ ...state, flag: "off" });
  assert.deepEqual(await run(off), { ran: false, skipped: "flag_off" });
  assert.equal(estimates(off).length, 0);
  const noParams = client({ ...state, params: null });
  assert.deepEqual(await run(noParams), { ran: false, skipped: "params_missing" });
});

test("det nye hold får sit eget skøn med den viden, det havde i forvejen", async () => {
  const sb = client({
    riders: [rider()],
    scout_actions: [{ id: "a1", team_id: "t1", rider_id: "r1" }, { id: "a2", team_id: "t1", rider_id: "r1" }],
    team_staff: [{ team_id: "t1", role: "scouting", status: "active", tier: 3 }],
  });
  assert.equal((await run(sb)).written, 1);
  assert.equal(estimates(sb)[0].team_id, "t1");
  assert.equal(estimates(sb)[0].write_reason, "team_change");
  assert.equal(estimates(sb)[0].knowledge_key, "s2t3");
});

test("et hold der intet ved om rytteren, får intet tal før grænsen", async () => {
  const sb = client({ riders: [rider()] });
  const result = await run(sb);
  assert.equal(result.written, 0);
  assert.equal(estimates(sb).length, 0);
});

test("rytter uden talent_ceiling, uden hold eller uden for vinduet springes over", async () => {
  const sb = client({
    riders: [rider({ talent_ceiling: null }), rider({ id: "r2", team_id: null }), rider({ id: "r3", acquired_at: LONG_AGO })],
    scout_actions: ["r1", "r2", "r3"].map((id) => ({ id: `a-${id}`, team_id: "t1", rider_id: id })),
  });
  assert.equal((await run(sb)).riders, 0);
  assert.equal(estimates(sb).length, 0);
});

test("AI-hold får intet skøn", async () => {
  const sb = client({
    teams: [{ id: "ai", is_ai: true, is_bank: false }],
    riders: [rider({ team_id: "ai" })],
    scout_actions: [{ id: "a1", team_id: "ai", rider_id: "r1" }],
  });
  await run(sb);
  assert.equal(estimates(sb).length, 0);
});

test("tilbage til tidligere hold: rækken opdateres, når loftet har flyttet sig", async () => {
  const sb = client({
    riders: [rider({ talent_ceiling: 76 })],
    training_rider_ticks: ticks("r1", "t1", 6),
    [POTENTIAL_ESTIMATES_TABLE]: [storedRow()],
  });
  assert.equal((await run(sb)).written, 1);
  assert.equal(estimates(sb).length, 1);
  assert.equal(estimates(sb)[0].write_reason, "team_change");
  assert.equal(estimates(sb)[0].ceiling_at_write, 76);
  assert.equal(estimates(sb)[0].knowledge_key, "own0");
});

test("tilbage til tidligere hold: uændret viden og loft står stille", async () => {
  const sb = client({
    riders: [rider()],
    training_rider_ticks: ticks("r1", "t1", 6),
    [POTENTIAL_ESTIMATES_TABLE]: [storedRow()],
  });
  const before = { ...estimates(sb)[0] };
  const result = await run(sb);
  assert.equal(result.written, 0);
  assert.equal(result.kept, 1);
  assert.deepEqual(estimates(sb)[0], before);
});

test("tilbage til tidligere hold: den gamle træning tæller, og viden falder aldrig", async () => {
  const sb = client({
    riders: [rider({ talent_ceiling: 76 })],
    training_rider_ticks: [...ticks("r1", "t1", 3), ...ticks("r1", "t2", 20)],
    [POTENTIAL_ESTIMATES_TABLE]: [storedRow({ knowledge_key: "own1", uncertainty: 4 })],
  });
  await run(sb);
  assert.equal(estimates(sb)[0].knowledge_key, "own1");
  assert.equal(Number(estimates(sb)[0].uncertainty), 4);
});

test("holdet rytteren forlod, beholder sin række urørt", async () => {
  const left = storedRow({ team_id: "t2" });
  const sb = client({
    riders: [rider()],
    scout_actions: [{ id: "a1", team_id: "t1", rider_id: "r1" }],
    [POTENTIAL_ESTIMATES_TABLE]: [left],
  });
  const before = { ...left };
  await run(sb);
  assert.deepEqual(estimates(sb).find((row) => row.team_id === "t2"), before);
  assert.equal(estimates(sb).length, 2);
});

test("idempotent: en ny kørsel i vinduet skriver intet", async () => {
  const sb = client({ riders: [rider()], scout_actions: [{ id: "a1", team_id: "t1", rider_id: "r1" }] });
  await run(sb);
  const before = { ...estimates(sb)[0] };
  const second = await runPotentialEstimateTeamChangeSweep({ supabase: sb, now: new Date("2026-11-05T13:00:00.000Z") });
  assert.equal(second.written, 0);
  assert.deepEqual(estimates(sb)[0], before);
});

test("ét hold der fejler, stopper ikke de andre, og tick'et samler fejlen til ét event", async () => {
  const sb = client({
    riders: [rider(), rider({ id: "r2", team_id: "t2" })],
    scout_actions: [{ id: "a1", team_id: "t1", rider_id: "r1" }, { id: "a2", team_id: "t2", rider_id: "r2" }],
  });
  const from = sb.from;
  sb.from = (table) => {
    const api = from(table);
    if (table !== POTENTIAL_ESTIMATES_TABLE) return api;
    return { ...api, upsert: (rows, opts) => (rows[0].team_id === "t1" ? { select: async () => ({ error: { message: "boom" } }) } : api.upsert(rows, opts)) };
  };
  const captured = [];
  const original = { error: console.error, log: console.log };
  console.error = () => {};
  console.log = () => {};
  try {
    const result = await runPotentialEstimateTeamChangeTick({ supabase: sb, now: NOW, capture: (err) => captured.push(err.message) });
    assert.equal(result.failedTeams, 1);
  } finally {
    console.error = original.error;
    console.log = original.log;
  }
  assert.deepEqual(estimates(sb).map((row) => row.team_id), ["t2"]);
  assert.equal(captured.length, 1);
});
