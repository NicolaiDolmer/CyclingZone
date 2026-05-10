import test from "node:test";
import assert from "node:assert/strict";

import { applyLeaderShiftExtension, checkBidExtension, DEFAULT_AUCTION_CONFIG } from "./auctionEngine.js";

// Alle test-tidspunkter er i CEST-perioden (maj) hvor Copenhagen = UTC+2.
// Hverdag close=22:00 CEST → 20:00 UTC. Hard cap = close + 60 min grace = 23:00 CEST.
// Weekend close=23:00 CEST → 21:00 UTC. Hard cap = 24:00 CEST = 00:00 next-day UTC+2.
const CFG = DEFAULT_AUCTION_CONFIG;

const iso = (s) => new Date(s);

test("checkBidExtension: bud udenfor sidste 10 min — ingen forlængelse", () => {
  // Fri 21:30 bud, end 22:00 → 30 min tilbage, ingen extension
  const end = iso("2026-05-08T20:00:00.000Z");
  const bid = iso("2026-05-08T19:30:00.000Z");
  const result = checkBidExtension(bid, end, CFG);
  assert.equal(result.shouldExtend, false);
  assert.equal(result.newEnd, null);
});

test("checkBidExtension: bud i sidste 10 min midt i vinduet — almindelig forlængelse", () => {
  // Fri 21:25 bud, end 21:30 → +10 min = 21:35 (langt fra close)
  const end = iso("2026-05-08T19:30:00.000Z");
  const bid = iso("2026-05-08T19:25:00.000Z");
  const result = checkBidExtension(bid, end, CFG);
  assert.equal(result.shouldExtend, true);
  assert.equal(result.newEnd.toISOString(), "2026-05-08T19:35:00.000Z");
});

test("checkBidExtension: forlænger PAST close, indenfor grace (Fri 21:55 bud → 22:05)", () => {
  // end = Fri 22:00 (close), bid = Fri 21:55 → +10 = 22:05 (5 min past close, indenfor 60-min grace)
  const end = iso("2026-05-08T20:00:00.000Z");
  const bid = iso("2026-05-08T19:55:00.000Z");
  const result = checkBidExtension(bid, end, CFG);
  assert.equal(result.shouldExtend, true);
  assert.equal(result.newEnd.toISOString(), "2026-05-08T20:05:00.000Z"); // Fri 22:05 CEST
});

test("checkBidExtension: forlænger til hard cap præcist (Fri 22:50 bud, end 22:55 → 23:00)", () => {
  // extendedEnd = bid + 10 = 23:00 = hard cap → newEnd = 23:00
  const end = iso("2026-05-08T20:55:00.000Z");
  const bid = iso("2026-05-08T20:50:00.000Z");
  const result = checkBidExtension(bid, end, CFG);
  assert.equal(result.shouldExtend, true);
  assert.equal(result.newEnd.toISOString(), "2026-05-08T21:00:00.000Z"); // Fri 23:00 CEST
});

test("checkBidExtension: hverdag-rollover — Fri 22:55 bud → Sat 08:05 (overflow 5 min)", () => {
  // Reglens kerne-eksempel. extendedEnd = 23:05 → past hard cap (23:00) med 5 min →
  // rollover til næste vindues åbning (Sat 08:00) + 5 min = Sat 08:05.
  const end = iso("2026-05-08T21:00:00.000Z"); // Fri 23:00 CEST
  const bid = iso("2026-05-08T20:55:00.000Z"); // Fri 22:55 CEST
  const result = checkBidExtension(bid, end, CFG);
  assert.equal(result.shouldExtend, true);
  assert.equal(result.newEnd.toISOString(), "2026-05-09T06:05:00.000Z"); // Sat 08:05 CEST
});

test("checkBidExtension: weekend-rollover — Sat 23:53 bud → Sun 08:03 (overflow 3 min)", () => {
  // Lørdag close=23, hard cap = Sun 00:00. extendedEnd = Sun 00:03 → overflow 3 min → Sun 08:03
  const end = iso("2026-05-09T21:55:00.000Z"); // Sat 23:55 CEST
  const bid = iso("2026-05-09T21:53:00.000Z"); // Sat 23:53 CEST
  const result = checkBidExtension(bid, end, CFG);
  assert.equal(result.shouldExtend, true);
  assert.equal(result.newEnd.toISOString(), "2026-05-10T06:03:00.000Z"); // Sun 08:03 CEST
});

test("checkBidExtension: weekend→hverdag rollover — Sun 23:55 bud → Mon 16:05", () => {
  // Søndags hard cap = Mon 00:00. extendedEnd = Mon 00:05 → overflow 5 min →
  // næste vindues åbning er mandag (hverdag) kl. 16:00 → Mon 16:05
  const end = iso("2026-05-10T21:55:00.000Z"); // Sun 23:55 CEST
  const bid = iso("2026-05-10T21:55:00.000Z"); // Sun 23:55 CEST (timeLeft = 0)
  const result = checkBidExtension(bid, end, CFG);
  assert.equal(result.shouldExtend, true);
  assert.equal(result.newEnd.toISOString(), "2026-05-11T14:05:00.000Z"); // Mon 16:05 CEST
});

