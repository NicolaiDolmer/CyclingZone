import test from "node:test";
import assert from "node:assert/strict";

import { runAcademyHealSweep, HEAL_MIN_AGE_MS } from "./academyHealSweep.js";

// Mock af teams-tabellen for sweep-queryen:
//   select("id, created_at").is("academy_intake_seeded_at", null).lt("created_at", cutoff).order().range()
function teamsMock(rows) {
  return {
    from(table) {
      assert.equal(table, "teams", "sweep'en queryer kun teams");
      let isNullCol = null;
      let ltCol = null;
      let ltVal = null;
      const eqFilters = [];
      const b = {
        select() { return b; },
        is(col, val) { if (val === null) isNullCol = col; return b; },
        eq(col, val) { eqFilters.push([col, val]); return b; },
        lt(col, val) { ltCol = col; ltVal = val; return b; },
        order() { return b; },
        range() {
          let out = [...rows];
          if (isNullCol) out = out.filter((r) => r[isNullCol] == null);
          if (ltCol) out = out.filter((r) => r[ltCol] < ltVal);
          // Manglende menneske-flag på en mock-row = false (ikke-AI/bank/frozen/test).
          for (const [col, val] of eqFilters) out = out.filter((r) => (r[col] ?? false) === val);
          return Promise.resolve({ data: out.map((r) => ({ id: r.id, created_at: r.created_at })), error: null });
        },
      };
      return b;
    },
  };
}

test("#1584 sweep: heler kun markør-NULL hold ældre end alders-guarden, springer friske + markerede over", async () => {
  const now = new Date("2026-06-20T12:00:00Z");
  const old = new Date(now.getTime() - 10 * 60 * 1000).toISOString();   // 10 min — ældre end guarden
  const fresh = new Date(now.getTime() - 1 * 60 * 1000).toISOString();  // 1 min — for nyt (in-flight signup)
  const rows = [
    { id: "stuck-old", created_at: old, academy_intake_seeded_at: null },
    { id: "fresh", created_at: fresh, academy_intake_seeded_at: null },
    { id: "ok", created_at: old, academy_intake_seeded_at: "2026-06-19T00:00:00Z" },
  ];
  const calls = [];
  const seedCohort = async (_sb, id) => { calls.push(id); return { teamId: id, candidates: 4 }; };

  const res = await runAcademyHealSweep({ supabase: teamsMock(rows), now, seedCohort });

  assert.deepEqual(calls, ["stuck-old"], "kun det gamle markør-NULL hold heales (NULL-markør-only)");
  assert.equal(res.candidates, 1);
  assert.equal(res.healed, 1);
  assert.equal(res.failed, 0);
});

test("#1584 sweep: springer AI/bank/frozen/test-hold over (akademi er KUN for menneske-managere)", async () => {
  // Forever-relaunch-bug: efter relaunch havde 143 AI-hold academy_intake_seeded_at=NULL,
  // og sweep'en (uden menneske-hold-filter) seedede 564 strandede AI-kuld. Akademi er en
  // menneske-manager-feature (samme diskriminator som academyIntake.js' manager-resolver).
  const now = new Date("2026-06-20T12:00:00Z");
  const old = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const mk = (id, extra) => ({ id, created_at: old, academy_intake_seeded_at: null, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, ...extra });
  const rows = [
    mk("human"),
    mk("ai", { is_ai: true }),
    mk("bank", { is_bank: true }),
    mk("frozen", { is_frozen: true }),
    mk("test", { is_test_account: true }),
  ];
  const calls = [];
  const seedCohort = async (_sb, id) => { calls.push(id); return { teamId: id, candidates: 4 }; };

  const res = await runAcademyHealSweep({ supabase: teamsMock(rows), now, seedCohort });

  assert.deepEqual(calls, ["human"], "kun menneske-hold heales — AI/bank/frozen/test ekskluderet");
  assert.equal(res.candidates, 1);
  assert.equal(res.healed, 1);
});

test("#1584 sweep: alders-guarden bruger HEAL_MIN_AGE_MS", () => {
  assert.equal(HEAL_MIN_AGE_MS, 5 * 60 * 1000);
});

test("#1584 sweep: per-team fejl isoleres (én fejler, resten heales)", async () => {
  const now = new Date("2026-06-20T12:00:00Z");
  const old = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const rows = [
    { id: "a", created_at: old, academy_intake_seeded_at: null },
    { id: "b", created_at: old, academy_intake_seeded_at: null },
  ];
  const seedCohort = async (_sb, id) => {
    if (id === "a") throw new Error("derive nede");
    return { teamId: id, candidates: 4 };
  };

  const res = await runAcademyHealSweep({ supabase: teamsMock(rows), now, seedCohort });

  assert.equal(res.candidates, 2);
  assert.equal(res.healed, 1, "b blev healet trods a's fejl");
  assert.equal(res.failed, 1);
  assert.equal(res.errors[0].teamId, "a");
});

test("#1584 sweep: et hold der allerede er seedet (skipped) tæller ikke som healed", async () => {
  const now = new Date("2026-06-20T12:00:00Z");
  const old = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const rows = [{ id: "raced", created_at: old, academy_intake_seeded_at: null }];
  // seedCohort returnerer skipped (markør nået mellem query og kald) → candidates 0.
  const seedCohort = async (_sb, id) => ({ teamId: id, skipped: "already-seeded", candidates: 0 });

  const res = await runAcademyHealSweep({ supabase: teamsMock(rows), now, seedCohort });

  assert.equal(res.candidates, 1);
  assert.equal(res.healed, 0, "skipped (ingen reel seeding) tæller ikke som heal");
  assert.equal(res.failed, 0);
});
