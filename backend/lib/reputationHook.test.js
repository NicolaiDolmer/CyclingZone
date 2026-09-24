// #5537 (S9, spec 2026-09-15 C3): live-krogen giver kun omdømme for SENIORløb.
//
// Efter A2 (#5517) afvikles U23-/juniorløb gennem samme finalisering som
// seniorløbene. Omdømme-motoren har ingen trup-dimension, så et ungdomsløb må
// hverken skrive hændelser eller opdatere rytternes omdømme. Kontrollen er et
// seniorløb gennem præcis samme mock.

import test from "node:test";
import assert from "node:assert/strict";

import { runReputationForFinalization, runReputationDetectionSafe, isSeniorRaceForReputation } from "./reputationHook.js";

const stageRace = (extra = {}) => ({
  id: "race-gt", season_id: "s1", race_type: "stage_race", race_class: "TourFrance", stages: 21, ...extra,
});

const STAGE_WIN_ROWS = [{ rider_id: "r1", team_id: "t1", stage_number: 5, result_type: "stage", rank: 1 }];

// Mock med de tabeller krogen rører. `raceLookup` styrer svaret på races-opslaget
// (`.select("squad").eq("id", …).maybeSingle()`); hvert kald registreres.
function makeSupabase({ raceLookup = { data: { squad: "senior" }, error: null } } = {}) {
  const state = { tables: [], inserted: [], riderUpdates: 0, raceLookups: [] };
  return {
    state,
    from(table) {
      state.tables.push(table);
      if (table === "races") {
        return {
          select: (columns) => ({
            eq: (col, val) => ({
              maybeSingle: async () => {
                state.raceLookups.push({ columns, col, val });
                return raceLookup;
              },
            }),
          }),
        };
      }
      if (table === "rider_reputation_events") {
        return {
          insert: async (rows) => { state.inserted.push(...(Array.isArray(rows) ? rows : [rows])); return { error: null }; },
          select: () => ({
            in: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }),
          }),
        };
      }
      if (table === "seasons") {
        return { select: () => ({ order: () => ({ range: async () => ({ data: [{ id: "s1", number: 3 }], error: null }) }) }) };
      }
      if (table === "riders") {
        return {
          select: () => ({ in: () => ({ order: () => ({ range: async () => ({ data: [{ id: "r1", popularity: 10 }], error: null }) }) }) }),
          update: () => ({ eq: async () => { state.riderUpdates += 1; return { error: null }; } }),
        };
      }
      throw new Error(`uventet tabel ${table}`);
    },
  };
}

const run = (supabase, race, extra = {}) => runReputationForFinalization({
  supabase, race, resultRows: STAGE_WIN_ROWS, stageNumbers: [5], seasonNumber: 3, stage: "shadow", ...extra,
});

test("#5537 ungdomsløb (squad på race-objektet) giver intet omdømme og intet opslag", async () => {
  for (const squad of ["u23", "junior"]) {
    const supabase = makeSupabase();
    const stats = await run(supabase, stageRace({ squad }));

    assert.equal(stats.skipped, "youth_race", squad);
    assert.equal(stats.events, 0);
    assert.equal(stats.inserted, 0);
    assert.equal(stats.ridersUpdated, 0);
    assert.deepEqual(supabase.state.inserted, []);
    assert.equal(supabase.state.riderUpdates, 0);
    assert.deepEqual(supabase.state.raceLookups, [], "feltet er med — intet opslag");
  }
});

test("#5537 ungdomsløb (squad slået op i races) giver intet omdømme", async () => {
  const supabase = makeSupabase({ raceLookup: { data: { squad: "u23" }, error: null } });

  const stats = await run(supabase, stageRace());

  assert.equal(stats.skipped, "youth_race");
  assert.deepEqual(supabase.state.inserted, []);
  assert.equal(supabase.state.riderUpdates, 0);
  assert.deepEqual(supabase.state.raceLookups, [{ columns: "squad", col: "id", val: "race-gt" }]);
});

