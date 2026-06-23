import test from "node:test";
import assert from "node:assert/strict";
import { withdrawTeam, reinstateTeam, loadWithdrawnTeamIds } from "./raceWithdrawal.js";

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
