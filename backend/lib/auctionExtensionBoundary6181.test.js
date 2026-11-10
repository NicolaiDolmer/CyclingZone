// #6181 dommer-fund 10/11: en forlængelse må ikke skubbe auktionen forbi
// sæsonskiftet, når pengelåsen eller auto-accept er tændt. Begge slukket = uændret.
import test from "node:test";
import assert from "node:assert/strict";
import { applyLeaderShiftExtension, capExtendedEndAtBoundary, DEFAULT_AUCTION_CONFIG } from "./auctionEngine.js";
import { SEASON_TRANSITION_PLANNED_AT_KEY } from "./seasonTransitionBoundary.js";

const BOUNDARY = "2026-11-12T17:00:00.000Z";

function mockSupabase({ flags = {}, flagError = false, auction, plannedAt = BOUNDARY }) {
  const state = { auction: { ...auction }, auctionUpdates: [] };
  return {
    state,
    from(table) {
      const filters = [];
      let action = "select";
      let payload = null;
      const run = (single) => {
        if (table === "app_config") {
          const inKeys = filters.find((f) => f[0] === "in");
          if (inKeys) {
            if (flagError) return { data: null, error: { message: "boom" } };
            return { data: inKeys[2].filter((k) => k in flags).map((k) => ({ key: k, value: flags[k] })), error: null };
          }
          const key = filters.find((f) => f[0] === "key")?.[1];
          return { data: key === SEASON_TRANSITION_PLANNED_AT_KEY && plannedAt ? { value: plannedAt } : null, error: null };
        }
        if (table === "seasons") return { data: null, error: null };
        if (table === "admin_log") return { data: [], error: null };
        if (table === "auctions") {
          if (action === "update") { Object.assign(state.auction, payload); state.auctionUpdates.push({ ...payload }); return { data: null, error: null }; }
          return { data: { ...state.auction }, error: null };
        }
        if (table === "auction_bids") return { data: single ? { id: "bid-1" } : [], error: null };
        return { data: null, error: null };
      };
      const q = {
        select() { return q; },
        eq(k, v) { filters.push([k, v]); return q; },
        in(k, v) { filters.push(["in", k, v]); return q; },
        order() { return q; },
        limit() { return q; },
        update(v) { action = "update"; payload = v; return q; },
        single: async () => run(true),
        maybeSingle: async () => run(true),
        then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject); },
      };
      return q;
    },
  };
}

// Auktionen slutter lige før grænsen; et overbud i forlængelsesvinduet ville
// skubbe slutningen forbi grænsen.
const currentEnd = new Date(Date.parse(BOUNDARY) - 3 * 60 * 1000).toISOString();
const bidTime = new Date(Date.parse(BOUNDARY) - 4 * 60 * 1000);
const auction = { current_bidder_id: "B", calculated_end: currentEnd, extension_count: 0, status: "active" };
const cfg = { ...DEFAULT_AUCTION_CONFIG, weekday_open_hour: 0, weekday_close_hour: 24, weekend_open_hour: 0, weekend_close_hour: 24 };

test("capExtendedEndAtBoundary: under grænsen = uændret; over = sidste hele minut før; ellers null", () => {
  const before = new Date(Date.parse(BOUNDARY) - 10 * 60 * 1000);
  assert.equal(capExtendedEndAtBoundary(before, currentEnd, BOUNDARY), before);
  assert.equal(capExtendedEndAtBoundary(new Date(Date.parse(BOUNDARY) + 60000), currentEnd, null).toISOString(), "2026-11-12T17:01:00.000Z");
  const capped = capExtendedEndAtBoundary(new Date(Date.parse(BOUNDARY) + 60000), currentEnd, BOUNDARY);
  assert.equal(capped.toISOString(), "2026-11-12T16:59:00.000Z");
  assert.equal(capExtendedEndAtBoundary(new Date(Date.parse(BOUNDARY) + 60000), "2026-11-12T16:59:30.000Z", BOUNDARY), null);
});