test("#5537 kontrol: seniorløb giver omdømme, både med feltet og via opslag", async () => {
  const withField = makeSupabase();
  const a = await run(withField, stageRace({ squad: "senior" }));
  assert.equal(a.events, 1);
  assert.equal(withField.state.inserted.length, 1);
  assert.equal(withField.state.inserted[0].dedupe_key, "rider:r1:race:race-gt:stage:5:stage_win");
  assert.equal(a.skipped, undefined);
  assert.deepEqual(withField.state.raceLookups, []);

  const viaLookup = makeSupabase();
  const b = await run(viaLookup, stageRace());
  assert.equal(b.events, 1);
  assert.equal(viaLookup.state.inserted.length, 1);
  assert.equal(b.ridersUpdated, 1);
  assert.equal(viaLookup.state.raceLookups.length, 1);
});

test("#5537 squad = null på race-objektet dømmes senior (samme dom som isSeniorSquadRow)", async () => {
  const supabase = makeSupabase();
  const stats = await run(supabase, stageRace({ squad: null }));
  assert.equal(stats.events, 1);
  assert.deepEqual(supabase.state.raceLookups, []);
});

test("#5537 42703 på races.squad (før A2's migration) → senior, omdømme som i dag", async () => {
  const supabase = makeSupabase({
    raceLookup: { data: null, error: { code: "42703", message: "column races.squad does not exist" } },
  });

  const stats = await run(supabase, stageRace());

  assert.equal(stats.events, 1);
  assert.equal(supabase.state.inserted.length, 1);
});

test("#5537 anden opslagsfejl fejler lukket: intet omdømme, Safe-indpakningen fanger", async () => {
  const lookupError = { data: null, error: { code: "PGRST204", message: "Could not find the 'squad' column of 'races' in the schema cache" } };

  await assert.rejects(run(makeSupabase({ raceLookup: lookupError }), stageRace()), /races\.squad lookup failed/);

  const supabase = makeSupabase({ raceLookup: lookupError });
  const originalWarn = console.warn;
  console.warn = () => {};
  let stats;
  try {
    stats = await runReputationDetectionSafe({
      supabase, race: stageRace(), resultRows: STAGE_WIN_ROWS, stageNumbers: [5], seasonNumber: 3, stage: "shadow",
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(stats.failed, true);
  assert.deepEqual(supabase.state.inserted, []);
});

test("#5537 et løb der ikke findes ved opslaget fejler lukket", async () => {
  const supabase = makeSupabase({ raceLookup: { data: null, error: null } });
  await assert.rejects(run(supabase, stageRace()), /not found for squad lookup/);
  assert.deepEqual(supabase.state.inserted, []);
});

test("#5537 flaget off eller en tom etape betaler aldrig for opslaget", async () => {
  const off = makeSupabase();
  const offStats = await run(off, stageRace(), { stage: "off" });
  assert.deepEqual(offStats, { stage: "off", events: 0, inserted: 0, deduped: 0, ridersUpdated: 0 });
  assert.deepEqual(off.state.tables, []);

  const emptyStage = makeSupabase();
  await run(emptyStage, stageRace(), { stageNumbers: [6] });
  assert.deepEqual(emptyStage.state.tables, [], "ingen rækker i finaliseringens etaper → ingen DB-adgang");
});

test("#5537 isSeniorRaceForReputation: feltet vinder over opslaget", async () => {
  const supabase = makeSupabase({ raceLookup: { data: { squad: "junior" }, error: null } });
  assert.equal(await isSeniorRaceForReputation(supabase, { id: "x", squad: "senior" }), true);
  assert.equal(await isSeniorRaceForReputation(supabase, { id: "x", squad: "u23" }), false);
  assert.equal(await isSeniorRaceForReputation(supabase, { id: "x" }), false, "opslaget siger junior");
  assert.equal(supabase.state.raceLookups.length, 1);
});
