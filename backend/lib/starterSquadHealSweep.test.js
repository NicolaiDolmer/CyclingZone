import test from "node:test";
import assert from "node:assert/strict";

import { runStarterSquadHealSweep, HEAL_MIN_AGE_MS } from "./starterSquadHealSweep.js";

// Mock af teams-tabellen for sweep-queryen:
//   select("id, created_at").is("starter_squad_allocated_at", null).lt("created_at", cutoff).order().range()
function teamsMock(rows) {
  return {
    from(table) {
      assert.equal(table, "teams", "sweep'en queryer kun teams");
      let isNullCol = null;
      let ltCol = null;
      let ltVal = null;
      const b = {
        select() { return b; },
        is(col, val) { if (val === null) isNullCol = col; return b; },
        lt(col, val) { ltCol = col; ltVal = val; return b; },
        order() { return b; },
        range() {
          let out = [...rows];
          if (isNullCol) out = out.filter((r) => r[isNullCol] == null);
          if (ltCol) out = out.filter((r) => r[ltCol] < ltVal);
          return Promise.resolve({ data: out.map((r) => ({ id: r.id, created_at: r.created_at })), error: null });
        },
      };
      return b;
    },
  };
}

test("#1563 sweep: heler markør-NULL hold ældre end alders-guarden, springer friske + markerede over", async () => {
  const now = new Date("2026-06-20T12:00:00Z");
  const old = new Date(now.getTime() - 10 * 60 * 1000).toISOString();   // 10 min — ældre end guarden
  const fresh = new Date(now.getTime() - 1 * 60 * 1000).toISOString();  // 1 min — for nyt (in-flight signup)
  const rows = [
    { id: "stuck-old", created_at: old, starter_squad_allocated_at: null },
    { id: "fresh", created_at: fresh, starter_squad_allocated_at: null },
    { id: "ok", created_at: old, starter_squad_allocated_at: "2026-06-19T00:00:00Z" },
  ];
  const calls = [];
  const allocate = async (_sb, id) => { calls.push(id); return { teamId: id, assigned: 8 }; };

  const res = await runStarterSquadHealSweep({ supabase: teamsMock(rows), now, allocate });

  assert.deepEqual(calls, ["stuck-old"], "kun det gamle markør-NULL hold heales");
  assert.equal(res.candidates, 1);
  assert.equal(res.healed, 1);
  assert.equal(res.failed, 0);
});

test("#1563 sweep: alders-guarden bruger HEAL_MIN_AGE_MS", () => {
  assert.equal(HEAL_MIN_AGE_MS, 5 * 60 * 1000);
});

test("#1563 sweep: per-team fejl isoleres (én fejler, resten heales)", async () => {
  const now = new Date("2026-06-20T12:00:00Z");
  const old = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const rows = [
    { id: "a", created_at: old, starter_squad_allocated_at: null },
    { id: "b", created_at: old, starter_squad_allocated_at: null },
  ];
  const allocate = async (_sb, id) => {
    if (id === "a") throw new Error("derive nede");
    return { teamId: id, assigned: 8 };
  };

  const res = await runStarterSquadHealSweep({ supabase: teamsMock(rows), now, allocate });

  assert.equal(res.candidates, 2);
  assert.equal(res.healed, 1, "b blev healet trods a's fejl");
  assert.equal(res.failed, 1);
  assert.equal(res.errors[0].teamId, "a");
});

test("#1563 sweep: et hold der allerede er markeret (skipped) tæller ikke som healed", async () => {
  const now = new Date("2026-06-20T12:00:00Z");
  const old = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const rows = [{ id: "raced", created_at: old, starter_squad_allocated_at: null }];
  // allocate returnerer skipped (markør nået mellem query og kald).
  const allocate = async (_sb, id) => ({ teamId: id, skipped: "already-allocated", assigned: 0 });

  const res = await runStarterSquadHealSweep({ supabase: teamsMock(rows), now, allocate });

  assert.equal(res.candidates, 1);
  assert.equal(res.healed, 0, "skipped (ingen reel allokering) tæller ikke som heal");
  assert.equal(res.failed, 0);
});
