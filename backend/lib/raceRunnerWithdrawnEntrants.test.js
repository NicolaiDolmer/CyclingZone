// #4306: et afmeldt hold starter stadig løbet. loadEntrantsForRace filtrerede kun på
// division (#1846), ghost-eligibility (#1742) og skade (#3896), ikke på
// race_withdrawals. loadWithdrawnTeamIds kaldtes hidtil KUN fra fillMissingTeamEntries
// (den sene redning), så et afmeldt holds BEVAREDE committede entries blev aldrig
// fjernet, og holdet startede med en NULL-binding (den forudsætter bevidst at holdet
// heller ikke starter). Testes med en filter-aware mock, fordi raceRunner.test.js'
// egen makeSupabase ignorerer .in()/.eq() (samme begrundelse som
// raceRunnerWithdrawnBinding.test.js) og derfor ikke kan skelne "riders hentet for de
// rigtige id'er" fra "riders hentet ufiltreret".

import test from "node:test";
import assert from "node:assert/strict";
import { loadEntrantsForRace } from "./raceRunner.js";

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

const ABIL = {
  sprint: 60, climbing: 60, time_trial: 60, one_day: 60, gc: 60,
  hills: 60, cobbles: 60, aggression: 60,
};

function canned({ withdrawn }) {
  return {
    race_entries: [
      { race_id: "race-w", rider_id: "r-withdrawn", team_id: "T-withdrawn" },
      { race_id: "race-w", rider_id: "r-active", team_id: "T-active" },
    ],
    riders: [
      { id: "r-withdrawn", team_id: "T-withdrawn", is_academy: false, is_retired: false, firstname: "A", lastname: "A", is_u25: false },
      { id: "r-active", team_id: "T-active", is_academy: false, is_retired: false, firstname: "B", lastname: "B", is_u25: false },
    ],
    rider_derived_abilities: [
      { rider_id: "r-withdrawn", ...ABIL },
      { rider_id: "r-active", ...ABIL },
    ],
    rider_condition: [],
    teams: [
      { id: "T-withdrawn", name: "Withdrawn CC" },
      { id: "T-active", name: "Active CC" },
    ],
    race_withdrawals: withdrawn ? [{ race_id: "race-w", team_id: "T-withdrawn" }] : [],
  };
}

const RACE = { id: "race-w", season_id: null };

test("loadEntrantsForRace: afmeldt holds BEVAREDE entries ekskluderes fra startfeltet (#4306)", async () => {
  const supabase = makeFilterAwareSupabase(canned({ withdrawn: true }));
  const entrants = await loadEntrantsForRace({ supabase, race: RACE, allowAutofill: false });
  const ids = entrants.map((e) => e.rider_id);
  assert.ok(!ids.includes("r-withdrawn"), "afmeldt holds bevarede entry må ikke stå i startfeltet");
  assert.ok(ids.includes("r-active"), "hold der ikke har afmeldt sig skal stadig med");
});

test("loadEntrantsForRace: uden afmelding starter begge hold (kontrol)", async () => {
  const supabase = makeFilterAwareSupabase(canned({ withdrawn: false }));
  const entrants = await loadEntrantsForRace({ supabase, race: RACE, allowAutofill: false });
  const ids = entrants.map((e) => e.rider_id).sort();
  assert.deepEqual(ids, ["r-active", "r-withdrawn"]);
});

// #4295-koordinering: filteret skal ligge FØR autopick/minimum-gulv, så et afmeldt
// holds egne bevarede entries ikke kan "reddes" tilbage i feltet af den sene redning.
// fillMissingTeamEntries ekskluderer selv withdrawnTeams fra autopick-kandidaterne
// (raceRunner.js:829), testen her dækker at loadEntrantsForRace IKKE lægger holdets
// egne committede entries oven i det bagefter.
test("loadEntrantsForRace: afmeldt hold får IKKE sine bevarede entries tilbage via autofill", async () => {
  const supabase = makeFilterAwareSupabase({
    ...canned({ withdrawn: true }),
    teams: [
      { id: "T-withdrawn", name: "Withdrawn CC", is_test_account: false, is_frozen: false },
      { id: "T-active", name: "Active CC", is_test_account: false, is_frozen: false },
    ],
  });
  const entrants = await loadEntrantsForRace({
    supabase, race: RACE, stages: [{ stage_number: 1, profile_type: "hilly", demand_vector: { hilly: 1 } }],
    allowAutofill: true, persist: false,
  });
  const teamIds = new Set(entrants.map((e) => e.team_id));
  assert.ok(!teamIds.has("T-withdrawn"), "afmeldt hold må hverken have bevarede eller auto-fyldte entries");
});
