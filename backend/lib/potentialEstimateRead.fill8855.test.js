// #8855 (ejer 27/11): en egen rytter viser et potentiale-skøn fra dag ét. Hele kæden med
// den rigtige writer: læsningen finder en egen rytter uden gemt skøn, writeren skriver
// dag ét-skønnet (ét kig med holdets egen scout), og svaret viser tallet med det samme.
// Tallene her er syntetiske testværdier, ikke kalibreringen (privat, hard rule 17).
import test from "node:test";
import assert from "node:assert/strict";

import { buildEstimatesFromViews, resetFillRetriesForTests } from "./potentialEstimateRead.js";
import { POTENTIAL_ESTIMATE_PARAMS_KEY, POTENTIAL_ESTIMATES_TABLE } from "./potentialEstimateWriter.js";
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

const CLOCK = new Date("2026-11-27T15:00:00.000Z"); // regel 16: fast ur

const client = ({ writes = "on", ...tables } = {}) => createFakeSupabase({
  app_config: [{ key: "potential_estimate_writes", value: writes }, { key: "development_xp_model", value: "off" }],
  private_config: [{ key: POTENTIAL_ESTIMATE_PARAMS_KEY, value: PARAMS }],
  teams: [{ id: "t1", is_ai: false, is_bank: false }, { id: "t2", is_ai: false, is_bank: false }],
  riders: [
    // Lige købt senior og nyt akademitalent: ingen træning på holdet, ingen kig.
    { id: "bought", team_id: "t1", talent_ceiling: 70, is_retired: false, is_academy: false, best_role_rating: 50 },
    { id: "youth", team_id: "t1", talent_ceiling: 80, is_retired: false, is_academy: true, best_role_rating: 20 },
    { id: "rival", team_id: "t2", talent_ceiling: 75, is_retired: false, is_academy: false, best_role_rating: 55 },
  ],
  rider_derived_abilities: [],
  [POTENTIAL_ESTIMATES_TABLE]: [],
  scout_actions: [],
  team_staff: [{ id: "st1", team_id: "t1", role: "scouting", tier: 3, status: "active" }],
  team_facilities: [],
  training_rider_ticks: [],
  rider_training_scores: [],
  training_day_runs: [],
  seasons: [{ id: "s1", number: 1, status: "active" }],
  ...tables,
});

test("#8855: lige købt senior og nyt akademitalent viser et skøn ved første visning", async () => {
  resetFillRetriesForTests();
  const sb = client();
  const out = await buildEstimatesFromViews(sb, { teamId: "t1", riderIds: ["bought", "youth", "rival"], clock: CLOCK });
  for (const id of ["bought", "youth"]) {
    assert.equal(out[id].potentialView.hidden, false, `${id} har et skøn fra dag ét`);
    assert.ok(Number.isInteger(out[id].potentialView.value));
  }
  assert.deepEqual(out.rival.potentialView, { hidden: true, reason: "unscouted" }, "andres ryttere kun via scouting");
  const rows = sb.state[POTENTIAL_ESTIMATES_TABLE];
  assert.deepEqual(rows.map((row) => [row.rider_id, row.team_id, row.write_reason, row.knowledge_key]).sort(), [
    ["bought", "t1", "backfill", "s1t3"],
    ["youth", "t1", "backfill", "s1t3"],
  ], "dag ét = ét kig med holdets egen scout");
  // Svaret bærer aldrig usikkerheden, vidensniveauet eller loftet (H4).
  assert.doesNotMatch(JSON.stringify(out), /uncertainty|knowledge_key|ceiling_at_write|talent_ceiling/);
  resetFillRetriesForTests();
});

test("#8855: næste visning læser det gemte skøn og skriver intet nyt", async () => {
  resetFillRetriesForTests();
  const sb = client();
  const first = await buildEstimatesFromViews(sb, { teamId: "t1", riderIds: ["bought"], clock: CLOCK });
  const snapshot = JSON.stringify(sb.state[POTENTIAL_ESTIMATES_TABLE]);
  const again = await buildEstimatesFromViews(sb, { teamId: "t1", riderIds: ["bought"], clock: new Date(CLOCK.getTime() + 60_000) });
  assert.deepEqual(again.bought.potentialView, first.bought.potentialView);
  assert.equal(JSON.stringify(sb.state[POTENTIAL_ESTIMATES_TABLE]), snapshot);
  resetFillRetriesForTests();
});

test("#8855: slukket skrivning: intet skrives, og egen rytter står som uscoutet", async () => {
  resetFillRetriesForTests();
  const sb = client({ writes: "off" });
  const out = await buildEstimatesFromViews(sb, { teamId: "t1", riderIds: ["bought"], clock: CLOCK });
  assert.deepEqual(out.bought.potentialView, { hidden: true, reason: "unscouted" });
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE].length, 0);
  resetFillRetriesForTests();
});