test("checkBidExtension: ingen forlængelse hvis newEnd ikke rykker (præcist på hard cap, end=cap)", () => {
  // end = Fri 23:00 = hard cap, bid = Fri 22:50 → extendedEnd = 23:00 = end → ingen extension
  const end = iso("2026-05-08T21:00:00.000Z");
  const bid = iso("2026-05-08T20:50:00.000Z");
  const result = checkBidExtension(bid, end, CFG);
  assert.equal(result.shouldExtend, false);
  assert.equal(result.newEnd, null);
});

test("checkBidExtension: kæde af forlængelser igennem grace-zonen (22:55 → 23:00)", () => {
  // Bud 22:55 med end 23:00 → extendedEnd 23:05 → overflow 5 → Sat 08:05
  // Modsat: bud 22:51 med end 23:00 → extendedEnd 23:01 → overflow 1 → Sat 08:01
  const end = iso("2026-05-08T21:00:00.000Z"); // Fri 23:00 CEST
  const bid = iso("2026-05-08T20:51:00.000Z"); // Fri 22:51 CEST (9 min før end)
  const result = checkBidExtension(bid, end, CFG);
  assert.equal(result.shouldExtend, true);
  assert.equal(result.newEnd.toISOString(), "2026-05-09T06:01:00.000Z"); // Sat 08:01 CEST
});

test("checkBidExtension: bud i grace-zonen ud over close — næste forlængelse stadig indenfor grace", () => {
  // end = Fri 22:30 (allerede past close pga tidligere extension), bid 22:25 → 22:35
  const end = iso("2026-05-08T20:30:00.000Z"); // Fri 22:30 CEST
  const bid = iso("2026-05-08T20:25:00.000Z"); // Fri 22:25 CEST
  const result = checkBidExtension(bid, end, CFG);
  assert.equal(result.shouldExtend, true);
  assert.equal(result.newEnd.toISOString(), "2026-05-08T20:35:00.000Z"); // Fri 22:35 CEST
});

// =============================================================================
// applyLeaderShiftExtension — leader-shift gated extension (#257)
// =============================================================================

