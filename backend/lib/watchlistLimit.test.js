import test from "node:test";
import assert from "node:assert/strict";
import { createWatchlistLimitHandler, WATCHLIST_FREE_CAP, WATCHLIST_PRO_CAP } from "./watchlistLimit.js";

function fakeSupabase({ sub = null, subError = null, count = 0, countError = null } = {}) {
  return {
    from(table) {
      if (table === "subscriptions") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: () => Promise.resolve({ data: sub, error: subError }),
        };
      }
      if (table === "rider_watchlist") {
        return {
          select() { return this; },
          eq: () => Promise.resolve({ count, error: countError }),
        };
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

function res() {
  return { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test("watchlistLimit: intet team → 400", async () => {
  const handler = createWatchlistLimitHandler({ supabase: fakeSupabase() });
  const r = res();
  await handler({ team: null, user: { id: "u1" } }, r);
  assert.equal(r.code, 400);
});

test("watchlistLimit: fri spiller får WATCHLIST_FREE_CAP", async () => {
  const handler = createWatchlistLimitHandler({ supabase: fakeSupabase({ sub: null, count: 5 }) });
  const r = res();
  await handler({ team: { id: "t1" }, user: { id: "u1" } }, r);
  assert.deepEqual(r.body, { count: 5, cap: WATCHLIST_FREE_CAP, isPro: false });
});

test("watchlistLimit: aktivt abonnement → WATCHLIST_PRO_CAP", async () => {
  const sub = { status: "active", current_period_end: "2099-01-01T00:00:00Z", is_founder: false };
  const handler = createWatchlistLimitHandler({ supabase: fakeSupabase({ sub, count: 30 }) });
  const r = res();
  await handler({ team: { id: "t1" }, user: { id: "u1" } }, r);
  assert.deepEqual(r.body, { count: 30, cap: WATCHLIST_PRO_CAP, isPro: true });
});

test("watchlistLimit: Founder uden aktivt abonnement får alligevel WATCHLIST_PRO_CAP", async () => {
  const sub = { status: "inactive", current_period_end: null, is_founder: true };
  const handler = createWatchlistLimitHandler({ supabase: fakeSupabase({ sub, count: 12 }) });
  const r = res();
  await handler({ team: { id: "t1" }, user: { id: "u1" } }, r);
  assert.deepEqual(r.body, { count: 12, cap: WATCHLIST_PRO_CAP, isPro: true });
});
