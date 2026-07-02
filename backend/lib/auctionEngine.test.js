import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLeaderShiftExtension,
  calculateAuctionEnd,
  checkBidExtension,
  DEFAULT_AUCTION_CONFIG,
  isLateBidTriggerError,
} from "./auctionEngine.js";

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
// calculateAuctionEnd — active-window duration accounting (#1904)
// =============================================================================

// 08–24 alle dage, 1 aktiv time (config #1904 flipper prod hertil). Test-tider i
// CEST (juni, Copenhagen = UTC+2). close_hour=24 = midnat (00:00 næste kalenderdag).
const C24 = {
  duration_hours: 1,
  weekday_open_hour: 8, weekday_close_hour: 24,
  weekend_open_hour: 8, weekend_close_hour: 24,
  extension_minutes: 10, extension_grace_minutes: 60,
};
const cph = (d) => d.toLocaleString("sv-SE", { timeZone: "Europe/Copenhagen" });

test("calculateAuctionEnd: close=24 — start 23:30 ender 08:30 NÆSTE dag (ikke to dage senere)", () => {
  // Kerne-bug'en (#1904): nextWindowOpenTime(wClose) sprang en dag over fordi
  // wClose=00:00 allerede lå på næste kalenderdag. Fre 23:30 CPH, 1h aktiv.
  assert.equal(cph(calculateAuctionEnd(iso("2026-06-26T21:30:00Z"), C24)), "2026-06-27 08:30:00");
});

test("calculateAuctionEnd: close=24 — 1h passer indenfor samme aften (22:30 → 23:30)", () => {
  assert.equal(cph(calculateAuctionEnd(iso("2026-06-26T20:30:00Z"), C24)), "2026-06-26 23:30:00");
});

test("calculateAuctionEnd: close=24 — start 23:00 lander præcis på midnat-close", () => {
  assert.equal(cph(calculateAuctionEnd(iso("2026-06-26T21:00:00Z"), C24)), "2026-06-27 00:00:00");
});

test("calculateAuctionEnd: close=24 — start i dead-hours (03:00) snapper til 08:00-open", () => {
  // 00:00–08:00 er dead time; auktionen begynder at tælle ved dagens open.
  assert.equal(cph(calculateAuctionEnd(iso("2026-06-27T01:00:00Z"), C24)), "2026-06-27 09:00:00");
});

test("calculateAuctionEnd: close=24 — 2h fra 23:00 spænder over midnat til næste dags vindue", () => {
  // 1h tilbage til midnat-close + 1h næste dag fra 08:00.
  assert.equal(cph(calculateAuctionEnd(iso("2026-06-26T21:00:00Z"), { ...C24, duration_hours: 2 })), "2026-06-27 09:00:00");
});

test("calculateAuctionEnd: default-config (close=22) uændret — Tir 19:40 → Ons 19:40", () => {
  // 2h20 Tir (til 22:00) + 3h40 Ons (fra 16:00). Beskytter close≤23-stien mod #1904-fixet.
  assert.equal(cph(calculateAuctionEnd(iso("2026-05-05T17:40:00Z"), CFG)), "2026-05-06 19:40:00");
});

test("calculateAuctionEnd: default-config (weekend close=23) uændret — Lør 19:40 → Søn 10:40", () => {
  assert.equal(cph(calculateAuctionEnd(iso("2026-05-09T17:40:00Z"), CFG)), "2026-05-10 10:40:00");
});

test("checkBidExtension: close=24 — forlæng forbi midnat indenfor grace (23:53 bud → 00:03)", () => {
  const r = checkBidExtension(iso("2026-06-26T21:53:00Z"), iso("2026-06-26T21:55:00Z"), C24);
  assert.equal(r.shouldExtend, true);
  assert.equal(cph(r.newEnd), "2026-06-27 00:03:00");
});

test("checkBidExtension: close=24 — kæde i post-midnat-grace forbliver indenfor grace (00:01 bud → 00:11)", () => {
  // windowForEnd re-ankrer end=00:03 til forrige dags vindue, så hard cap forbliver
  // 01:00 i stedet for et helt døgn for sent (#1904, linje 148/154).
  const r = checkBidExtension(iso("2026-06-26T22:01:00Z"), iso("2026-06-26T22:03:00Z"), C24);
  assert.equal(r.shouldExtend, true);
  assert.equal(cph(r.newEnd), "2026-06-27 00:11:00");
});

