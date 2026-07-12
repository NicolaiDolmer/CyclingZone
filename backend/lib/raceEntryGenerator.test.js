import test from "node:test";
import assert from "node:assert/strict";
import { assignTeamAcrossRaces, runRaceEntryGenerator } from "./raceEntryGenerator.js";
import { raceTerrainBucket } from "./raceTerrain.js";

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
// .delete()/.update()/.upsert(). __calls logger alle writes så testen kan assertere
// diff-skrivning vs. dry-run. race_entries-writes HÅNDHÆVER PK (race_id, rider_id)
// OG uq_race_entries_captain/_sprint_captain/_hunter (maks én pr. (race, hold), på
// tværs af manuel/auto) som Postgres — regressioner til rå insert med dublet ELLER
// dobbelt special-rolle (CYCLINGZONE-2D) fejler testen (#2375).
// opts.failUpsert(ctx) → injicér upsert-fejl (never-emptier-/isolations-tests).
const MOCK_SPECIAL_ROLES = ["captain", "sprint_captain", "hunter"];
function makeSupabase(state, { failUpsert = null } = {}) {
  const calls = [];
  const entryKey = (r) => `${r.race_id}|${r.rider_id}`;
  // uq_race_entries_*: returnér den krænkede rolle hvis `rows` (samlet tabel-billede)
  // indeholder >1 special-rolle-række pr. (race_id, team_id, race_role).
  const violatedRoleUq = (rows) => {
    const counts = new Map();
    for (const r of rows) {
      if (!MOCK_SPECIAL_ROLES.includes(r.race_role)) continue;
      const k = `${r.race_id}|${r.team_id}|${r.race_role}`;
      counts.set(k, (counts.get(k) || 0) + 1);
      if (counts.get(k) > 1) return r.race_role;
    }
    return null;
  };
  const roleUqError = (role) => ({
    error: { message: `duplicate key value violates unique constraint "uq_race_entries_${role}"` },
  });
  function builder(table) {
    const q = { table, filters: [], op: "select", values: null };
    const api = {
      select() { return api; },
      eq(col, val) { q.filters.push(["eq", col, val]); return api; },
      in(col, vals) { q.filters.push(["in", col, vals]); return api; },
      or() { return api; },
      gte(col, val) { q.filters.push(["gte", col, val]); return api; },
      range() { return api; }, // mock ignorer paginering (test-data < 1000 rækker)
      order() { return api; },
      delete() { q.op = "delete"; return api; },
      update(values) { q.op = "update"; q.values = values; return api; },
      insert(rows) {
        // PK-håndhævelse som Postgres: dublet (race_id, rider_id) → duplicate key-fejl.
        if (table === "race_entries") {
          const seen = new Set((state[table] || []).map(entryKey));
          for (const r of rows) {
            if (seen.has(entryKey(r))) {
              return Promise.resolve({ error: { message: 'duplicate key value violates unique constraint "race_entries_pkey"' } });
            }
            seen.add(entryKey(r));
          }
          const violated = violatedRoleUq([...(state[table] || []), ...rows]);
          if (violated) return Promise.resolve(roleUqError(violated));
        }
        calls.push({ table, insert: rows });
        state[table] = [...(state[table] || []), ...rows];
        return Promise.resolve({ error: null });
      },
      upsert(rows, opts = {}) {
        if (failUpsert && failUpsert({ table, rows })) {
          return Promise.resolve({ error: { message: "injected upsert failure" } });
        }
        calls.push({ table, insert: rows, upsert: true, opts });
        if (table === "race_entries" && opts.ignoreDuplicates) {
          // ON CONFLICT DO NOTHING-semantik: eksisterende (race,rytter) — uanset team —
          // og intra-batch-dubletter springes stille over. NB: ON CONFLICT dækker KUN
          // PK'en (onConflict-target) — uq_race_entries_*-brud fejler stadig hele
          // statementet, præcis som i Postgres (CYCLINGZONE-2D-mekanismen).
          const seen = new Set((state[table] || []).map(entryKey));
          const accepted = [];
          for (const r of rows) {
            if (seen.has(entryKey(r))) continue;
            seen.add(entryKey(r));
            accepted.push(r);
          }
          const violated = violatedRoleUq([...(state[table] || []), ...accepted]);
          if (violated) return Promise.resolve(roleUqError(violated));
          state[table] = [...(state[table] || []), ...accepted];
          return Promise.resolve({ error: null });
        }
        if (table === "race_entries") {
          const violated = violatedRoleUq([...(state[table] || []), ...rows]);
          if (violated) return Promise.resolve(roleUqError(violated));
        }
        state[table] = [...(state[table] || []), ...rows];
        return Promise.resolve({ error: null });
      },
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
        if (q.op === "update") {
          // uq_race_entries_*-håndhævelse: simulér opdateringen på et prospekt-billede
          // FØR den anvendes — brud → fejl uden at røre state (som Postgres).
          if (table === "race_entries") {
            const prospective = (state[table] || []).map((r) =>
              rows.includes(r) ? { ...r, ...q.values } : r
            );
            const violated = violatedRoleUq(prospective);
            if (violated) {
              calls.push({ table, update: q.values, filters: q.filters, rejected: true });
              return resolve(roleUqError(violated));
            }
          }
          calls.push({ table, update: q.values, filters: q.filters });
          for (const r of rows) Object.assign(r, q.values);
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
    state.riders.push({ id, team_id: teamId, is_retired: false, is_academy: false });
    state.rider_derived_abilities.push({ rider_id: id, ...ab(80 - i * 3) });
    state.rider_condition.push({ rider_id: id, fatigue: 0 });
  }
}

function emptyState() {
  return {
    races: [], race_stage_schedule: [], race_stage_profiles: [],
    teams: [], riders: [], rider_derived_abilities: [], rider_condition: [],
    race_entries: [], race_withdrawals: [],
    team_race_strategy: [], team_rider_role_rules: [],
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
  // Ejer 28/6: delvis manuel trup på A (2/6) → TOP-FYLDT til fuld (4 auto-fill), manuelle bevaret.
  const aRiders = new Set(manualA.map((m) => m.rider_id));
  const aAuto = state.race_entries.filter((e) => e.race_id === "A" && e.is_auto_filled === true);
  assert.equal(aAuto.length, 4, "A top-fyldt med 4 auto-entries (2 manuelle + 4 = fuld 6)");
  for (const e of aAuto) assert.ok(!aRiders.has(e.rider_id), `top-up ${e.rider_id} genbruger en manuel rytter`);
  const aAll = new Set(state.race_entries.filter((e) => e.race_id === "A").map((e) => e.rider_id));
  assert.equal(aAll.size, 6, "A er fuld (6) efter top-fyld");
  // CodeRabbit (Major): top-up må IKKE udpege en 2. kaptajn/sprint-kaptajn — den manuelle
  // trup ejer special-rollerne. Auto-fyldte top-up-ryttere skal alle være "helper".
  for (const e of aAuto) assert.equal(e.race_role, "helper", `top-up ${e.rider_id} fik special-rolle ${e.race_role}`);
  const aCaptains = state.race_entries.filter((e) => e.race_id === "A" && e.race_role === "captain");
  assert.equal(aCaptains.length, 1, "præcis én kaptajn på A efter top-fyld");
  assert.equal(aCaptains[0].rider_id, "t1-r0", "den manuelle kaptajn bevares");
  // B har fået auto-filled entries (A+B overlapper → B får de resterende ledige).
  const bAuto = state.race_entries.filter((e) => e.race_id === "B" && e.is_auto_filled === true);
  assert.ok(bAuto.length > 0, "B autofyldt");
  assert.ok(bAuto.every((e) => e.is_auto_filled === true));
  // B's ryttere overlapper IKKE A's ryttere (manuelle ELLER top-up) — binding håndhævet.
  for (const e of bAuto) assert.ok(!aAll.has(e.rider_id), `${e.rider_id} dobbeltbooket A↔B`);
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
  // #2375: diff-baseret idempotens — en genkørsel med uændret input skriver INTET
  // (ingen upsert-rækker, ingen delete, ingen update). Det gamle wholesale
  // delete-then-insert-mønster kunne efterlade et løb tømt hvis insert fejlede
  // efter delete (prod 12/7) og er bevidst afskaffet.
  const writesOn2nd = supabase.__calls.slice(callsBefore).filter(
    (c) => c.table === "race_entries" && (c.insert || c.delete || c.update)
  );
  assert.equal(writesOn2nd.length, 0, "2. kørsel er en ren no-op på race_entries (tom diff)");
  assert.equal(res2.inserted, 0, "intet indsat ved uændret genkørsel");
  assert.equal(res2.removed, 0, "intet fjernet ved uændret genkørsel");
  assert.equal(res2.role_updated, 0, "ingen rolle-opdatering ved uændret genkørsel");
  assert.equal(res2.failed_units, 0, "ingen fejlede enheder");
});

test("runRaceEntryGenerator: FULD manuel trup (6/6) top-fyldes IKKE", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8);
  state.race_entries = ["t1-r0", "t1-r1", "t1-r2", "t1-r3", "t1-r4", "t1-r5"].map((rid, i) => (
    { race_id: "A", rider_id: rid, team_id: "t1", race_role: i === 0 ? "captain" : "helper", is_auto_filled: false }
  ));
  const supabase = makeSupabase(state);
  await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });
  assert.equal(state.race_entries.filter((e) => e.race_id === "A" && e.is_auto_filled === true).length, 0, "fuld manuel → ingen top-up");
  assert.equal(state.race_entries.filter((e) => e.race_id === "A").length, 6, "stadig præcis de 6 manuelle");
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

