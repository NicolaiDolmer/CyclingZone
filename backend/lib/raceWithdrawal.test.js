import test from "node:test";
import assert from "node:assert/strict";
import {
  withdrawTeam, reinstateTeam, loadWithdrawnTeamIds,
  loadWithdrawnPairs, loadWithdrawnRaceIdsForTeam, withdrawalKey, findRejoinConflicts,
} from "./raceWithdrawal.js";

function makeSupabase({ rows = [], upsertError = null, deleteError = null } = {}) {
  const calls = [];
  function from(table) {
    const f = {};
    const b = {
      select() { return b; },
      eq(c, v) { f[c] = v; return b; },
      upsert(r, opts) { calls.push({ table, op: "upsert", rows: r, opts }); return Promise.resolve({ error: upsertError }); },
      delete() { f.op = "delete"; return b; },
      then(resolve, reject) {
        if (f.op === "delete") { calls.push({ table, op: "delete", filters: { ...f } }); return Promise.resolve({ error: deleteError }).then(resolve, reject); }
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from, __calls: calls };
}

test("withdrawTeam: upserter (race_id, team_id, reason)", async () => {
  const supabase = makeSupabase();
  await withdrawTeam({ supabase, raceId: "race1", teamId: "t1", reason: "budget" });
  const up = supabase.__calls.find((c) => c.op === "upsert");
  assert.equal(up.table, "race_withdrawals");
  assert.equal(up.rows.race_id, "race1");
  assert.equal(up.rows.team_id, "t1");
  assert.equal(up.rows.withdrawn_reason, "budget");
});

test("withdrawTeam: upsert-fejl kastes", async () => {
  const supabase = makeSupabase({ upsertError: { message: "rls denied" } });
  await assert.rejects(() => withdrawTeam({ supabase, raceId: "r", teamId: "t" }), /rls denied/);
});

test("reinstateTeam: sletter (race_id, team_id)-rækken", async () => {
  const supabase = makeSupabase();
  await reinstateTeam({ supabase, raceId: "race1", teamId: "t1" });
  const del = supabase.__calls.find((c) => c.op === "delete");
  assert.equal(del.table, "race_withdrawals");
  assert.equal(del.filters.race_id, "race1");
  assert.equal(del.filters.team_id, "t1");
});

test("loadWithdrawnTeamIds: returnerer Set af team_id for et løb", async () => {
  const supabase = makeSupabase({ rows: [{ team_id: "t1" }, { team_id: "t2" }] });
  const ids = await loadWithdrawnTeamIds({ supabase, raceId: "race1" });
  assert.ok(ids instanceof Set);
  assert.deepEqual([...ids].sort(), ["t1", "t2"]);
});

// ---------------------------------------------------------------------------
// #5301 — de DELTE opslag. Rod-aarsagen var at hver laeseflade selv afgjorde om
// den ville spoerge om afmeldinger; fire glemte det. Helperne nedenfor er den ENE
// kilde, saa en ny flade arver svaret i stedet for at skulle huske det.
// ---------------------------------------------------------------------------

// Egen stub: loadWithdrawnPairs/-RaceIdsForTeam gaar gennem fetchAllRows(Chunked),
// som kraever .range() — kaeden ovenfor har ingen. Kaldene registreres, saa vi kan
// haevde paa order-kontrakten og ikke kun paa returvaerdien.
function makePagedSupabase(rows, calls = []) {
  return {
    calls,
    from(table) {
      const state = { table, eqs: {}, orders: [], inIds: null };
      const b = {
        select() { return b; },
        in(col, ids) { state.inIds = ids; state.inColumn = col; return b; },
        eq(col, val) { state.eqs[col] = val; return b; },
        order(col) { state.orders.push(col); return b; },
        range(from, to) {
          calls.push({ ...state, from, to });
          const hits = rows.filter((r) => {
            if (state.inIds && !state.inIds.includes(r.race_id)) return false;
            return Object.entries(state.eqs).every(([c, v]) => r[c] === v);
          });
          return Promise.resolve({ data: hits.slice(from, to + 1), error: null });
        },
      };
      return b;
    },
  };
}

const PAIR_ROWS = [
  { race_id: "hedjaz", team_id: "bacon" },
  { race_id: "hedjaz", team_id: "newe" },
  { race_id: "iberica", team_id: "newe" },
];

test("#5301 loadWithdrawnPairs: naegler paa tvaers af hold (divisions-startlisterne)", async () => {
  const pairs = await loadWithdrawnPairs({
    supabase: makePagedSupabase(PAIR_ROWS), raceIds: ["hedjaz", "iberica", "enfer"],
  });
  assert.equal(pairs.size, 3);
  assert.ok(pairs.has(withdrawalKey("hedjaz", "bacon")));
  assert.ok(pairs.has(withdrawalKey("iberica", "newe")));
  assert.ok(!pairs.has(withdrawalKey("enfer", "bacon")), "loeb uden afmeldinger maa ikke dukke op");
});

test("#5301 loadWithdrawnPairs: pagineringen er deterministisk ordnet", async () => {
  const calls = [];
  await loadWithdrawnPairs({ supabase: makePagedSupabase(PAIR_ROWS, calls), raceIds: ["hedjaz"] });
  assert.deepEqual(
    calls[0].orders, ["race_id", "team_id"],
    "PK'en er (race_id, team_id); race_id alene er ikke en total orden over .range()-sider — en tabt raekke her ER #5301 igen"
  );
});

test("#5301 loadWithdrawnRaceIdsForTeam: scopet til ét hold, og andres afmeldinger laekker ikke", async () => {
  const supabase = makePagedSupabase(PAIR_ROWS);
  assert.deepEqual(
    [...await loadWithdrawnRaceIdsForTeam({ supabase, teamId: "newe", raceIds: ["hedjaz", "iberica"] })].sort(),
    ["hedjaz", "iberica"]
  );
  assert.deepEqual(
    [...await loadWithdrawnRaceIdsForTeam({ supabase, teamId: "bacon", raceIds: ["hedjaz", "iberica"] })],
    ["hedjaz"]
  );
});

test("#5301 loadWithdrawnRaceIdsForTeam: raceIds=null giver holdets afmeldinger uscopet", async () => {
  const ids = await loadWithdrawnRaceIdsForTeam({ supabase: makePagedSupabase(PAIR_ROWS), teamId: "newe" });
  assert.deepEqual([...ids].sort(), ["hedjaz", "iberica"]);
});

test("#5301: tomme id-lister rammer slet ikke DB'en", async () => {
  const calls = [];
  const supabase = makePagedSupabase(PAIR_ROWS, calls);
  assert.equal((await loadWithdrawnPairs({ supabase, raceIds: [] })).size, 0);
  assert.equal((await loadWithdrawnPairs({ supabase, raceIds: null })).size, 0);
  assert.equal((await loadWithdrawnRaceIdsForTeam({ supabase, teamId: "t", raceIds: [] })).size, 0);
  assert.equal(calls.length, 0);
});

test("#5301 withdrawalKey: race FOER team, og felterne kan ikke bytte plads ubemaerket", () => {
  assert.equal(withdrawalKey("r1", "t1"), "r1|t1");
  assert.notEqual(withdrawalKey("r1", "t1"), withdrawalKey("t1", "r1"));
});

// ---------------------------------------------------------------------------
// #5301 — gen-deltag-guarden, EKSEKVERET (ikke kilde-scannet).
//
// Reproducerer prod-tilstanden 16/9: Bacon Fraesers meldte fra til Tour du Hedjaz
// (dag 55-57) med 5 bevarede entries, og satte derefter tre af de samme ryttere i
// L'Enfer du Nord (dag 55). Det er LOVLIGT, saa laenge Hedjaz er afmeldt - men
// fjernes afmeldingen, genberegner trg_race_withdrawals_resync_binding
// binding_span paa de bevarede entries, og exclusion-constrainten afviser med en
// raa Postgres-fejl. Guarden skal fange det FOER sletningen og navngive begge dele.
// ---------------------------------------------------------------------------

const HEDJAZ = { id: "hedjaz", season_id: "s3" };

// Stub for loadTeamBindingContext's kaedeform: .select().eq()/.in()/.neq() der
// afventes direkte (ingen .range()). `tables` er rene raekke-arrays.
function makeBindingSupabase(tables, { entriesError = null } = {}) {
  return {
    from(table) {
      const f = { table, eqs: {}, ins: {}, neqs: {} };
      const b = {
        select() { return b; },
        eq(c, v) { f.eqs[c] = v; return b; },
        in(c, v) { f.ins[c] = v; return b; },
        neq(c, v) { f.neqs[c] = v; return b; },
        then(resolve, reject) {
          if (table === "race_entries" && entriesError) {
            return Promise.resolve({ data: null, error: entriesError }).then(resolve, reject);
          }
          const rows = (tables[table] || []).filter((r) => {
            for (const [c, v] of Object.entries(f.eqs)) if (r[c] !== v) return false;
            for (const [c, v] of Object.entries(f.ins)) if (!v.includes(r[c])) return false;
            for (const [c, v] of Object.entries(f.neqs)) if (r[c] === v) return false;
            return true;
          });
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return b;
    },
  };
}

// Feltet der genskaber prod: Dekker + Sandberg er i BEGGE loeb, Haddad kun i Hedjaz.
const REJOIN_TABLES = {
  race_entries: [
    { race_id: "hedjaz", team_id: "bacon", rider_id: "dekker" },
    { race_id: "hedjaz", team_id: "bacon", rider_id: "sandberg" },
    { race_id: "hedjaz", team_id: "bacon", rider_id: "haddad" },
    { race_id: "enfer", team_id: "bacon", rider_id: "dekker" },
    { race_id: "enfer", team_id: "bacon", rider_id: "sandberg" },
  ],
  race_withdrawals: [{ race_id: "hedjaz", team_id: "bacon" }],
  races: [
    { id: "hedjaz", season_id: "s3", name: "Tour du Hedjaz" },
    { id: "enfer", season_id: "s3", name: "L'Enfer du Nord" },
  ],
  race_stage_schedule: [
    { race_id: "hedjaz", scheduled_at: "2026-09-16T17:00:00Z", game_day: 55 },
    { race_id: "hedjaz", scheduled_at: "2026-09-18T15:00:00Z", game_day: 57 },
    { race_id: "enfer", scheduled_at: "2026-09-17T13:00:00Z", game_day: 55 },
  ],
  riders: [
    { id: "dekker", firstname: "Joris", lastname: "Dekker", team_id: "bacon" },
    { id: "sandberg", firstname: "Henrik", lastname: "Sandberg", team_id: "bacon" },
    { id: "haddad", firstname: "Ismail", lastname: "Haddad", team_id: "bacon" },
  ],
};

test("#5301 findRejoinConflicts: fanger dobbeltbookingen og NAVNGIVER rytter + loeb", async () => {
  const conflicts = await findRejoinConflicts({
    supabase: makeBindingSupabase(REJOIN_TABLES), race: HEDJAZ, teamId: "bacon",
  });
  const byRider = new Map(conflicts.map((c) => [c.rider_id, c]));
  assert.deepEqual([...byRider.keys()].sort(), ["dekker", "sandberg"],
    "kun de ryttere der ogsaa koerer det overlappende loeb");
  assert.equal(byRider.get("dekker").rider_name, "Joris Dekker");
  assert.equal(byRider.get("dekker").bound_race_id, "enfer");
  assert.equal(byRider.get("dekker").bound_race_name, "L'Enfer du Nord");
  assert.ok(!byRider.has("haddad"), "Haddad koerer kun Hedjaz - han binder ikke");
});

test("#5301 findRejoinConflicts: intet overlap -> gen-deltag er frit", async () => {
  const tables = structuredClone(REJOIN_TABLES);
  // Flyt L'Enfer vaek fra Hedjaz' spaend (dag 55-57).
  tables.race_stage_schedule = tables.race_stage_schedule.map((r) =>
    r.race_id === "enfer" ? { ...r, game_day: 70 } : r);
  const conflicts = await findRejoinConflicts({
    supabase: makeBindingSupabase(tables), race: HEDJAZ, teamId: "bacon",
  });
  assert.deepEqual(conflicts, []);
});

test("#5301 findRejoinConflicts: ingen bevarede entries -> intet at kollidere med", async () => {
  const tables = structuredClone(REJOIN_TABLES);
  tables.race_entries = tables.race_entries.filter((e) => e.race_id !== "hedjaz");
  const conflicts = await findRejoinConflicts({
    supabase: makeBindingSupabase(tables), race: HEDJAZ, teamId: "bacon",
  });
  assert.deepEqual(conflicts, [], "knud_r_flink-formen: afmeldt UDEN bevaret opstilling");
});

test("#5301 findRejoinConflicts: et ANDET holds entries binder ikke", async () => {
  const tables = structuredClone(REJOIN_TABLES);
  tables.race_entries = tables.race_entries.map((e) =>
    e.race_id === "enfer" ? { ...e, team_id: "andet-hold" } : e);
  const conflicts = await findRejoinConflicts({
    supabase: makeBindingSupabase(tables), race: HEDJAZ, teamId: "bacon",
  });
  assert.deepEqual(conflicts, []);
});

test("#5301 findRejoinConflicts: et ANDET afmeldt loeb binder heller ikke (Rod A/#1823)", async () => {
  const tables = structuredClone(REJOIN_TABLES);
  tables.race_withdrawals = [
    { race_id: "hedjaz", team_id: "bacon" },
    { race_id: "enfer", team_id: "bacon" }, // ogsaa afmeldt
  ];
  const conflicts = await findRejoinConflicts({
    supabase: makeBindingSupabase(tables), race: HEDJAZ, teamId: "bacon",
  });
  assert.deepEqual(conflicts, [], "to afmeldte loeb kan ikke binde hinanden");
});

test("#5301 findRejoinConflicts: en ANDEN saesons loeb binder ikke (#3070)", async () => {
  const tables = structuredClone(REJOIN_TABLES);
  tables.races = tables.races.map((r) => (r.id === "enfer" ? { ...r, season_id: "s2" } : r));
  const conflicts = await findRejoinConflicts({
    supabase: makeBindingSupabase(tables), race: HEDJAZ, teamId: "bacon",
  });
  assert.deepEqual(conflicts, [], "game_day er saeson-relativ - s2 og s3 deler tal");
});

test("#5301 findRejoinConflicts: race uden id er en no-op, ikke et kald", async () => {
  assert.deepEqual(await findRejoinConflicts({ supabase: null, race: null, teamId: "bacon" }), []);
  assert.deepEqual(await findRejoinConflicts({ supabase: null, race: {}, teamId: "bacon" }), []);
});

test("#5301 findRejoinConflicts: en DB-fejl kastes, den slugges ikke", async () => {
  const supabase = makeBindingSupabase(REJOIN_TABLES, { entriesError: { message: "rls denied" } });
  await assert.rejects(
    () => findRejoinConflicts({ supabase, race: HEDJAZ, teamId: "bacon" }),
    /race_entries \(rejoin\): rls denied/,
    "en tavs fejl her ville lade gen-deltag fortsaette ind i constraint-fejlen"
  );
});
