import test from "node:test";
import assert from "node:assert/strict";
import { findAllDoubleBookedPairs } from "./audit-4700-double-booked-riders.js";

// Samme minimale thenable-mock-form som riderDoubleBookingWatch.test.js (den vagt
// denne script er en detaljeret dump-udgave af) — genbrugt her fordi mock-helperen
// ikke er eksporteret derfra.
function makeSupabase(state) {
  function builder(table) {
    const filters = [];
    const api = {
      select() { return api; },
      eq(col, val) { filters.push([col, val]); return api; },
      in(col, vals) { filters.push([col, vals]); return api; },
      order() { return api; },
      range() { return api; },
      maybeSingle() {
        const rows = api.__rows();
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      __rows() {
        let rows = [...(state[table] || [])];
        for (const [col, val] of filters) {
          rows = Array.isArray(val) ? rows.filter((r) => val.includes(r[col])) : rows.filter((r) => r[col] === val);
        }
        return rows;
      },
      then(resolve) { return resolve({ data: api.__rows(), error: null }); },
    };
    return api;
  }
  return { from: (t) => builder(t) };
}

function seedState({ entries, riders = null, withdrawals = [] }) {
  return {
    seasons: [{ id: "s3", number: 3, status: "active" }],
    races: [
      { id: "A", season_id: "s3", name: "Tour des Hauts Plateaux", stages_completed: 0, status: "scheduled" },
      { id: "B", season_id: "s3", name: "Tour de Malaisie", stages_completed: 0, status: "scheduled" },
    ],
    race_stage_schedule: [
      { race_id: "A", stage_number: 1, scheduled_at: "2026-07-27T16:20:00Z", game_day: 0 },
      { race_id: "A", stage_number: 2, scheduled_at: "2026-07-28T16:20:00Z", game_day: 1 },
      { race_id: "B", stage_number: 1, scheduled_at: "2026-07-27T17:00:00Z", game_day: 0 },
      { race_id: "B", stage_number: 2, scheduled_at: "2026-07-28T17:00:00Z", game_day: 1 },
    ],
    race_withdrawals: withdrawals,
    race_entries: entries,
    riders: riders ?? [...new Set(entries.map((e) => e.rider_id))].map((id) => {
      const teamId = entries.find((e) => e.rider_id === id).team_id;
      return { id, team_id: teamId, is_academy: false, is_retired: false, firstname: "R", lastname: id };
    }),
  };
}

test("findAllDoubleBookedPairs: ingen aktiv sæson → tom liste, ingen fejl", async () => {
  const out = await findAllDoubleBookedPairs(makeSupabase({ seasons: [] }));
  assert.equal(out.seasonId, null);
  assert.deepEqual(out.pairs, []);
});

test("findAllDoubleBookedPairs: overlappende par rapporteres MED created_at/is_auto_filled fra begge entries", async () => {
  const entries = [
    { race_id: "A", team_id: "t1", rider_id: "r1", is_auto_filled: false, created_at: "2026-08-27T06:38:14.220Z" },
    { race_id: "B", team_id: "t1", rider_id: "r1", is_auto_filled: true, created_at: "2026-08-30T09:35:18.611Z" },
  ];
  const out = await findAllDoubleBookedPairs(makeSupabase(seedState({ entries })));
  assert.equal(out.pairs.live.length, 1);
  assert.equal(out.pairs.actionable.length, 1);
  const [pair] = out.pairs.live;
  assert.equal(pair.rider_id, "r1");
  assert.equal(pair.race_a.is_auto_filled, false);
  assert.equal(pair.race_a.created_at, "2026-08-27T06:38:14.220Z");
  assert.equal(pair.race_b.is_auto_filled, true);
  assert.equal(pair.race_b.created_at, "2026-08-30T09:35:18.611Z");
});

// Regression #4700: en afmeldt (race,team) binder ikke (#1823) — samme filter som vagten.
test("findAllDoubleBookedPairs: afmeldt løb udelukker parret", async () => {
  const entries = [
    { race_id: "A", team_id: "t1", rider_id: "r1", is_auto_filled: false, created_at: "2026-08-27T06:38:14.220Z" },
    { race_id: "B", team_id: "t1", rider_id: "r1", is_auto_filled: false, created_at: "2026-08-30T09:35:18.611Z" },
  ];
  const out = await findAllDoubleBookedPairs(makeSupabase(seedState({
    entries, withdrawals: [{ race_id: "B", team_id: "t1" }],
  })));
  assert.deepEqual(out.pairs.live, []);
});

// Regression #4700/#3185: en rytter der er solgt SIDEN entry'en blev skrevet (entry.team_id
// ≠ rider.team_id nu) er en ghost — tælles ikke som et levende par.
test("findAllDoubleBookedPairs: ghost-entry (rytter solgt siden) udelukker parret", async () => {
  const entries = [
    { race_id: "A", team_id: "t1", rider_id: "r1", is_auto_filled: false, created_at: "2026-08-27T06:38:14.220Z" },
    { race_id: "B", team_id: "t1", rider_id: "r1", is_auto_filled: false, created_at: "2026-08-30T09:35:18.611Z" },
  ];
  const riders = [{ id: "r1", team_id: "t2", is_academy: false, is_retired: false, firstname: "R", lastname: "1" }];
  const out = await findAllDoubleBookedPairs(makeSupabase(seedState({ entries, riders })));
  assert.deepEqual(out.pairs.live, []);
  assert.equal(out.ghostExcluded, 2);
});