// Rod B (#1742/#1800): assistenten må KUN vælge løbs-berettigede ryttere. Generatoren
// manglede is_academy-filteret (kun is_retired), så en akademirytter med stærke evner
// blev auto-valgt (264 ghosts i prod 2026-06-25). Repro: stærkeste rytter er akademi.
test("runRaceEntryGenerator: akademiryttere auto-vælges ALDRIG (Rod B)", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [
    { race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" },
    { race_id: "A", stage_number: 2, scheduled_at: "2026-07-02T10:00:00Z" },
  ];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }, { race_id: "A", ...flatProfile(2) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8);
  // Stærkeste rytter på holdet er akademi → autopick ville vælge ham hvis ufiltreret.
  state.riders.push({ id: "t1-academy", team_id: "t1", is_retired: false, is_academy: true });
  state.rider_derived_abilities.push({ rider_id: "t1-academy", ...ab(99) });
  state.rider_condition.push({ rider_id: "t1-academy", fatigue: 0 });

  const supabase = makeSupabase(state);
  await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  const picked = state.race_entries.filter((e) => e.race_id === "A").map((e) => e.rider_id);
  assert.ok(picked.length > 0, "A blev autofyldt");
  assert.ok(!picked.includes("t1-academy"), "akademirytter må ALDRIG auto-vælges");
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

// ── S3 strategi-lag (assignTeamAcrossRaces) ───────────────────────────────────

test("assignTeamAcrossRaces: strategy=null ≡ ingen strategy (idempotens)", () => {
  const races = [
    { race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
    { race_id: "B", window: { start: 300, end: 400 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
  ];
  const a = assignTeamAcrossRaces({ riders, races });
  const b = assignTeamAcrossRaces({ riders, races, strategy: null });
  assert.deepEqual(a, b);
});

test("assignTeamAcrossRaces: tom strategi ≡ null-adfærd", () => {
  const races = [{ race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } }];
  const empty = { aChain: [], captainPriorities: {}, roleRules: {}, targetRaceIds: new Set() };
  assert.deepEqual(assignTeamAcrossRaces({ riders, races, strategy: empty }), assignTeamAcrossRaces({ riders, races }));
});

test("assignTeamAcrossRaces: mål-løb får A-kæde-ryttere (selv svage)", () => {
  // r9 er svagest af de 10; A-kæde-rang 0 + mål-løb → med på A.
  const races = [{ race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } }];
  const strategy = { aChain: ["r9", "r8"], captainPriorities: {}, roleRules: {}, targetRaceIds: new Set(["A"]) };
  const out = assignTeamAcrossRaces({ riders, races, strategy });
  const ids = out.A.map((e) => e.rider_id);
  assert.ok(ids.includes("r9") && ids.includes("r8"), "A-kæde på mål-løb");
});

test("assignTeamAcrossRaces: kaptajn-prioritet bruger løbets terræn-bucket", () => {
  const mtn = { profile_type: "mountain", demand_vector: { climbing: 0.9, randomness: 0.5 } };
  const races = [{ race_id: "A", window: { start: 100, end: 200 }, stages: [mtn], sizeRule: { min: 6, max: 6 } }];
  // captainPriorities pr. bucket: mountain → r3 først.
  const strategy = { aChain: [], captainPriorities: { mountain: ["r3"] }, roleRules: {}, targetRaceIds: new Set() };
  const out = assignTeamAcrossRaces({ riders, races, strategy });
  assert.equal(out.A.find((e) => e.race_role === "captain")?.rider_id, "r3");
  assert.equal(raceTerrainBucket(races[0].stages), "mountain"); // sanity
});

// ── S3 strategi-loading (runRaceEntryGenerator) ───────────────────────────────

test("runRaceEntryGenerator: holdets A-kæde-mål-løb prioriterer kerne-ryttere", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8); // t1-r0 stærkest … t1-r7 svagest
  // A-kæde: svageste rytter som rang 0 + A er mål-løb → han SKAL udtages.
  state.team_race_strategy = [{ team_id: "t1", a_chain: ["t1-r7"], captain_priorities: {}, target_race_ids: ["A"] }];
  state.team_rider_role_rules = [];

  const supabase = makeSupabase(state);
  await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });
  const aIds = state.race_entries.filter((e) => e.race_id === "A").map((e) => e.rider_id);
  assert.ok(aIds.includes("t1-r7"), "A-kæde-rytter på mål-løb trods lav score");
});

