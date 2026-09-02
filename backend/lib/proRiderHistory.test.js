import test from "node:test";
import assert from "node:assert/strict";
import { createProRiderHistoryHandler } from "./proRiderHistory.js";

// #4649: fake supabase — subscriptions (isPro-opslag) + rider_derived_ability_history.
function fakeSupabase({ sub = null, subError = null, historyRows = [], historyError = null } = {}) {
  return {
    from(table) {
      if (table === "subscriptions") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: () => Promise.resolve({ data: sub, error: subError }),
        };
      }
      if (table === "rider_derived_ability_history") {
        return {
          select() { return this; },
          eq() { return this; },
          order: () => Promise.resolve({ data: historyRows, error: historyError }),
        };
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

function res() {
  return { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test("proRiderHistory: intet team → 400", async () => {
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase() });
  const r = res();
  await handler({ team: null, params: {} }, r);
  assert.equal(r.code, 400);
});

test("proRiderHistory: ikke Pro (ingen subscription) → 403 pro_required, ingen historik-kald", async () => {
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub: null }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.equal(r.code, 403);
  assert.equal(r.body.errorCode, "pro_required");
});

test("proRiderHistory: udløbet abonnement (status inactive) → 403 pro_required", async () => {
  const sub = { status: "inactive", current_period_end: "2020-01-01T00:00:00Z", is_founder: false };
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.equal(r.code, 403);
});

test("proRiderHistory: aktivt abonnement → 200, dedupet én række pr. sæson (seneste vinder)", async () => {
  const sub = { status: "active", current_period_end: "2099-01-01T00:00:00Z", is_founder: false };
  const historyRows = [
    { snapshot_date: "2026-01-01", season_number: 1, abilities: { climbing: 40 } },
    { snapshot_date: "2026-03-01", season_number: 1, abilities: { climbing: 45 } }, // sæson 1's seneste
    { snapshot_date: "2026-06-01", season_number: 2, abilities: { climbing: 52 } },
  ];
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub, historyRows }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.equal(r.code, 0); // res() ikke eksplicit sat 200 — handler bruger json() uden status()
  assert.equal(r.body.abilityCeiling, 99);
  assert.deepEqual(r.body.seasons, [
    { season_number: 1, abilities: { climbing: 45 } },
    { season_number: 2, abilities: { climbing: 52 } },
  ]);
});

test("proRiderHistory: Founder uden aktivt abonnement er alligevel Pro (permanent status)", async () => {
  const sub = { status: "inactive", current_period_end: null, is_founder: true };
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub, historyRows: [] }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.equal(r.body.errorCode, undefined);
  assert.deepEqual(r.body.seasons, []);
});
