import test from "node:test";
import assert from "node:assert/strict";

import { runAcademyGraduationSweep } from "./academyGraduationSweep.js";
import { runMissedGraduateSweep } from "./missedGraduateSweep.js";

// 20:30Z i juni = 22:30 CEST → efter sweep-vinduet (kl. 22 dansk tid).
const AFTER_WINDOW = new Date("2026-06-20T20:30:00Z");
// 03:00Z i juni = 05:00 CEST → før vinduet.
const BEFORE_WINDOW = new Date("2026-06-20T03:00:00Z");

// #5133: sweepet kører nu backfillen (missedGraduateSweep) som første skridt, og
// den læser riders + auctions via vagtens prædikat. Mocken dækker derfor begge
// tabeller — tom som default, så de eksisterende sweep-tests kører den ÆGTE
// backfill igennem som en no-op i stedet for at stubbe wiringen væk.
function makeSupabase(pendingRows = [], { riders = [], auctions = [] } = {}) {
  const rec = { gradInserts: [] };
  const supabase = {
    from(table) {
      if (table === "seasons") {
        const api = { select() { return api; }, eq() { return api; }, order() { return api; }, limit() { return api; }, maybeSingle() { return Promise.resolve({ data: { id: "s1", number: 1 }, error: null }); } };
        return api;
      }
      if (table === "riders") {
        const filters = [];
        const api = {
          select() { return api; },
          eq(col, val) { filters.push(["eq", col, val]); return api; },
          not(col, op, val) { if (op === "is") filters.push(["not-is", col, val]); return api; },
          order() { return api; },
          range(from, to) {
            const out = riders.filter((r) => filters.every(([op, c, v]) =>
              op === "eq" ? (r[c] ?? false) === v : (r[c] ?? null) !== v
            )).slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return api;
      }
      if (table === "auctions") {
        const inFilters = [];
        const api = {
          select() { return api; },
          in(col, vals) { inFilters.push([col, vals]); return api; },
          order() { return api; },
          range(from, to) {
            const out = auctions.filter((a) => inFilters.every(([c, v]) => v.includes(a[c]))).slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return api;
      }
      if (table === "academy_graduation") {
        // Backfillen læser med .in("rider_id", …) (vagtens prædikat), det
        // eksisterende sweep med .eq("status","pending"). Mocken skelner på
        // hvilket filter der blev sat.
        const inFilters = [];
        let isPendingQuery = false;
        const api = {
          select() { return api; },
          eq(col, val) { if (col === "status" && val === "pending") isPendingQuery = true; return api; },
          in(col, vals) { inFilters.push([col, vals]); return api; },
          order() { return api; },
          range(from, to) {
            if (isPendingQuery) return Promise.resolve({ data: pendingRows.slice(from, to + 1), error: null });
            const out = pendingRows
              .filter((g) => inFilters.every(([c, v]) => v.includes(g[c])))
              .slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
          insert(row) { rec.gradInserts.push(row); return Promise.resolve({ error: null }); },
        };
        return api;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  supabase.rec = rec;
  return supabase;
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

// ─── #5133: backfillen kører som en del af sweepet ─────────────────────────────

// ageForSeason(birthdate, 1) = 2026 − fødselsår (mocken har aktiv sæson 1).
const MISSED_RIDER = {
  id: "r-missed", team_id: "t9", ai_team_id: null,
  firstname: "Missed", lastname: "Graduate",
  is_academy: true, is_retired: false, birthdate: "2004-10-25",
};

function backfillWithSpyNotify(notify) {
  return (args) => runMissedGraduateSweep({ ...args, notify });
}

test("#5133 sweep: åbner override-vinduet for en rytter der aldrig fik et", async () => {
  const supabase = makeSupabase([], { riders: [MISSED_RIDER] });
  const notified = [];
  const res = await runAcademyGraduationSweep({
    supabase, now: AFTER_WINDOW, isEnabled: async () => true,
    resolveFn: async () => { throw new Error("må ikke resolveres i samme kørsel"); },
    backfillFn: backfillWithSpyNotify(async (p) => { notified.push(p); }),
  });

  assert.equal(res.backfill.created, 1);
  assert.equal(supabase.rec.gradInserts.length, 1);
  assert.equal(supabase.rec.gradInserts[0].rider_id, "r-missed");
  assert.equal(supabase.rec.gradInserts[0].status, "pending");
  assert.equal(notified.length, 1);
  // Den nyoprettede række har deadline i fremtiden og må IKKE auto-resolveres i
  // samme kørsel — manageren skal have sit fulde valg først.
  assert.equal(res.resolved, 0);
  assert.equal(res.failed, 0);
});

test("#5133 sweep: en fejlende backfill blokerer IKKE auto-resolveringen", async () => {
  const pending = [{ team_id: "t1", rider_id: "expired", deadline: "2026-06-19T10:00:00Z" }];
  const resolvedIds = [];
  const res = await runAcademyGraduationSweep({
    supabase: makeSupabase(pending), now: AFTER_WINDOW, isEnabled: async () => true,
    resolveFn: async (_s, { riderId }) => { resolvedIds.push(riderId); return { riderId }; },
    backfillFn: async () => { throw new Error("supabase nede"); },
  });
  assert.match(res.backfill.error, /supabase nede/);
  assert.equal(res.resolved, 1, "det udløbne vindue bliver stadig resolveret");
  assert.deepEqual(resolvedIds, ["expired"]);
});

test("#5133 sweep: ingen missede ryttere → backfillen er en no-op", async () => {
  const supabase = makeSupabase([], { riders: [] });
  const res = await runAcademyGraduationSweep({ supabase, now: AFTER_WINDOW, isEnabled: async () => true });
  assert.equal(res.backfill.created, 0);
  assert.equal(supabase.rec.gradInserts.length, 0);
});