for (const flags of [{ market_commitment_6181: "on" }, { auto_accept_enabled: "on" }, { market_commitment_6181: true, auto_accept_enabled: "off" }]) {
  test(`tændt ${JSON.stringify(flags)}: forlængelsen holdes under sæsonskiftet`, async () => {
    const sb = mockSupabase({ flags, auction });
    const res = await applyLeaderShiftExtension({ supabase: sb, auctionId: "a1", previousLeader: "A", bidTime, bidCfg: cfg });
    assert.equal(res.extensionApplied, true);
    assert.ok(res.newEnd < new Date(BOUNDARY));
    assert.equal(sb.state.auction.calculated_end, "2026-11-12T16:59:00.000Z");
  });
}

test("begge slukket: forlængelsen er uændret (må gå forbi grænsen som før)", async () => {
  for (const flags of [{}, { market_commitment_6181: "off", auto_accept_enabled: "off" }]) {
    const sb = mockSupabase({ flags, auction });
    const res = await applyLeaderShiftExtension({ supabase: sb, auctionId: "a1", previousLeader: "A", bidTime, bidCfg: cfg });
    const legacy = new Date(bidTime.getTime() + cfg.extension_minutes * 60 * 1000);
    assert.equal(res.extensionApplied, true);
    assert.equal(res.newEnd.toISOString(), legacy.toISOString());
  }
});

test("ukendt kontakt-tilstand (opslag fejler): grænsen holdes", async () => {
  const sb = mockSupabase({ flagError: true, auction });
  const res = await applyLeaderShiftExtension({ supabase: sb, auctionId: "a1", previousLeader: "A", bidTime, bidCfg: cfg });
  assert.equal(sb.state.auction.calculated_end, "2026-11-12T16:59:00.000Z");
  assert.equal(res.extensionApplied, true);
});

test("tændt, men den holdte sluttid ligger ikke efter den nuværende: ingen forlængelse", async () => {
  const late = { ...auction, calculated_end: "2026-11-12T16:59:30.000Z" };
  const sb = mockSupabase({ flags: { market_commitment_6181: "on" }, auction: late });
  const res = await applyLeaderShiftExtension({ supabase: sb, auctionId: "a1", previousLeader: "A", bidTime: new Date("2026-11-12T16:59:00.000Z"), bidCfg: cfg });
  assert.deepEqual(res, { extensionApplied: false, newEnd: null });
  assert.equal(sb.state.auctionUpdates.length, 0);
});

test("tændt uden kendt grænse: forlængelsen er uændret", async () => {
  const sb = mockSupabase({ flags: { market_commitment_6181: "on" }, auction, plannedAt: null });
  const res = await applyLeaderShiftExtension({ supabase: sb, auctionId: "a1", previousLeader: "A", bidTime, bidCfg: cfg });
  assert.equal(res.newEnd.toISOString(), new Date(bidTime.getTime() + cfg.extension_minutes * 60 * 1000).toISOString());
});

test("Codex 10/11: en holdt sluttid i lukket tid flyttes til sidste hele minut før vinduets lukning", () => {
  const win = { ...DEFAULT_AUCTION_CONFIG, weekday_open_hour: 8, weekday_close_hour: 24, weekend_open_hour: 8, weekend_close_hour: 24 };
  // Sæsonskifte kl. 08:00 dansk tid 13/11 (07:00Z); auktionen sluttede 23:58 (22:58Z) og blev forlænget til 08:07.
  const boundary = "2026-11-13T07:00:00.000Z";
  const extended = new Date("2026-11-13T07:07:00.000Z");
  assert.equal(capExtendedEndAtBoundary(extended, "2026-11-12T22:58:00.000Z", boundary, win).toISOString(), "2026-11-12T22:59:00.000Z");
  // Ingen ledig tid før lukningen: ingen forlængelse.
  assert.equal(capExtendedEndAtBoundary(extended, "2026-11-12T22:59:30.000Z", boundary, win), null);
  // Grænse midt i vinduet: uændret regel (sidste hele minut før grænsen).
  assert.equal(capExtendedEndAtBoundary(new Date("2026-11-12T17:05:00.000Z"), "2026-11-12T16:50:00.000Z", "2026-11-12T17:00:00.000Z", win).toISOString(), "2026-11-12T16:59:00.000Z");
});
