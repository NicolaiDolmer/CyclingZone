import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_AUCTION_CONFIG } from "./auctionEngine.js";
import {
  GRADUATION,
  isGraduateAge,
  detectGraduates,
  resolveGraduation,
  defaultResolveGraduate,
} from "./academyGraduation.js";

// ─── Mock-supabase ─────────────────────────────────────────────────────────────
// Dækker queries academyGraduation bruger: riders (fetchAllRows-list + maybeSingle
// + update), academy_graduation (fetchAllRows-list + maybeSingle + insert + update),
// auctions (insert). notify injiceres som spy (ingen notifikations-DB-queries).

function makeSupabase(cfg = {}) {
  const rec = { gradInserts: [], gradUpdates: [], riderUpdates: [], auctionInserts: [] };
  const supabase = {
    from(table) {
      if (table === "riders") {
        return {
          select() {
            const api = {
              eq() { return api; },
              order() { return api; },
              range() { return Promise.resolve({ data: cfg.academyRiders || [], error: null }); },
              maybeSingle() { return Promise.resolve({ data: cfg.rider ?? null, error: null }); },
            };
            return api;
          },
          update(payload) {
            return { eq() { rec.riderUpdates.push(payload); return Promise.resolve({ error: null }); } };
          },
        };
      }
      if (table === "academy_graduation") {
        return {
          select() {
            const api = {
              eq() { return api; },
              order() { return api; },
              range() {
                return Promise.resolve({ data: (cfg.existingGradRiderIds || []).map((rider_id) => ({ rider_id })), error: null });
              },
              maybeSingle() { return Promise.resolve({ data: cfg.gradRow ?? null, error: null }); },
            };
            return api;
          },
          insert(row) { rec.gradInserts.push(row); return Promise.resolve({ error: null }); },
          update(payload) {
            return { eq() { rec.gradUpdates.push(payload); return Promise.resolve({ error: null }); } };
          },
        };
      }
      if (table === "auctions") {
        return { insert(row) { rec.auctionInserts.push(row); return Promise.resolve({ error: null }); } };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { supabase, rec };
}

function spyNotify() {
  const calls = [];
  const fn = async (payload) => { calls.push(payload); };
  fn.calls = calls;
  return fn;
}

// birthdate så ageForSeason(birthdate, 1) = 2026 + 0 - birthYear giver ønsket alder.
const bornForAge = (age) => `${2026 - age}-06-15`;

// ─── konstanter + helper ────────────────────────────────────────────────────────

test("GRADUATION-konstanter", () => {
  assert.equal(GRADUATION.GRADUATE_AGE, 22);
  assert.ok(GRADUATION.DEADLINE_DAYS >= 1, "override-vindue mindst 1 dag");
});

test("isGraduateAge: 22+ er graduate, 21 og under er ikke", () => {
  assert.equal(isGraduateAge(21), false);
  assert.equal(isGraduateAge(22), true);
  assert.equal(isGraduateAge(25), true);
  assert.equal(isGraduateAge(null), false);
});

// ─── detectGraduates ──────────────────────────────────────────────────────────

test("detectGraduates: opretter pending-row for 22-årig, ignorerer 19-årig", async () => {
  const { supabase, rec } = makeSupabase({
    academyRiders: [
      { id: "r22", team_id: "t1", firstname: "Old", lastname: "Enough", birthdate: bornForAge(22) },
      { id: "r19", team_id: "t1", firstname: "Still", lastname: "Young", birthdate: bornForAge(19) },
    ],
  });
  const notify = spyNotify();
  const res = await detectGraduates(supabase, { seasonId: "s1", seasonNumber: 1, now: new Date("2026-06-20T10:00:00Z"), notify });
  assert.equal(res.graduates, 1);
  assert.equal(rec.gradInserts.length, 1);
  assert.equal(rec.gradInserts[0].rider_id, "r22");
  assert.equal(rec.gradInserts[0].status, "pending");
  assert.ok(rec.gradInserts[0].deadline, "deadline sat");
  assert.equal(notify.calls.length, 1);
  assert.equal(notify.calls[0].type, "academy_graduation_ready");
});

test("detectGraduates: idempotent — rytter med eksisterende grad-row skippes", async () => {
  const { supabase, rec } = makeSupabase({
    academyRiders: [{ id: "r22", team_id: "t1", firstname: "Old", lastname: "Enough", birthdate: bornForAge(22) }],
    existingGradRiderIds: ["r22"],
  });
  const res = await detectGraduates(supabase, { seasonId: "s1", seasonNumber: 1, notify: spyNotify() });
  assert.equal(res.graduates, 0);
  assert.equal(rec.gradInserts.length, 0);
});

test("detectGraduates (dryRun): tæller uden writes", async () => {
  const { supabase, rec } = makeSupabase({
    academyRiders: [{ id: "r22", team_id: "t1", firstname: "Old", lastname: "Enough", birthdate: bornForAge(22) }],
  });
  const notify = spyNotify();
  const res = await detectGraduates(supabase, { seasonId: "s1", seasonNumber: 1, dryRun: true, notify });
  assert.equal(res.dryRun, true);
  assert.equal(res.graduates, 1);
  assert.equal(rec.gradInserts.length, 0);
  assert.equal(notify.calls.length, 0);
});

// ─── resolveGraduation ────────────────────────────────────────────────────────

const PENDING_GRAD = { id: "g1", status: "pending" };
const RIDER = { id: "r1", team_id: "t1", firstname: "Grad", lastname: "Uate", base_value: 100000, prize_earnings_bonus: 0, market_value: 100000, salary: 500 };

test("resolveGraduation promote: is_academy=false + ny senior-løn; grad promoted; notify", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const notify = spyNotify();
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "promote", seasonNumber: 1, getMarketState, notify });
  assert.equal(res.action, "promoted");
  assert.equal(rec.riderUpdates.length, 1);
  assert.equal(rec.riderUpdates[0].is_academy, false);
  assert.ok(rec.riderUpdates[0].salary > 0, "ny senior-løn sat");
  assert.ok(rec.riderUpdates[0].salary !== RIDER.salary, "overskriver arvet akademi-løn");
  assert.equal(rec.gradUpdates[0].status, "promoted");
  assert.equal(notify.calls[0].type, "academy_graduated");
});

