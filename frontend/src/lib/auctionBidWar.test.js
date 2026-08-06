import test from "node:test";
import assert from "node:assert/strict";
import { sortBidsChronologically, isWinningBid } from "./auctionBidWar.js";

test("sortBidsChronologically orders by bid_time ascending regardless of input order", () => {
  const bids = [
    { id: "c", team_id: "team-a", amount: 300, bid_time: "2026-08-05T12:02:00.000Z" },
    { id: "a", team_id: "team-a", amount: 100, bid_time: "2026-08-05T12:00:00.000Z" },
    { id: "b", team_id: "team-b", amount: 200, bid_time: "2026-08-05T12:01:00.000Z" },
  ];
  const ordered = sortBidsChronologically(bids);
  assert.deepEqual(ordered.map(b => b.id), ["a", "b", "c"]);
  // Input must not be mutated in place — caller (React state) relies on this.
  assert.equal(bids[0].id, "c");
});

test("sortBidsChronologically tolerates null/undefined/empty input", () => {
  assert.deepEqual(sortBidsChronologically(null), []);
  assert.deepEqual(sortBidsChronologically(undefined), []);
  assert.deepEqual(sortBidsChronologically([]), []);
});

test("isWinningBid marks only the last bid in chronological order as winning", () => {
  const ordered = [
    { id: "a", team_id: "team-a", amount: 100 },
    { id: "b", team_id: "team-b", amount: 200 },
    { id: "c", team_id: "team-b", amount: 300 },
  ];
  assert.equal(isWinningBid({ bid: ordered[0], index: 0, orderedBids: ordered, winnerId: "team-b" }), false);
  assert.equal(isWinningBid({ bid: ordered[1], index: 1, orderedBids: ordered, winnerId: "team-b" }), false);
  assert.equal(isWinningBid({ bid: ordered[2], index: 2, orderedBids: ordered, winnerId: "team-b" }), true);
});

test("isWinningBid rejects the last bid if it doesn't belong to the known winner (defensive)", () => {
  const ordered = [
    { id: "a", team_id: "team-a", amount: 100 },
    { id: "b", team_id: "team-b", amount: 200 },
  ];
  // Should not happen in practice (last realized bid IS the winner for a
  // completed auction), but the check must not silently crown the wrong team.
  assert.equal(isWinningBid({ bid: ordered[1], index: 1, orderedBids: ordered, winnerId: "team-a" }), false);
});

test("isWinningBid falls back to 'last bid wins' when winnerId is unknown", () => {
  const ordered = [
    { id: "a", team_id: "team-a", amount: 100 },
    { id: "b", team_id: "team-b", amount: 200 },
  ];
  assert.equal(isWinningBid({ bid: ordered[1], index: 1, orderedBids: ordered, winnerId: null }), true);
  assert.equal(isWinningBid({ bid: ordered[0], index: 0, orderedBids: ordered, winnerId: null }), false);
});

test("isWinningBid handles an empty bid list without throwing", () => {
  assert.equal(isWinningBid({ bid: null, index: 0, orderedBids: [], winnerId: "team-a" }), false);
});