// ── #2375-hotfix (12/7): PK-kollisioner, per-enhed-isolation + aldrig-tommere ──
// Prod-crash: "duplicate key value violates unique constraint race_entries_pkey" ved
// mid-sæson-kørsel. PK er (race_id, rider_id) UDEN team_id — wholesale delete(team-
// scoped)+insert væltede på dublet-/ghost-rækker og efterlod løbet tømt for holdets
// entries. Mockens insert håndhæver nu PK'en, så testene her ér repro-klassen.

test("#2375: dubleret rytter-række i populationen (ustabil paginering) crasher ALDRIG og skriver ingen dublet", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8);
  // Simulér paginerings-dublet: samme rytter-række to gange i riders-resultatet.
  // Autopick deduper ikke input → picks kan indeholde t1-r0 to gange → med den gamle
  // rå insert = race_entries_pkey-crash (præcis prod-fejlen 12/7).
  state.riders.push({ id: "t1-r0", team_id: "t1", is_retired: false, is_academy: false });

  const supabase = makeSupabase(state);
  const res = await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  assert.equal(res.failed_units, 0, "ingen enhed fejlede");
  const aEntries = state.race_entries.filter((e) => e.race_id === "A");
  const uniqueKeys = new Set(aEntries.map((e) => `${e.race_id}|${e.rider_id}`));
  assert.equal(uniqueKeys.size, aEntries.length, "ingen dublet (race_id, rider_id) skrevet");
  assert.ok(aEntries.length > 0, "A blev autofyldt trods dublet-input");
});

