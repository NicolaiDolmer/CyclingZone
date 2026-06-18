import test from "node:test";
import assert from "node:assert/strict";

import { runAcademyGraduationSweep } from "./academyGraduationSweep.js";

// 20:30Z i juni = 22:30 CEST → efter sweep-vinduet (kl. 22 dansk tid).
const AFTER_WINDOW = new Date("2026-06-20T20:30:00Z");
// 03:00Z i juni = 05:00 CEST → før vinduet.
const BEFORE_WINDOW = new Date("2026-06-20T03:00:00Z");

function makeSupabase(pendingRows = []) {
  return {
    from(table) {
      if (table === "seasons") {
        const api = { select() { return api; }, eq() { return api; }, maybeSingle() { return Promise.resolve({ data: { id: "s1", number: 1 }, error: null }); } };
        return api;
      }
      if (table === "academy_graduation") {
        const api = { select() { return api; }, eq() { return api; }, order() { return api; }, range() { return Promise.resolve({ data: pendingRows, error: null }); } };
        return api;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("sweep: før kl. 22 dansk tid → skip", async () => {
  const res = await runAcademyGraduationSweep({ supabase: makeSupabase(), now: BEFORE_WINDOW, isEnabled: async () => true });
  assert.equal(res.skipped, "before_window");
});

test("sweep: flag OFF → skip", async () => {
  const res = await runAcademyGraduationSweep({ supabase: makeSupabase(), now: AFTER_WINDOW, isEnabled: async () => false });
  assert.equal(res.skipped, "flag_off");
});

test("sweep: resolver kun pending med passeret deadline", async () => {
  const pending = [
    { team_id: "t1", rider_id: "expired", deadline: "2026-06-19T10:00:00Z" },  // i fortiden
    { team_id: "t2", rider_id: "future", deadline: "2026-06-25T10:00:00Z" },   // i fremtiden
  ];
  const resolvedIds = [];
  const resolveFn = async (_s, { riderId }) => { resolvedIds.push(riderId); return { riderId, action: "promoted" }; };
  const res = await runAcademyGraduationSweep({ supabase: makeSupabase(pending), now: AFTER_WINDOW, isEnabled: async () => true, resolveFn });
  assert.equal(res.resolved, 1);
  assert.deepEqual(resolvedIds, ["expired"]);
});

test("sweep: per-rytter fejl isoleres (failed tælles, fortsætter)", async () => {
  const pending = [
    { team_id: "t1", rider_id: "boom", deadline: "2026-06-19T10:00:00Z" },
    { team_id: "t2", rider_id: "ok", deadline: "2026-06-19T10:00:00Z" },
  ];
  const resolveFn = async (_s, { riderId }) => { if (riderId === "boom") throw new Error("kaboom"); return { riderId }; };
  const res = await runAcademyGraduationSweep({ supabase: makeSupabase(pending), now: AFTER_WINDOW, isEnabled: async () => true, resolveFn });
  assert.equal(res.resolved, 1);
  assert.equal(res.failed, 1);
});
