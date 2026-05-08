import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOverbidEvent,
  shouldFlashPrice,
  filterBidEventsForFeed,
  getMyParticipatingAuctionIds,
  pruneStaleBidEvents,
} from "./auctionsRealtime.js";

const ME = "team-me";
const RIVAL = "team-rival";

test("shouldFlashPrice — pulse-trigger fyrer ved current_price-ændring", () => {
  assert.equal(shouldFlashPrice({ current_price: 100 }, { current_price: 150 }), true);
  assert.equal(shouldFlashPrice({ current_price: 100 }, { current_price: 100 }), false);
  assert.equal(shouldFlashPrice(null, { current_price: 150 }), false);
  assert.equal(shouldFlashPrice({ current_price: 100 }, null), false);
});

test("isOverbidEvent — toast trigges KUN når current_bidder_id skifter FRA mig til andre", () => {
  // Klassisk overbud: jeg ledte, en anden tog over → toast
  assert.equal(
    isOverbidEvent(
      { current_bidder_id: ME },
      { current_bidder_id: RIVAL },
      ME,
    ),
    true,
  );

  // Selv-bud: jeg byder igen som leder → INGEN toast
  assert.equal(
    isOverbidEvent(
      { current_bidder_id: ME },
      { current_bidder_id: ME },
      ME,
    ),
    false,
  );

  // Proxy auto-eskalering for mig (mig → mig) → INGEN toast
  assert.equal(
    isOverbidEvent(
      { current_bidder_id: ME },
      { current_bidder_id: ME },
      ME,
    ),
    false,
  );

  // En anden ledte → en tredje tog over → INGEN toast (jeg er ikke involveret)
  assert.equal(
    isOverbidEvent(
      { current_bidder_id: "team-other-1" },
      { current_bidder_id: "team-other-2" },
      ME,
    ),
    false,
  );

  // Auction nulstilles (skiftet ikke "til andre", det er til ingen) → INGEN toast
  assert.equal(
    isOverbidEvent(
      { current_bidder_id: ME },
      { current_bidder_id: null },
      ME,
    ),
    false,
  );

  // Mangler myTeamId (loading-state) → INGEN toast
  assert.equal(
    isOverbidEvent(
      { current_bidder_id: ME },
      { current_bidder_id: RIVAL },
      null,
    ),
    false,
  );
});

test("filterBidEventsForFeed — viser kun bud på auktioner jeg deltager i", () => {
  const events = [
    { auction_id: "a1", team_id: RIVAL, amount: 1000, ts: 1 },
    { auction_id: "a2", team_id: ME, amount: 2000, ts: 2 },
    { auction_id: "a3", team_id: RIVAL, amount: 3000, ts: 3 },
    { auction_id: "a4", team_id: "team-other", amount: 4000, ts: 4 },
  ];

  // Jeg deltager i a1 (manuel bid) og a3 (proxy) — IKKE a2 eller a4
  const auctions = [
    { id: "a1", myHighestBid: 900, myProxyMax: null },
    { id: "a2", myHighestBid: null, myProxyMax: null },
    { id: "a3", myHighestBid: null, myProxyMax: 5000 },
    { id: "a4", myHighestBid: null, myProxyMax: null },
  ];
  const myIds = getMyParticipatingAuctionIds(auctions);

  const filtered = filterBidEventsForFeed(events, myIds);
  assert.deepEqual(
    filtered.map(e => e.auction_id),
    ["a1", "a3"],
  );
});

test("pruneStaleBidEvents — beholder kun bud nyere end window", () => {
  const now = 30_000;
  const events = [
    { auction_id: "a1", ts: 0 },         // 30s gammel — falder lige uden for
    { auction_id: "a2", ts: 1 },         // ~30s gammel — inden for
    { auction_id: "a3", ts: 25_000 },    // 5s gammel — inden for
    { auction_id: "a4", ts: 31_000 },    // future-skew — beholdes (ts > cutoff)
  ];
  const fresh = pruneStaleBidEvents(events, now, 30_000);
  assert.deepEqual(
    fresh.map(e => e.auction_id),
    ["a2", "a3", "a4"],
  );
});