test("#2375: residual (race,rytter)-række under et ANDET hold (ghost) vælter ikke kørslen", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8);
  // Ghost: t1-r0 (nu på t1 efter transfer) har en gammel auto-række under sit EX-hold.
  // Team-scoped delete for (A,t1) kan aldrig fjerne den → gammel rå insert = PK-crash.
  state.race_entries = [
    { race_id: "A", rider_id: "t1-r0", team_id: "t-old", race_role: "helper", is_auto_filled: true },
  ];

  const supabase = makeSupabase(state);
  const res = await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  assert.equal(res.failed_units, 0, "ghost-kollision håndteres uden fejl (ignoreDuplicates)");
  const r0Rows = state.race_entries.filter((e) => e.race_id === "A" && e.rider_id === "t1-r0");
  assert.equal(r0Rows.length, 1, "præcis én række pr. (race, rytter) — PK respekteret");
  assert.ok(
    state.race_entries.filter((e) => e.race_id === "A" && e.team_id === "t1").length > 0,
    "resten af t1's trup blev indsat trods ghosten"
  );
});

test("#2375: insert-fejl efterlader ALDRIG løbet tommere end før (aldrig-tommere-garanti)", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8);
  // Eksisterende (delvis) auto-lineup: to af de ryttere generatoren også vil vælge igen.
  state.race_entries = [
    { race_id: "A", rider_id: "t1-r0", team_id: "t1", race_role: "captain", is_auto_filled: true },
    { race_id: "A", rider_id: "t1-r1", team_id: "t1", race_role: "helper", is_auto_filled: true },
  ];

  // Injicér upsert-fejl (fx netværk/FK) — den gamle kode havde på dette tidspunkt
  // allerede slettet ALLE holdets auto-entries → løbet stod tømt (prod 12/7).
  const supabase = makeSupabase(state, { failUpsert: ({ table }) => table === "race_entries" });
  const res = await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  assert.equal(res.failed_units, 1, "enheden rapporteres som fejlet");
  assert.ok(res.errors.length >= 1 && /injected upsert failure/.test(res.errors[0]), "fejlen er i rapporten");
  const aEntries = state.race_entries.filter((e) => e.race_id === "A");
  assert.ok(aEntries.length >= 2, `løbet er IKKE tommere end før (${aEntries.length} >= 2)`);
  assert.ok(aEntries.some((e) => e.rider_id === "t1-r0"), "eksisterende entry t1-r0 overlevede fejlen");
  assert.ok(aEntries.some((e) => e.rider_id === "t1-r1"), "eksisterende entry t1-r1 overlevede fejlen");
});

