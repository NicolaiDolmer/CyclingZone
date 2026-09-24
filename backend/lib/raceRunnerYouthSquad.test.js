// backend/lib/raceRunnerYouthSquad.test.js
// #5645 (Y4, epic #2492): race-tids-autofyld og startfelt for ungdomsløb.
//   - Et U23-løb fyldes kun med U23-ryttere fra hold i løbets U23-pulje (aldrig seniorer).
//   - Et juniorløb fylder kun med juniorer fra sæsonalder 17.
//   - Committede entries krydses mod LØBETS trup (en senior i et U23-løb er en ghost).
//   - resolveRaceSquad: løbets trup slås op når race-objektet ikke bærer den.
// Mock-builderen følger raceRunnerAutofill.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { loadEntrantsForRace, resolveRaceSquad } from "./raceRunner.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});

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
  // riders.squad er NOT NULL DEFAULT 'senior' — en fixture uden feltet er en senior.
  function rowsFor(table) {
    const rows = [...(state[table] || [])];
    if (table !== "riders") return rows;
    return rows.map((r) => (r.squad === undefined ? { ...r, squad: "senior" } : r));
  }
  function builder(table) {
    const q = { table, filters: [] };
    const api = {
      select() { return api; },
      eq(col, val) { q.filters.push(["eq", col, val]); return api; },
      neq(col, val) { q.filters.push(["neq", col, val]); return api; },
      maybeSingle() {
        const rows = applyFilters(rowsFor(table), q.filters);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      single() {
        const rows = applyFilters(rowsFor(table), q.filters);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      in(col, vals) { q.filters.push(["in", col, vals]); return api; },
      or() { return api; },
      is(col, val) { q.filters.push(["is", col, val]); return api; },
      gte(col, val) { q.filters.push(["gte", col, val]); return api; },
      order() { return api; },
      limit() { return api; },
      range(from, to) {
        const rows = applyFilters(rowsFor(table), q.filters);
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
      insert(rowsArg) {
        const rows = Array.isArray(rowsArg) ? rowsArg : [rowsArg];
        calls.push({ table, insert: rows });
        state[table] = [...(state[table] || []), ...rows];
        return Promise.resolve({ error: null });
      },
      then(resolve) {
        const rows = applyFilters(rowsFor(table), q.filters);
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }
  return { from: (t) => builder(t), __calls: calls };
}

const stages = [{ stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } }];

function addRiders(state, teamId, squad, count, { prefix = squad, birthdate = null, strength = 80 } = {}) {
  for (let i = 0; i < count; i++) {
    const id = `${teamId}-${prefix}${i}`;
    state.riders.push({
      id, team_id: teamId, firstname: "A", lastname: id, is_u25: false, is_retired: false,
      is_academy: squad !== "senior", squad, birthdate,
    });
    state.rider_derived_abilities.push({ rider_id: id, ...ab(strength - i) });
  }
}

function youthState() {
  const state = {
    seasons: [{ id: "s1", number: 4 }], // referenceår 2029
    teams: [
      { id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1, u23_league_division_id: 10, junior_league_division_id: 20 },
      { id: "t2", is_test_account: false, is_frozen: false, league_division_id: 1, u23_league_division_id: null, junior_league_division_id: null },
      { id: "t3", is_test_account: false, is_frozen: false, league_division_id: 1, u23_league_division_id: 11, junior_league_division_id: 21 },
    ],
    riders: [], race_entries: [], rider_condition: [], rider_derived_abilities: [],
  };
  for (const t of ["t1", "t2", "t3"]) {
    // Seniorerne er de stærkeste: en trup-blind autofyld ville vælge dem.
    addRiders(state, t, "senior", 10, { strength: 99 });
    addRiders(state, t, "u23", 8);
  }
  return state;
}

test("#5645 autofyld: U23-løb fyldes kun med U23-ryttere fra hold i løbets U23-pulje", async () => {
  const state = youthState();
  const race = { id: "raceU", race_type: "single", season_id: "s1", league_division_id: 10, squad: "u23" };
  const entrants = await loadEntrantsForRace({ supabase: makeSupabase(state), race, stages, persist: false });
  assert.ok(entrants.length > 0, "U23-feltet blev fyldt");
  const riderById = new Map(state.riders.map((r) => [r.id, r]));
  for (const e of entrants) {
    assert.equal(e.team_id, "t1", `hold ${e.team_id} er ikke i U23-pulje 10`);
    assert.equal(riderById.get(e.rider_id).squad, "u23", `${e.rider_id} er ikke en U23-rytter`);
  }
});

test("#5645 autofyld: seniorløb i samme pulje-id-rum er uændret (kun seniorer, alle tre hold)", async () => {
  const state = youthState();
  const race = { id: "raceS", race_type: "single", season_id: "s1", league_division_id: 1, squad: "senior" };
  const entrants = await loadEntrantsForRace({ supabase: makeSupabase(state), race, stages, persist: false });
  const riderById = new Map(state.riders.map((r) => [r.id, r]));
  assert.deepEqual([...new Set(entrants.map((e) => e.team_id))].sort(), ["t1", "t2", "t3"]);
  for (const e of entrants) assert.equal(riderById.get(e.rider_id).squad, "senior");
});

test("#5645 autofyld: juniorløb fylder truppens juniorer uanset alder — 16-årige autofyldes nu (ejer 24/9)", async () => {
  const state = youthState();
  // Født 2013 = 16 i sæson 4 (stærkest), født 2012 = 17. Ejer 24/9: "kan man være i
  // spillet som 16-årig, kan man også deltage i løb som 16-årig" — aldersgaten på 17
  // er fjernet (raceRunner.js:1465/1444, riderEligibility.js:59), kun trup-medlemskab
  // (squad === "junior") afgør. Begge årgange skal derfor kunne autofyldes.
  addRiders(state, "t1", "junior", 4, { prefix: "j16-", birthdate: "2013-03-01", strength: 99 });
  addRiders(state, "t1", "junior", 8, { prefix: "j17-", birthdate: "2012-03-01", strength: 70 });
  const race = { id: "raceJ", race_type: "single", season_id: "s1", league_division_id: 20, squad: "junior" };
  const entrants = await loadEntrantsForRace({ supabase: makeSupabase(state), race, stages, persist: false });
  assert.ok(entrants.length > 0, "juniorfeltet blev fyldt");
  const riderById = new Map(state.riders.map((r) => [r.id, r]));
  for (const e of entrants) {
    assert.equal(riderById.get(e.rider_id).squad, "junior", `${e.rider_id} er ikke en juniorrytter`);
  }
  assert.ok(
    entrants.some((e) => e.rider_id.startsWith("t1-j16-")),
    "16-årig junior blev ikke autofyldt — aldersgaten ser ud til stadig at være aktiv",
  );
});

test("#5645 startfelt: committede entries krydses mod løbets trup (senior i U23-løb = ghost)", async () => {
  const state = youthState();
  const race = { id: "raceU", race_type: "single", season_id: "s1", league_division_id: 10, squad: "u23" };
  state.race_entries = [
    ...Array.from({ length: 6 }, (_, i) => ({ race_id: "raceU", team_id: "t1", rider_id: `t1-u23${i}`, race_role: i === 0 ? "captain" : "helper" })),
    { race_id: "raceU", team_id: "t1", rider_id: "t1-senior0", race_role: "helper" },
  ];
  const entrants = await loadEntrantsForRace({ supabase: makeSupabase(state), race, stages, persist: false, allowAutofill: false });
  const ids = entrants.map((e) => e.rider_id);
  assert.ok(!ids.includes("t1-senior0"), "seniorrytteren må ikke køre U23-løbet");
  for (let i = 0; i < 6; i++) assert.ok(ids.includes(`t1-u23${i}`), `U23-rytter t1-u23${i} blev tabt`);
});

test("#5645 resolveRaceSquad: bærer race-objektet squad, slås intet op", async () => {
  let queried = false;
  const supabase = { from() { queried = true; throw new Error("ingen opslag forventet"); } };
  const race = { id: "r1", squad: "u23" };
  assert.equal(await resolveRaceSquad({ supabase, race }), race);
  const nullRace = { id: "r2", squad: null };
  assert.equal(await resolveRaceSquad({ supabase, race: nullRace }), nullRace);
  assert.equal(queried, false);
});

test("#5645 resolveRaceSquad: mangler squad, slås den op i races", async () => {
  const state = { races: [{ id: "r1", squad: "junior" }] };
  const resolved = await resolveRaceSquad({ supabase: makeSupabase(state), race: { id: "r1", season_id: "s1" } });
  assert.equal(resolved.squad, "junior");
  assert.equal(resolved.season_id, "s1", "øvrige felter bevares");
});

test("#5645 resolveRaceSquad: 42703 (kolonnen findes ikke) = senior, anden DB-fejl kaster", async () => {
  const withError = (error) => ({
    from() {
      const api = { select: () => api, eq: () => api, maybeSingle: () => Promise.resolve({ data: null, error }) };
      return api;
    },
  });
  const missing = await resolveRaceSquad({
    supabase: withError({ code: "42703", message: 'column races.squad does not exist' }), race: { id: "r1" },
  });
  assert.equal(missing.squad, "senior");
  await assert.rejects(
    () => resolveRaceSquad({ supabase: withError({ code: "57014", message: "statement timeout" }), race: { id: "r1" } }),
    /races\.squad lookup failed/,
  );
});

test("#5645 startfelt: en committet 16-årig junior-entry starter (ejer 24/9: ingen aldersgate for entries)", async () => {
  const state = youthState();
  addRiders(state, "t1", "junior", 1, { prefix: "j16-", birthdate: "2013-03-01" });
  addRiders(state, "t1", "junior", 6, { prefix: "j17-", birthdate: "2012-03-01" });
  const race = { id: "raceJ", race_type: "single", season_id: "s1", league_division_id: 20, squad: "junior" };
  state.race_entries = [
    { race_id: "raceJ", team_id: "t1", rider_id: "t1-j16-0", race_role: "captain" },
    ...Array.from({ length: 6 }, (_, i) => ({ race_id: "raceJ", team_id: "t1", rider_id: `t1-j17-${i}`, race_role: "helper" })),
  ];
  const entrants = await loadEntrantsForRace({ supabase: makeSupabase(state), race, stages, persist: false, allowAutofill: false });
  const ids = entrants.map((e) => e.rider_id);
  assert.ok(ids.includes("t1-j16-0"), "16-årig junior-entry skal starte — trup-medlemskab er hele kravet (ejer 24/9)");
  for (let i = 0; i < 6; i++) assert.ok(ids.includes(`t1-j17-${i}`));
});
