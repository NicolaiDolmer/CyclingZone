// backend/lib/raceRunnerAutofill.test.js
// #1307: per-hold autopick. Mock-builder følger raceFatigue.test.js-mønstret.
import test from "node:test";
import assert from "node:assert/strict";
import { loadEntrantsForRace } from "./raceRunner.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});

// Minimal thenable query-builder: state = { tabel → rækker }; understøtter de
// kald loadEntrantsForRace/fillMissingTeamEntries laver (select/eq/in/or/gte + insert).
function makeSupabase(state) {
  const calls = [];
  function applyFilters(rows, filters) {
    let result = rows;
    for (const [op, col, val] of filters) {
      if (op === "eq") result = result.filter((r) => r[col] === val);
      if (op === "neq") result = result.filter((r) => r[col] !== val);
      if (op === "in") result = result.filter((r) => val.includes(r[col]));
      if (op === "gte") result = result.filter((r) => r[col] != null && r[col] >= val);
      if (op === "is") result = result.filter((r) => (r[col] ?? null) === val);
    }
    return result;
  }
  function builder(table) {
    const q = { table, filters: [] };
    const api = {
      select() { return api; },
      eq(col, val) { q.filters.push(["eq", col, val]); return api; },
      // #3076: binding-stien bruger .neq() (andre løb end dette) og .maybeSingle()
      // (season_id-opslaget). Mocken ramte dem aldrig før, fordi state uden
      // race_stage_schedule gav thisWindow=null og loaderen returnerede tidligt.
      neq(col, val) { q.filters.push(["neq", col, val]); return api; },
      maybeSingle() {
        const rows = applyFilters([...(state[table] || [])], q.filters);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      in(col, vals) { q.filters.push(["in", col, vals]); return api; },
      or() { return api; },
      is(col, val) { q.filters.push(["is", col, val]); return api; },
      gte(col, val) { q.filters.push(["gte", col, val]); return api; },
      order() { return api; },
      // #2962 · fillMissingTeamEntries' teams-select pagineres nu via fetchAllRows
      // (.order("id").range()) — anvender samme filtre som .then(), sliced til siden.
      range(from, to) {
        const rows = applyFilters([...(state[table] || [])], q.filters);
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
      insert(rows) { calls.push({ table, insert: rows }); state[table] = [...(state[table] || []), ...rows]; return Promise.resolve({ error: null }); },
      then(resolve) {
        const rows = applyFilters([...(state[table] || [])], q.filters);
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }
  return { from: (t) => builder(t), __calls: calls };
}

const stages = [{ stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } }];
const race = { id: "race1", race_type: "single", season_id: "s1" };

function baseState() {
  const state = {
    teams: [
      { id: "t1", is_test_account: false, is_frozen: false },
      { id: "t2", is_test_account: false, is_frozen: false },
    ],
    riders: [],
    race_entries: [],
    rider_condition: [],
    rider_derived_abilities: [],
  };
  // 10 ryttere pr. hold med abilities.
  for (const t of ["t1", "t2"]) {
    for (let i = 0; i < 10; i++) {
      const id = `${t}-r${i}`;
      state.riders.push({ id, team_id: t, firstname: "A", lastname: id, is_u25: false, is_retired: false, is_academy: false });
      state.rider_derived_abilities.push({ rider_id: id, ...ab(80 - i * 3) });
    }
  }
  return state;
}

test("hold uden entries autopickes (max 8, kaptajn sat, is_auto_filled=true)", async () => {
  const state = baseState();
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: true });
  assert.equal(entrants.length, 16, "2 hold × 8 autopicked");
  const inserted = supabase.__calls.filter((c) => c.table === "race_entries").flatMap((c) => c.insert);
  assert.ok(inserted.every((r) => r.is_auto_filled === true));
  for (const t of ["t1", "t2"]) {
    assert.equal(inserted.filter((r) => r.team_id === t && r.race_role === "captain").length, 1);
  }
});

test("hold MED manager-entries røres ikke; kun det manglende hold fyldes", async () => {
  const state = baseState();
  state.race_entries = [
    { race_id: "race1", rider_id: "t1-r9", team_id: "t1", race_role: "captain", is_auto_filled: false },
    ...[0, 1, 2, 3, 4].map((i) => ({ race_id: "race1", rider_id: `t1-r${i}`, team_id: "t1", race_role: "helper", is_auto_filled: false })),
  ];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: true });
  const t1 = entrants.filter((e) => e.team_id === "t1");
  assert.equal(t1.length, 6, "managerens 6 beholdes uændret");
  assert.equal(t1.find((e) => e.rider_id === "t1-r9").race_role, "captain", "race_role læses med ind i entrants");
  assert.equal(entrants.filter((e) => e.team_id === "t2").length, 8, "t2 autopickes");
});

