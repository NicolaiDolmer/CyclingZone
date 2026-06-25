import test from "node:test";
import assert from "node:assert/strict";
import { assignTeamAcrossRaces, runRaceEntryGenerator } from "./raceEntryGenerator.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});
const flat = { profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
// 10 ryttere
const riders = Array.from({ length: 10 }, (_, i) => ({ rider_id: `r${i}`, abilities: ab(80 - i * 3), fatigue: 0 }));

test("assignTeamAcrossRaces: to ikke-overlappende løb kan dele samme ryttere", () => {
  const races = [
    { race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
    { race_id: "B", window: { start: 300, end: 400 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
  ];
  const out = assignTeamAcrossRaces({ riders, races });
  assert.equal(out.A.length, 6);
  assert.equal(out.B.length, 6);
  // Ikke-overlappende → samme stærke ryttere kan gå igen
  assert.ok(out.A.some((e) => out.B.find((b) => b.rider_id === e.rider_id)), "delt rytter tilladt");
});

test("assignTeamAcrossRaces: overlappende løb deler ALDRIG en rytter", () => {
  const races = [
    { race_id: "A", window: { start: 100, end: 250 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
    { race_id: "B", window: { start: 200, end: 400 }, stages: [flat], sizeRule: { min: 6, max: 6 } }, // overlapper A
  ];
  const out = assignTeamAcrossRaces({ riders, races });
  const aIds = new Set(out.A.map((e) => e.rider_id));
  for (const e of out.B) assert.ok(!aIds.has(e.rider_id), `${e.rider_id} dobbeltbooket`);
});

test("assignTeamAcrossRaces: for få ledige ryttere → mindre felt (ingen crash)", () => {
  const fewRiders = riders.slice(0, 8); // kun 8
  const races = [
    { race_id: "A", window: { start: 100, end: 250 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
    { race_id: "B", window: { start: 200, end: 400 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
  ];
  const out = assignTeamAcrossRaces({ riders: fewRiders, races });
  assert.equal(out.A.length, 6);          // A får sine 6 først (tidligst vindue)
  assert.equal(out.B.length, 2);          // kun 2 tilbage til B
});

test("assignTeamAcrossRaces: hvert pick har en kaptajn-rolle", () => {
  const races = [{ race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } }];
  const out = assignTeamAcrossRaces({ riders, races });
  assert.equal(out.A.filter((e) => e.race_role === "captain").length, 1);
});

// ── runRaceEntryGenerator (DB-orkestrator) ────────────────────────────────────
// Minimal thenable per-tabel query-builder over et `state`-objekt. Udvidet med
// .delete() (raceRunnerAutofill-versionen mangler den). __calls logger insert+delete
// så testen kan assertere idempotent-skrivning vs. dry-run.
function makeSupabase(state) {
  const calls = [];
  function builder(table) {
    const q = { table, filters: [], op: "select" };
    const api = {
      select() { return api; },
      eq(col, val) { q.filters.push(["eq", col, val]); return api; },
      in(col, vals) { q.filters.push(["in", col, vals]); return api; },
      or() { return api; },
      gte(col, val) { q.filters.push(["gte", col, val]); return api; },
      order() { return api; },
      delete() { q.op = "delete"; return api; },
      insert(rows) { calls.push({ table, insert: rows }); state[table] = [...(state[table] || []), ...rows]; return Promise.resolve({ error: null }); },
      then(resolve) {
        let rows = [...(state[table] || [])];
        for (const [op, col, val] of q.filters) {
          if (op === "eq") rows = rows.filter((r) => r[col] === val);
          if (op === "in") rows = rows.filter((r) => val.includes(r[col]));
          if (op === "gte") rows = rows.filter((r) => r[col] != null && r[col] >= val);
        }
        if (q.op === "delete") {
          calls.push({ table, delete: true, filters: q.filters });
          state[table] = (state[table] || []).filter((r) => !rows.includes(r));
          return resolve({ error: null });
        }
        return resolve({ data: rows, error: null });
      },
    };
    return api;
  }
  return { from: (t) => builder(t), __calls: calls };
}

const flatProfile = (n) => ({ stage_number: n, profile_type: "flat", finale_type: null, demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } });

// Byg en rytter-population for ét hold: id-prefix → 8 ryttere + abilities + (frisk) condition.
function seedTeamRiders(state, teamId, count = 8) {
  for (let i = 0; i < count; i++) {
    const id = `${teamId}-r${i}`;
    state.riders.push({ id, team_id: teamId, is_retired: false });
    state.rider_derived_abilities.push({ rider_id: id, ...ab(80 - i * 3) });
    state.rider_condition.push({ rider_id: id, fatigue: 0 });
  }
}

function emptyState() {
  return {
    races: [], race_stage_schedule: [], race_stage_profiles: [],
    teams: [], riders: [], rider_derived_abilities: [], rider_condition: [],
    race_entries: [], race_withdrawals: [],
  };
}

test("runRaceEntryGenerator: idempotent — manuelle entries bevares, auto-filled regenereres", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [
    { id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 },
    { id: "B", season_id: seasonId, race_class: "Class2", league_division_id: 1 },
  ];
  state.race_stage_schedule = [
    { race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" },
    { race_id: "A", stage_number: 2, scheduled_at: "2026-07-02T10:00:00Z" },
    { race_id: "B", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" },
    { race_id: "B", stage_number: 2, scheduled_at: "2026-07-02T10:00:00Z" },
  ];
  state.race_stage_profiles = [
    { race_id: "A", ...flatProfile(1) }, { race_id: "A", ...flatProfile(2) },
    { race_id: "B", ...flatProfile(1) }, { race_id: "B", ...flatProfile(2) },
  ];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8);
  const manualA = [
    { race_id: "A", rider_id: "t1-r0", team_id: "t1", race_role: "captain", is_auto_filled: false },
    { race_id: "A", rider_id: "t1-r1", team_id: "t1", race_role: "helper", is_auto_filled: false },
  ];
  state.race_entries = [...manualA];

  const supabase = makeSupabase(state);
  const res = await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  // Manuelle entries på A er uændret.
  for (const m of manualA) {
    assert.ok(state.race_entries.find((e) => e.race_id === "A" && e.rider_id === m.rider_id && e.is_auto_filled === false),
      `manuel entry ${m.rider_id} på A bevaret`);
  }
  // Generator må IKKE have lavet auto-entries på A (manager har udtaget der).
  assert.equal(state.race_entries.filter((e) => e.race_id === "A" && e.is_auto_filled === true).length, 0,
    "ingen auto-entries på A (manuelt hold)");
  // B har fået auto-filled entries.
  const bAuto = state.race_entries.filter((e) => e.race_id === "B" && e.is_auto_filled === true);
  assert.ok(bAuto.length > 0, "B autofyldt");
  assert.ok(bAuto.every((e) => e.is_auto_filled === true));
  // B's ryttere overlapper IKKE A's manuelle ryttere (binding: A og B er tidsoverlappende).
  const aRiders = new Set(manualA.map((m) => m.rider_id));
  for (const e of bAuto) assert.ok(!aRiders.has(e.rider_id), `${e.rider_id} dobbeltbooket A↔B`);
  assert.equal(res.dryRun, false);
  assert.ok(res.generated > 0);

  // Idempotent genkørsel: samme resultat, manuelle stadig intakte, INGEN duplikering.
  const before = state.race_entries.filter((e) => e.race_id === "B" && e.is_auto_filled === true).map((e) => e.rider_id).sort();
  const callsBefore = supabase.__calls.length;
  const res2 = await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });
  const after = state.race_entries.filter((e) => e.race_id === "B" && e.is_auto_filled === true).map((e) => e.rider_id).sort();
  assert.deepEqual(after, before, "deterministisk: samme B-ryttere efter genkørsel");
  assert.equal(after.length, before.length, "ingen duplikering — delete-then-insert holder antallet stabilt");
  assert.equal(state.race_entries.filter((e) => e.race_id === "A" && e.is_auto_filled === false).length, manualA.length,
    "manuelle entries uberørt efter genkørsel");
  assert.equal(res2.generated, res.generated, "generated-count stabil");
  // Genkørslen SKAL slette eksisterende auto-entries før insert (ægte idempotens).
  const deletesOn2nd = supabase.__calls.slice(callsBefore).filter((c) => c.delete && c.table === "race_entries");
  assert.ok(deletesOn2nd.length > 0, "2. kørsel sletter auto-filled før reinsert");
  // Delete-filteret må ALDRIG ramme manuelle: det indeholder altid is_auto_filled=true.
  for (const d of deletesOn2nd) {
    assert.ok(d.filters.some(([op, col, val]) => op === "eq" && col === "is_auto_filled" && val === true),
      "delete-filter er afgrænset til is_auto_filled=true");
  }
});

test("runRaceEntryGenerator: afmeldte hold får ingen entries", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 2 }];
  state.race_stage_schedule = [
    { race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" },
    { race_id: "A", stage_number: 2, scheduled_at: "2026-07-02T10:00:00Z" },
  ];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }, { race_id: "A", ...flatProfile(2) }];
  state.teams = [
    { id: "t1", is_test_account: false, is_frozen: false, league_division_id: 2 },
    { id: "t2", is_test_account: false, is_frozen: false, league_division_id: 2 },
  ];
  seedTeamRiders(state, "t1", 8);
  seedTeamRiders(state, "t2", 8);
  // t2 har trukket sig fra A.
  state.race_withdrawals = [{ race_id: "A", team_id: "t2" }];

  const supabase = makeSupabase(state);
  const res = await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  assert.equal(state.race_entries.filter((e) => e.race_id === "A" && e.team_id === "t2").length, 0,
    "afmeldt hold t2 har ingen entries");
  assert.ok(state.race_entries.filter((e) => e.race_id === "A" && e.team_id === "t1").length > 0,
    "t1 deltager stadig");
  assert.ok(res.skipped >= 1, "afmeldingen tæller som skipped (race,team)-par");
});

test("runRaceEntryGenerator: to løb samme CET-dag deler ALDRIG en rytter (#1823 regression)", async () => {
  const state = emptyState();
  const seasonId = "season1";
  // Endagsløb H kl. 22:00 CEST + etapeløb L (etape 1 kl. 23:00 CEST samme aften, etape 2 dagen efter).
  // Med det gamle instant-vindue overlappede de IKKE (H slutter 22:00 før L starter 23:00),
  // så generatoren dobbeltbookede de stærkeste ryttere i begge — præcis prod-bug'en.
  state.races = [
    { id: "H", season_id: seasonId, race_class: "Class2", league_division_id: 1 },
    { id: "L", season_id: seasonId, race_class: "Class2", league_division_id: 1 },
  ];
  state.race_stage_schedule = [
    { race_id: "H", stage_number: 1, scheduled_at: "2026-06-23T20:00:00Z" }, // 22:00 CEST 23/6
    { race_id: "L", stage_number: 1, scheduled_at: "2026-06-23T21:00:00Z" }, // 23:00 CEST 23/6
    { race_id: "L", stage_number: 2, scheduled_at: "2026-06-24T13:00:00Z" }, // 24/6
  ];
  state.race_stage_profiles = [
    { race_id: "H", ...flatProfile(1) },
    { race_id: "L", ...flatProfile(1) }, { race_id: "L", ...flatProfile(2) },
  ];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 12); // stor nok trup til 6+6 distinkte

  const supabase = makeSupabase(state);
  await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  const hRiders = new Set(state.race_entries.filter((e) => e.race_id === "H").map((e) => e.rider_id));
  const lRiders = state.race_entries.filter((e) => e.race_id === "L").map((e) => e.rider_id);
  assert.ok(hRiders.size > 0 && lRiders.length > 0, "begge løb fik et hold");
  for (const rid of lRiders) assert.ok(!hRiders.has(rid), `${rid} dobbeltbooket H↔L (samme CET-dag)`);
});

test("runRaceEntryGenerator: igangværende løb (stages_completed>0) regenereres IKKE + dets ryttere låses (#1825)", async () => {
  const state = emptyState();
  const seasonId = "season1";
  // L = igangværende etapeløb (3 etaper kørt), B = ikke-startet, samme dag → overlap.
  state.races = [
    { id: "L", season_id: seasonId, race_class: "Class2", league_division_id: 1, stages_completed: 3 },
    { id: "B", season_id: seasonId, race_class: "Class2", league_division_id: 1, stages_completed: 0 },
  ];
  state.race_stage_schedule = [
    { race_id: "L", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" },
    { race_id: "B", stage_number: 1, scheduled_at: "2026-07-01T14:00:00Z" }, // samme dag → binder
  ];
  state.race_stage_profiles = [{ race_id: "L", ...flatProfile(1) }, { race_id: "B", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8);
  // L har allerede en (auto-filled) igangværende lineup.
  state.race_entries = [
    { race_id: "L", rider_id: "t1-r0", team_id: "t1", race_role: "captain", is_auto_filled: true },
    { race_id: "L", rider_id: "t1-r1", team_id: "t1", race_role: "helper", is_auto_filled: true },
  ];

  const supabase = makeSupabase(state);
  await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  // L's igangværende lineup er URØRT — præcis de oprindelige ryttere, ikke regenereret.
  const lEntries = state.race_entries.filter((e) => e.race_id === "L");
  assert.deepEqual(lEntries.map((e) => e.rider_id).sort(), ["t1-r0", "t1-r1"], "L's lineup uændret");
  // B er genereret, men deler ALDRIG en rytter med det frosne L (binding-lås).
  const lRiders = new Set(lEntries.map((e) => e.rider_id));
  const bRiders = state.race_entries.filter((e) => e.race_id === "B" && e.is_auto_filled === true);
  assert.ok(bRiders.length > 0, "B genereret");
  for (const e of bRiders) assert.ok(!lRiders.has(e.rider_id), `${e.rider_id} dobbeltbooket med igangværende L`);
});

test("runRaceEntryGenerator: dryRun=true skriver intet", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 3 }];
  state.race_stage_schedule = [
    { race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" },
    { race_id: "A", stage_number: 2, scheduled_at: "2026-07-02T10:00:00Z" },
  ];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }, { race_id: "A", ...flatProfile(2) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 3 }];
  seedTeamRiders(state, "t1", 8);

  const supabase = makeSupabase(state);
  const res = await runRaceEntryGenerator({ supabase, seasonId, dryRun: true });

  assert.equal(supabase.__calls.filter((c) => c.insert).length, 0, "ingen insert i dry-run");
  assert.equal(supabase.__calls.filter((c) => c.delete).length, 0, "ingen delete i dry-run");
  assert.equal(state.race_entries.length, 0, "race_entries uændret i dry-run");
  assert.equal(res.dryRun, true);
  assert.ok(res.generated > 0, "preview-count > 0");
});