test("checkBidExtension: close=24 — bud forbi grace-cap (00:53, end 00:55) ruller til 08:03", () => {
  const r = checkBidExtension(iso("2026-06-26T22:53:00Z"), iso("2026-06-26T22:55:00Z"), C24);
  assert.equal(r.shouldExtend, true);
  assert.equal(cph(r.newEnd), "2026-06-27 08:03:00");
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

// #269: isLateBidTriggerError matcher exception fra reject_late_auction_bid trigger.
// Trigger raiser P0001 med besked startende med "auction_expired_at_insert" eller
// "auction_not_active". App-kode bruger denne matcher til at returnere 400 (i stedet
// for 500) når race-vinduet fanges af DB-laget.

test("isLateBidTriggerError: P0001 + auction_expired_at_insert → true", () => {
  const err = {
    code: "P0001",
    message: "auction_expired_at_insert (bid_time=2026-05-10 12:08:27.944+00 calculated_end=2026-05-10 12:08:27.636+00)",
  };
  assert.equal(isLateBidTriggerError(err), true);
});

test("isLateBidTriggerError: P0001 + auction_not_active → true", () => {
  const err = { code: "P0001", message: "auction_not_active (status=completed)" };
  assert.equal(isLateBidTriggerError(err), true);
});

test("isLateBidTriggerError: ikke-P0001 (fx 23505 unique-violation) → false", () => {
  const err = { code: "23505", message: "duplicate key value" };
  assert.equal(isLateBidTriggerError(err), false);
});

test("isLateBidTriggerError: P0001 men anden besked → false", () => {
  const err = { code: "P0001", message: "some_other_business_rule_violation" };
  assert.equal(isLateBidTriggerError(err), false);
});

test("isLateBidTriggerError: null/undefined → false", () => {
  assert.equal(isLateBidTriggerError(null), false);
  assert.equal(isLateBidTriggerError(undefined), false);
});

test("isLateBidTriggerError: error uden message-felt → false", () => {
  assert.equal(isLateBidTriggerError({ code: "P0001" }), false);
});

// ── Config-merge: prod-rækken oven på defaults (#1941) ─────────────────────────
// getAuctionConfig (api.js), resolveAuctionConfig (academyGraduation.js) og
// resolveAuctionConfig (youthMarket.js) bygger alle config med DET SAMME udtryk:
//   { ...DEFAULT_AUCTION_CONFIG, ...(data || {}) }
// Tidligere brugte de `data || DEFAULT_AUCTION_CONFIG`, som kastede HELE defaults
// væk når prod-rækken fandtes — inkl. extension_grace_minutes, der IKKE findes som
// kolonne i auction_timing_config. Resultat: grace faldt til 0 (hard cap = close),
// ikke 60 min. mergeAuctionConfig gengiver det delte produktions-udtryk.
const mergeAuctionConfig = (data) => ({ ...DEFAULT_AUCTION_CONFIG, ...(data || {}) });

test("config-merge: prod-værdi (duration_hours/weekday_close_hour) overstyrer default", () => {
  // Ægte prod-række fra auction_timing_config id=1 (verificeret read-only via execute_sql):
  // duration=1, close=24, INGEN extension_grace_minutes-kolonne.
  const prodRow = {
    id: 1,
    duration_hours: 1,
    weekday_open_hour: 8,
    weekday_close_hour: 24,
    weekend_open_hour: 8,
    weekend_close_hour: 24,
    extension_minutes: 10,
  };
  const cfg = mergeAuctionConfig(prodRow);
  // Prod-kolonner vinder over defaults (6 / 22):
  assert.equal(cfg.duration_hours, 1);
  assert.equal(cfg.weekday_close_hour, 24);
  // Felt der mangler i prod-rækken backfilles fra defaults — regressionen i #1941:
  assert.equal(cfg.extension_grace_minutes, DEFAULT_AUCTION_CONFIG.extension_grace_minutes);
  assert.equal(cfg.extension_grace_minutes, 60);
});

test("config-merge: null/manglende række falder tilbage på defaults", () => {
  const cfg = mergeAuctionConfig(null);
  assert.deepEqual(cfg, DEFAULT_AUCTION_CONFIG);
});

test("config-merge: grace bevares (60 min) i checkBidExtension via merged prod-config", () => {
  // Bevis for at bugfixet virker HELE vejen: en merged prod-config giver 60 min grace,
  // så et bud 21:55 kan forlænge PAST close til 22:05 (indenfor grace) — ikke kappes ved close.
  // Uden merge (rå prod-række) ville extension_grace_minutes være undefined → graceMs=0 →
  // hard cap = close (22:00) → newEnd kappet til 22:00.
  // Prod-rækken har ALLE window-timer men INGEN extension_grace_minutes (findes ikke som kolonne).
  const rawProdRow = {
    id: 1,
    duration_hours: 6,
    weekday_open_hour: 16,
    weekday_close_hour: 22,
    weekend_open_hour: 8,
    weekend_close_hour: 23,
    extension_minutes: 10,
  };
  const merged = mergeAuctionConfig(rawProdRow);

  const end = iso("2026-05-08T20:00:00.000Z"); // Fri 22:00 CEST (close)
  const bid = iso("2026-05-08T19:55:00.000Z"); // Fri 21:55 CEST

  // Med merge: grace backfilles til 60 → forlænger til 22:05 (indenfor grace).
  const withMerge = checkBidExtension(bid, end, merged);
  assert.equal(withMerge.shouldExtend, true);
  assert.equal(withMerge.newEnd.toISOString(), "2026-05-08T20:05:00.000Z"); // 22:05 — grace virker

  // Regressions-kontrast: rå prod-række uden grace → graceMs=0 → hard cap = close (22:00).
  // extendedEnd (22:05) passerer hard cap, så de 5 overflow-min ruller over til næste
  // vindues-åbning (Sat 08:00) + 5 = Sat 08:05 CEST. Dvs. buggen kaster auktionen ~10 timer
  // frem i stedet for de tilsigtede 5 min — helt anderledes end det merged resultat ovenfor.
  const withoutMerge = checkBidExtension(bid, end, rawProdRow);
  assert.equal(withoutMerge.shouldExtend, true);
  assert.equal(withoutMerge.newEnd.toISOString(), "2026-05-09T06:05:00.000Z"); // Sat 08:05 — buggen
  assert.notEqual(withoutMerge.newEnd.toISOString(), withMerge.newEnd.toISOString());
});