test("skadede ryttere udelades af autopick; persist=false skriver intet", async () => {
  const state = baseState();
  state.rider_condition = [{ rider_id: "t1-r0", injured_until: "2099-01-01" }];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: false });
  assert.ok(!entrants.some((e) => e.rider_id === "t1-r0"), "skadet topscorer udeladt");
  assert.equal(supabase.__calls.filter((c) => c.table === "race_entries").length, 0, "dry-run: ingen insert");
});

// Rod B (#1742/#1800): sim-tids-autofill må KUN vælge løbs-berettigede ryttere.
// fillMissingTeamEntries manglede is_academy-filteret (kun is_retired).
test("autofill vælger ALDRIG akademiryttere (Rod B)", async () => {
  const state = baseState();
  // Stærkeste rytter på t1 er akademi → ville blive valgt hvis ufiltreret.
  state.riders.push({ id: "t1-academy", team_id: "t1", firstname: "A", lastname: "cad", is_u25: false, is_retired: false, is_academy: true });
  state.rider_derived_abilities.push({ rider_id: "t1-academy", ...ab(99) });
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: false });
  assert.ok(!entrants.some((e) => e.rider_id === "t1-academy"), "akademirytter aldrig autopicket");
});

// #2579: sim-tids-autofill må heller ALDRIG vælge en rytter der er SOLGT men hvis
// holdskifte er parkeret (pending_team_id) pga. et aktivt etapeløb hos dette hold
// (#1995) — team_id peger stadig på holdet i den periode.
test("autofill vælger ALDRIG en solgt-men-parkeret rytter (pending_team_id, #2579)", async () => {
  const state = baseState();
  // Stærkeste rytter på t1 er solgt (afventer flush) → ville blive valgt hvis ufiltreret.
  state.riders.push({ id: "t1-sold-pending", team_id: "t1", firstname: "S", lastname: "old", is_u25: false, is_retired: false, is_academy: false, pending_team_id: "t2" });
  state.rider_derived_abilities.push({ rider_id: "t1-sold-pending", ...ab(99) });
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: false });
  assert.ok(!entrants.some((e) => e.rider_id === "t1-sold-pending"), "solgt-men-parkeret rytter aldrig autopicket");
});