// Mock Supabase med præcis de queries applyLeaderShiftExtension udfører:
// - SELECT current_bidder_id/calculated_end/extension_count/status FROM auctions WHERE id=
// - UPDATE auctions SET ... WHERE id= (kun hvis extension anvendes)
// - SELECT id FROM auction_bids WHERE auction_id= ORDER bid_time DESC LIMIT 1 (kun hvis extension)
// - UPDATE auction_bids SET triggered_extension=true WHERE id= (kun hvis extension)
function createExtensionMock({ auction, lastBidId = "bid-1" }) {
  const auctionState = { ...auction };
  const auctionUpdates = [];
  const bidUpdates = [];
  return {
    state: { auction: auctionState, auctionUpdates, bidUpdates },
    from(table) {
      if (table === "auctions") {
        return {
          select() {
            return {
              eq() {
                return {
                  single: () => Promise.resolve({ data: { ...auctionState }, error: null }),
                };
              },
            };
          },
          update(payload) {
            return {
              eq() {
                Object.assign(auctionState, payload);
                auctionUpdates.push({ ...payload });
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        };
      }
      if (table === "auction_bids") {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      limit() {
                        return {
                          maybeSingle: () =>
                            Promise.resolve({ data: { id: lastBidId }, error: null }),
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(_col, id) {
                bidUpdates.push({ id, ...payload });
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// Bud-tidspunkt langt ude i fremtiden så vi kontrollerer extension-window
// uden at ramme real Date.now() i edge cases. Lørdag 12:00 CEST 2030.
const SAT_NOON = new Date("2030-05-04T10:00:00.000Z");

test("applyLeaderShiftExtension: leader uændret efter cascade → ingen forlængelse (#257 kerne)", async () => {
  // Scenarie: A leder, B byder, A's proxy counter til A → leader = A (uændret).
  // Bid er inde i extension-vinduet (30s tilbage, 60s extension), men da leader
  // ikke skiftede, må auktionen IKKE forlænges.
  const auction = {
    id: "auc-1",
    current_bidder_id: "team-a",
    calculated_end: new Date(SAT_NOON.getTime() + 30_000).toISOString(),
    extension_count: 0,
    status: "active",
  };
  const supabase = createExtensionMock({ auction });
  const result = await applyLeaderShiftExtension({
    supabase,
    auctionId: "auc-1",
    previousLeader: "team-a",
    bidTime: SAT_NOON,
    bidCfg: { ...CFG, extension_minutes: 1 },
  });
  assert.equal(result.extensionApplied, false);
  assert.equal(result.newEnd, null);
  assert.equal(supabase.state.auctionUpdates.length, 0, "auctions må ikke opdateres");
  assert.equal(supabase.state.bidUpdates.length, 0, "bid-row må ikke flagges");
});

test("applyLeaderShiftExtension: leder skifter A→B i extension-vindue → forlæng + flag sidste bid", async () => {
  // Bid 60s før end, extension_minutes=1 → newEnd = bid + 60s.
  const auction = {
    id: "auc-2",
    current_bidder_id: "team-b",
    calculated_end: new Date(SAT_NOON.getTime() + 30_000).toISOString(),
    extension_count: 0,
    status: "active",
  };
  const supabase = createExtensionMock({ auction, lastBidId: "bid-last" });
  const result = await applyLeaderShiftExtension({
    supabase,
    auctionId: "auc-2",
    previousLeader: "team-a",
    bidTime: SAT_NOON,
    bidCfg: { ...CFG, extension_minutes: 1 },
  });
  assert.equal(result.extensionApplied, true);
  const expectedEnd = new Date(SAT_NOON.getTime() + 60_000);
  assert.equal(result.newEnd.toISOString(), expectedEnd.toISOString());
  assert.equal(supabase.state.auctionUpdates.length, 1);
  assert.equal(supabase.state.auctionUpdates[0].status, "extended");
  assert.equal(supabase.state.auctionUpdates[0].extension_count, 1);
  assert.equal(supabase.state.auctionUpdates[0].calculated_end, expectedEnd.toISOString());
  assert.equal(supabase.state.bidUpdates.length, 1);
  assert.equal(supabase.state.bidUpdates[0].id, "bid-last");
  assert.equal(supabase.state.bidUpdates[0].triggered_extension, true);
});

test("applyLeaderShiftExtension: leder skifter MEN bid udenfor extension-vindue → ingen forlængelse", async () => {
  // 10 min tilbage, extension=1 min → checkBidExtension returnerer shouldExtend:false.
  const auction = {
    id: "auc-3",
    current_bidder_id: "team-b",
    calculated_end: new Date(SAT_NOON.getTime() + 600_000).toISOString(),
    extension_count: 0,
    status: "active",
  };
  const supabase = createExtensionMock({ auction });
  const result = await applyLeaderShiftExtension({
    supabase,
    auctionId: "auc-3",
    previousLeader: "team-a",
    bidTime: SAT_NOON,
    bidCfg: { ...CFG, extension_minutes: 1 },
  });
  assert.equal(result.extensionApplied, false);
  assert.equal(supabase.state.auctionUpdates.length, 0);
});

test("applyLeaderShiftExtension: previousLeader=null (ingen ledede før) → enhver ny leder tæller som skift", async () => {
  // Auction opening uden bidder, B byder først → leader skifter null→B → extend.
  const auction = {
    id: "auc-4",
    current_bidder_id: "team-b",
    calculated_end: new Date(SAT_NOON.getTime() + 30_000).toISOString(),
    extension_count: 0,
    status: "active",
  };
  const supabase = createExtensionMock({ auction });
  const result = await applyLeaderShiftExtension({
    supabase,
    auctionId: "auc-4",
    previousLeader: null,
    bidTime: SAT_NOON,
    bidCfg: { ...CFG, extension_minutes: 1 },
  });
  assert.equal(result.extensionApplied, true);
  assert.equal(supabase.state.auctionUpdates[0].extension_count, 1);
});

test("applyLeaderShiftExtension: extension_count øges fra eksisterende værdi", async () => {
  // Already extended twice → extension_count: 2 → 3.
  const auction = {
    id: "auc-5",
    current_bidder_id: "team-b",
    calculated_end: new Date(SAT_NOON.getTime() + 30_000).toISOString(),
    extension_count: 2,
    status: "extended",
  };
  const supabase = createExtensionMock({ auction });
  const result = await applyLeaderShiftExtension({
    supabase,
    auctionId: "auc-5",
    previousLeader: "team-a",
    bidTime: SAT_NOON,
    bidCfg: { ...CFG, extension_minutes: 1 },
  });
  assert.equal(result.extensionApplied, true);
  assert.equal(supabase.state.auctionUpdates[0].extension_count, 3);
  assert.equal(supabase.state.auctionUpdates[0].status, "extended");
});

test("applyLeaderShiftExtension: spam 1 CZ$ bud fra non-leader når proxy holder lead → ingen forlængelse", async () => {
  // Eksempel fra #257-issue: A leder via proxy, B troller med 1 CZ$ over current.
  // Cascade vil skubbe A's proxy op og A holder lead. previousLeader=A, current=A.
  // Selv hvis bid er i extension-vindue, må vi IKKE forlænge — ellers kan B
  // strække auktionen i det uendelige med 1 CZ$ ad gangen.
  const auction = {
    id: "auc-spam",
    current_bidder_id: "team-a", // A still leads after cascade
    calculated_end: new Date(SAT_NOON.getTime() + 60_000).toISOString(),
    extension_count: 0,
    status: "active",
  };
  const supabase = createExtensionMock({ auction });
  const result = await applyLeaderShiftExtension({
    supabase,
    auctionId: "auc-spam",
    previousLeader: "team-a",
    bidTime: SAT_NOON,
    bidCfg: { ...CFG, extension_minutes: 5 }, // 5 min vindue, kun 60s tilbage
  });
  assert.equal(result.extensionApplied, false, "spam-bud må ikke forlænge når proxy holder lead");
  assert.equal(supabase.state.auctionUpdates.length, 0);
});
