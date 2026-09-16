import test from "node:test";
import assert from "node:assert/strict";
import {
  withdrawTeam, reinstateTeam, loadWithdrawnTeamIds,
  loadWithdrawnPairs, loadWithdrawnRaceIdsForTeam, withdrawalKey,
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