test("#2375: én enheds fejl aborterer IKKE de andre løb (per-enhed-isolation)", async () => {
  const state = emptyState();
  const seasonId = "season1";
  // To ikke-overlappende løb — fejl injiceres KUN på A's upsert.
  state.races = [
    { id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 },
    { id: "B", season_id: seasonId, race_class: "Class2", league_division_id: 1 },
  ];
  state.race_stage_schedule = [
    { race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" },
    { race_id: "B", stage_number: 1, scheduled_at: "2026-07-05T10:00:00Z" },
  ];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }, { race_id: "B", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8);

  const supabase = makeSupabase(state, {
    failUpsert: ({ table, rows }) => table === "race_entries" && rows.some((r) => r.race_id === "A"),
  });
  const res = await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  assert.equal(res.failed_units, 1, "kun A-enheden fejlede");
  assert.equal(state.race_entries.filter((e) => e.race_id === "A").length, 0, "A fik intet (fejlet)");
  assert.ok(state.race_entries.filter((e) => e.race_id === "B").length > 0, "B blev stadig autofyldt");
});

test("#2375: rolle-ændring på eksisterende auto-række opdateres via update (ikke delete+insert)", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 6); // Class2 = præcis 6 → alle 6 vælges igen
  // Samme 6 ryttere ligger allerede som auto-entries, men ALLE som helper —
  // generatoren vil have t1-r0 som captain (stærkest) → rolle-diff, ingen insert/delete.
  state.race_entries = ["t1-r0", "t1-r1", "t1-r2", "t1-r3", "t1-r4", "t1-r5"].map((rid) => (
    { race_id: "A", rider_id: rid, team_id: "t1", race_role: "helper", is_auto_filled: true }
  ));

  const supabase = makeSupabase(state);
  const res = await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  assert.equal(res.failed_units, 0);
  assert.equal(res.inserted, 0, "ingen inserts — samme 6 ryttere");
  assert.equal(res.removed, 0, "ingen deletes — samme 6 ryttere");
  assert.ok(res.role_updated >= 1, "mindst én rolle opdateret (captain)");
  const captains = state.race_entries.filter((e) => e.race_id === "A" && e.race_role === "captain");
  assert.equal(captains.length, 1, "præcis én kaptajn efter rolle-refresh");
  assert.equal(state.race_entries.filter((e) => e.race_id === "A").length, 6, "stadig præcis 6 entries");
});

