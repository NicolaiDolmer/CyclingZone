// #4283 — Rod A-paritet i runtime-autofyldet: et holds AFMELDTE løb binder ikke.
// loadTeamBindingContext (PUT /selection-stien) har filtreret withdrawn siden #1823;
// loadFieldBindingContext (fillMissingTeamEntries, race-start-autofyldet) gjorde ikke,
// så entries fra et afmeldt etapeløb phantom-bandt rytterne og gav et unødigt tyndt
// startfelt i overlappende løb. Testes ADFÆRDSMÆSSIGT gennem fillMissingTeamEntries
// med en filter-aware mock (makeSupabase i raceRunner.test.js ignorerer filtre og kan
// derfor ikke skelne this-/others-queries på samme tabel).

import test from "node:test";
import assert from "node:assert/strict";
import { fillMissingTeamEntries } from "./raceRunner.js";

// Filter-aware mock: eq/in/neq opsamles som prædikater og evalueres ved then/range.
// or/gte/is/order er no-ops (or bruges kun på teams-testkonto-filteret; gte på
// rider_condition, som er tom her).
function makeFilterAwareSupabase(canned = {}) {
  function from(table) {
    const preds = [];
    const b = {
      select() { return b; },
      order() { return b; },
      or() { return b; },
      is() { return b; },
      gte() { return b; },
      eq(col, val) { preds.push((r) => r[col] === val); return b; },
      neq(col, val) { preds.push((r) => r[col] !== val); return b; },
      in(col, vals) { preds.push((r) => vals.includes(r[col])); return b; },
      insert() { return Promise.resolve({ error: null }); },
      maybeSingle() {
        const rows = (canned[table] || []).filter((r) => preds.every((p) => p(r)));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      range(a, z) {
        const rows = (canned[table] || []).filter((r) => preds.every((p) => p(r)));
        return Promise.resolve({ data: rows.slice(a, z + 1), error: null });
      },
      then(resolve, reject) {
        const rows = (canned[table] || []).filter((r) => preds.every((p) => p(r)));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from, rpc: () => Promise.resolve({ error: null }) };
}

// #4295: 8 ryttere, så holdet kan nå gulvet (6) også når r1+r2 er bundet væk.
const RIDER_IDS = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"];

const ABIL = {
  sprint: 60, climbing: 60, time_trial: 60, one_day: 60, gc: 60,
  hills: 60, cobbles: 60, aggression: 60,
};

// Dette løb: endagsløb på game_day 5. Det andet løb (race-o): etapeløb med spænd 3..7 —
// overlapper game_day 5, så dets entries binder r1+r2 hvis løbet IKKE er afmeldt.
function canned({ withdrawn }) {
  return {
    teams: [{ id: "T1", is_test_account: false, is_frozen: false, league_division_id: 9 }],
    // #4295: truppen er 8 (ikke 3). Gulvet kræver 6 for at et hold stiller op, så en
    // 3-mands-trup ville aldrig give rækker og testen ville blive grøn af den forkerte
    // grund. r1+r2 er stadig de eneste bundne — det er dem testen måler.
    riders: RIDER_IDS.map((id) => ({ id, team_id: "T1", base_value: 100, is_academy: false, is_retired: false })),
    rider_derived_abilities: RIDER_IDS.map((id) => ({ rider_id: id, ...ABIL })),
    rider_condition: [],
    race_entries: [
      { race_id: "race-o", team_id: "T1", rider_id: "r1" },
      { race_id: "race-o", team_id: "T1", rider_id: "r2" },
    ],
    race_stage_schedule: [
      { race_id: "race-x", stage_number: 1, scheduled_at: "2026-09-01T09:00:00Z", game_day: 5 },
      { race_id: "race-o", stage_number: 1, scheduled_at: "2026-08-30T09:00:00Z", game_day: 3 },
      { race_id: "race-o", stage_number: 2, scheduled_at: "2026-09-03T09:00:00Z", game_day: 7 },
    ],
    races: [
      { id: "race-x", season_id: "s3" },
      { id: "race-o", season_id: "s3" },
    ],
    race_withdrawals: withdrawn ? [{ race_id: "race-o", team_id: "T1" }] : [],
  };
}

const RACE_X = {
  id: "race-x", season_id: "s3", race_type: "single", stages: 1, league_division_id: 9,
};
const STAGES_1 = [{ stage_number: 1, profile_type: "hilly", demand_vector: { hilly: 1 } }];

test("fillMissingTeamEntries: entries i et AFMELDT overlappende løb binder ikke — rytterne kan autofyldes (#4283)", async () => {
  const supabase = makeFilterAwareSupabase(canned({ withdrawn: true }));
  const rows = await fillMissingTeamEntries({
    supabase, race: RACE_X, stages: STAGES_1, existingEntries: [], persist: false,
  });
  const ids = rows.map((r) => r.rider_id).sort();
  assert.deepEqual(ids, [...RIDER_IDS].sort(), "hele truppen er fri når race-o er afmeldt");
});

test("fillMissingTeamEntries: samme entries UDEN afmelding binder stadig (kontrol — #1845 uændret)", async () => {
  const supabase = makeFilterAwareSupabase(canned({ withdrawn: false }));
  const rows = await fillMissingTeamEntries({
    supabase, race: RACE_X, stages: STAGES_1, existingEntries: [], persist: false,
  });
  const ids = rows.map((r) => r.rider_id).sort();
  assert.deepEqual(ids, RIDER_IDS.filter((id) => id !== "r1" && id !== "r2").sort(),
    "r1+r2 er bundet af race-o's spænd (game_day 3..7 dækker 5)");
});