test("resolveGraduation promote: afviser ved fuld senior-trup", async () => {
  const { supabase } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 30, balance: 5000 });
  await assert.rejects(
    () => resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "promote", seasonNumber: 1, getMarketState, notify: spyNotify() }),
    /squad_cap_violation/,
  );
});

test("resolveGraduation sell: opretter senior-auktion (seller=hold, is_youth=false); grad sold", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const res = await resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "sell", seasonNumber: 1, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify() });
  assert.equal(res.action, "sold");
  assert.equal(rec.auctionInserts.length, 1);
  assert.equal(rec.auctionInserts[0].seller_team_id, "t1");
  assert.equal(rec.auctionInserts[0].is_youth, false);
  assert.equal(rec.gradUpdates[0].status, "sold");
});

test("resolveGraduation release: free agent (team_id=NULL, is_academy=false); grad released", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const res = await resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "release", seasonNumber: 1, notify: spyNotify() });
  assert.equal(res.action, "released");
  assert.equal(rec.riderUpdates[0].team_id, null);
  assert.equal(rec.riderUpdates[0].is_academy, false);
  assert.equal(rec.gradUpdates[0].status, "released");
});

test("resolveGraduation: afviser hvis ingen pending grad-row", async () => {
  const { supabase } = makeSupabase({ gradRow: null, rider: RIDER });
  await assert.rejects(
    () => resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "promote", seasonNumber: 1, notify: spyNotify() }),
    /not_pending/,
  );
});

test("resolveGraduation: afviser ugyldig action", async () => {
  const { supabase } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  await assert.rejects(
    () => resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "bogus", seasonNumber: 1, notify: spyNotify() }),
    /invalid_action/,
  );
});

// ─── defaultResolveGraduate ───────────────────────────────────────────────────

test("defaultResolveGraduate: promover når plads + solvent", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await defaultResolveGraduate(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, notify: spyNotify() });
  assert.equal(res.action, "promoted");
  assert.equal(rec.riderUpdates[0].is_academy, false);
});

test("defaultResolveGraduate: sælger når trup fuld", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 30, balance: 5000 });
  const res = await defaultResolveGraduate(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify() });
  assert.equal(res.action, "sold");
  assert.equal(rec.auctionInserts.length, 1);
});

test("defaultResolveGraduate: sælger når hold i gæld (konservativ auto-default)", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: -2000 });
  const res = await defaultResolveGraduate(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify() });
  assert.equal(res.action, "sold");
});