// ── #2375 hotfix 2 (CYCLINGZONE-2D): rolle-bevidst supplement ─────────────────
// Prod: 31 enheder fejlede med uq_race_entries_captain/_sprint_captain (Team UKYO,
// Division 3 A) — supplement-batchen tildelte en special-rolle som en bevaret
// eksisterende række allerede holdt. Mocken håndhæver nu uq-indexene som Postgres,
// så disse tests ér repro-klassen.

test("CYCLINGZONE-2D: manuel captain + supplement-batch → ingen uq-fejl, nye ryttere er helpers, manager-captain urørt", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8);
  // Manageren har selv udtaget 2 ryttere inkl. KAPTAJN (bevarede, manuelle entries).
  state.race_entries = [
    { race_id: "A", rider_id: "t1-r6", team_id: "t1", race_role: "captain", is_auto_filled: false },
    { race_id: "A", rider_id: "t1-r7", team_id: "t1", race_role: "sprint_captain", is_auto_filled: false },
  ];

  const supabase = makeSupabase(state);
  const res = await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  assert.equal(res.failed_units, 0, `ingen uq-kollision (fejl: ${res.errors.join("; ")})`);
  const autoRows = state.race_entries.filter((e) => e.race_id === "A" && e.is_auto_filled === true);
  assert.equal(autoRows.length, 4, "top-fyldt til fuld trup (2 manuelle + 4 auto = 6)");
  for (const e of autoRows) assert.equal(e.race_role, "helper", `supplement ${e.rider_id} fik special-rolle ${e.race_role}`);
  const captains = state.race_entries.filter((e) => e.race_id === "A" && e.race_role === "captain");
  assert.equal(captains.length, 1, "præcis én kaptajn");
  assert.equal(captains[0].rider_id, "t1-r6", "managerens kaptajn er urørt");
  assert.equal(captains[0].is_auto_filled, false, "kaptajnen er stadig den manuelle række");
  const sprintCaptains = state.race_entries.filter((e) => e.race_id === "A" && e.race_role === "sprint_captain");
  assert.equal(sprintCaptains.length, 1, "præcis én sprint-kaptajn (managerens)");
  assert.equal(sprintCaptains[0].rider_id, "t1-r7");
});