// Rod B: committede ghost-entries (rytter solgt/fyret/blevet akademi/pensioneret EFTER
// udtagelse) skal falde ud af startfeltet — ellers kører en fremmed rytter for et hold
// han ikke længere er på (151 off-team i prod 2026-06-25). Forbrugs-punkt-gyldighed.
test("committede ghost-entries droppes fra startfeltet (Rod B)", async () => {
  const state = baseState();
  // t1 har en manuel lineup, men to af rytterne er nu ghosts:
  //  - t1-sold er solgt til t2 (rytterens nuværende team_id ≠ entry.team_id)
  //  - t1-r5 er blevet akademirytter efter udtagelsen
  state.riders.find((r) => r.id === "t1-r1").team_id = "t2"; // solgt videre
  state.riders.find((r) => r.id === "t1-r5").is_academy = true;
  state.race_entries = [
    { race_id: "race1", rider_id: "t1-r0", team_id: "t1", race_role: "captain", is_auto_filled: false },
    { race_id: "race1", rider_id: "t1-r1", team_id: "t1", race_role: "helper", is_auto_filled: false }, // ghost: solgt
    { race_id: "race1", rider_id: "t1-r5", team_id: "t1", race_role: "helper", is_auto_filled: false }, // ghost: akademi
    { race_id: "race1", rider_id: "t1-r2", team_id: "t1", race_role: "helper", is_auto_filled: false },
  ];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: false });
  const t1Ids = entrants.filter((e) => e.team_id === "t1").map((e) => e.rider_id);
  assert.ok(!t1Ids.includes("t1-r1"), "solgt rytter droppet fra t1's felt");
  assert.ok(!t1Ids.includes("t1-r5"), "akademi-rytter droppet fra t1's felt");
  assert.ok(t1Ids.includes("t1-r0") && t1Ids.includes("t1-r2"), "gyldige ryttere bevaret");
});

test("afmeldt hold autofyldes IKKE", async () => {
  const state = baseState();
  state.race_withdrawals = [{ race_id: "race1", team_id: "t2" }];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: true });
  assert.equal(entrants.filter((e) => e.team_id === "t2").length, 0, "t2 er afmeldt → ingen entries");
  assert.ok(entrants.filter((e) => e.team_id === "t1").length > 0, "t1 fyldes stadig");
});

// #3076 (tredje lag af rod-årsagen i #3070): binding-nøglen game_day er SÆSON-RELATIV og
// nulstilles hver sæson — i prod spænder både S1 og S2 game_day 0..~100000. Uden sæson-
// filter så excludeBoundRiders en forrige-sæsons entry som aktiv binding og udelod
// rytteren fra startfeltet, hvilket giver et for tyndt felt ved sæsonstart.
function bindingState() {
  const state = baseState();
  state.races = [
    { id: "race1", season_id: "s1" },
    { id: "raceOld", season_id: "s0" },  // FORRIGE sæson, samme game_day-rum
    { id: "raceSame", season_id: "s1" }, // samme sæson — skal stadig binde
  ];
  state.race_stage_schedule = [
    { race_id: "race1", scheduled_at: "2026-07-27T18:00:00Z", game_day: 0 },
    { race_id: "race1", scheduled_at: "2026-07-30T18:00:00Z", game_day: 6 },
    { race_id: "raceOld", scheduled_at: "2026-07-01T13:00:00Z", game_day: 4 },
    { race_id: "raceSame", scheduled_at: "2026-07-28T13:00:00Z", game_day: 4 },
  ];
  state.race_withdrawals = [];
  return state;
}

test("#3076: entry fra FORRIGE sæson udelukker ikke rytteren fra autofill", async () => {
  const state = bindingState();
  // t1-r0 er holdets topscorer og er udtaget til et løb i sæson s0 på game_day 4,
  // som overlapper race1's game_day-span 0-6 i det (sæson-relative) nøgle-rum.
  state.race_entries = [
    { race_id: "raceOld", rider_id: "t1-r0", team_id: "t1", race_role: "captain", is_auto_filled: false },
  ];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: false });
  assert.ok(
    entrants.some((e) => e.rider_id === "t1-r0"),
    "rytter bundet i en ANDEN sæson skal være fri til autofill i den nye sæson"
  );
});

test("#3076: entry i SAMME sæson binder stadig (1 rytter = 1 løb pr. in-game løbsdag)", async () => {
  const state = bindingState();
  state.race_entries = [
    { race_id: "raceSame", rider_id: "t1-r0", team_id: "t1", race_role: "captain", is_auto_filled: false },
  ];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: false });
  assert.ok(
    !entrants.some((e) => e.rider_id === "t1-r0"),
    "samme-sæson-binding er uændret: rytteren må ikke dobbeltbookes"
  );
});