test("CYCLINGZONE-2D: ny auto-kaptajn indsættes uden uq-kollision — gammel holder vacates FØR insert", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 6); // r0 stærkest → ny ønsket captain
  // Bevaret auto-lineup FØR r0 kom til (fx købt på auktion): r1 er captain, r0 mangler.
  // Gammel skriverækkefølge (insert af ny captain FØR demote af r1) = præcis prod-fejlen.
  state.race_entries = [
    { race_id: "A", rider_id: "t1-r1", team_id: "t1", race_role: "captain", is_auto_filled: true },
    { race_id: "A", rider_id: "t1-r2", team_id: "t1", race_role: "helper", is_auto_filled: true },
    { race_id: "A", rider_id: "t1-r3", team_id: "t1", race_role: "helper", is_auto_filled: true },
    { race_id: "A", rider_id: "t1-r4", team_id: "t1", race_role: "helper", is_auto_filled: true },
    { race_id: "A", rider_id: "t1-r5", team_id: "t1", race_role: "helper", is_auto_filled: true },
  ];

  const supabase = makeSupabase(state);
  const res = await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  assert.equal(res.failed_units, 0, `ingen uq-kollision (fejl: ${res.errors.join("; ")})`);
  const aEntries = state.race_entries.filter((e) => e.race_id === "A");
  assert.equal(aEntries.length, 6, "fuld trup efter supplement");
  const captains = aEntries.filter((e) => e.race_role === "captain");
  assert.equal(captains.length, 1, "præcis én kaptajn");
  assert.equal(captains[0].rider_id, "t1-r0", "stærkeste rytter er ny kaptajn");
  assert.equal(
    aEntries.find((e) => e.rider_id === "t1-r1")?.race_role, "helper",
    "gammel kaptajn er nedgraderet til helper (vacate)"
  );
  // Uniforme test-abilities → bedste sprinter == kaptajnen → autopick sætter ingen
  // sprint_captain. Det afgørende her er at uq aldrig brydes: maks én af hver.
  assert.ok(aEntries.filter((e) => e.race_role === "sprint_captain").length <= 1, "maks én sprint-kaptajn");
});

test("CYCLINGZONE-2D: stale auto-kaptajn (rytter forladt holdet) blokerer ikke ny kaptajn", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 6);
  // "gone" er solgt/væk (ikke i riders-state) men hans captain-række under t1 hænger ved.
  state.race_entries = [
    { race_id: "A", rider_id: "gone", team_id: "t1", race_role: "captain", is_auto_filled: true },
  ];

  const supabase = makeSupabase(state);
  const res = await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });

  assert.equal(res.failed_units, 0, `ingen uq-kollision (fejl: ${res.errors.join("; ")})`);
  const aEntries = state.race_entries.filter((e) => e.race_id === "A");
  assert.ok(!aEntries.some((e) => e.rider_id === "gone"), "stale kaptajn-række fjernet");
  const captains = aEntries.filter((e) => e.race_role === "captain");
  assert.equal(captains.length, 1, "præcis én kaptajn");
  assert.equal(captains[0].rider_id, "t1-r0", "ny kaptajn indsat trods stale holder");
});

test("runRaceEntryGenerator: hold UDEN strategi-row → uændret (strategy=null)", async () => {
  const state = emptyState();
  const seasonId = "season1";
  state.races = [{ id: "A", season_id: seasonId, race_class: "Class2", league_division_id: 1 }];
  state.race_stage_schedule = [{ race_id: "A", stage_number: 1, scheduled_at: "2026-07-01T10:00:00Z" }];
  state.race_stage_profiles = [{ race_id: "A", ...flatProfile(1) }];
  state.teams = [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1 }];
  seedTeamRiders(state, "t1", 8);
  state.team_race_strategy = [];
  state.team_rider_role_rules = [];

  const supabase = makeSupabase(state);
  await runRaceEntryGenerator({ supabase, seasonId, dryRun: false });
  const aIds = state.race_entries.filter((e) => e.race_id === "A").map((e) => e.rider_id).sort();
  // Class2 = 6 ryttere; uden strategi = top-6 på score = t1-r0..t1-r5.
  assert.deepEqual(aIds, ["t1-r0", "t1-r1", "t1-r2", "t1-r3", "t1-r4", "t1-r5"]);
});
