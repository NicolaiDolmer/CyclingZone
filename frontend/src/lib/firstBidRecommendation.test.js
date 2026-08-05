import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFirstBidRecommendation, FIRST_BID_MIN_TIME_LEFT_MS } from "./firstBidRecommendation.js";

const NOW = new Date("2026-08-05T12:00:00Z");
const FAR_FUTURE = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(); // +1h

// Alle kald gaar gennem denne wrapper. Uden et eksplicit `now` faldt
// pickFirstBidRecommendation tilbage paa den rigtige klokke, mens FAR_FUTURE var
// laast til NOW + 1t. Testene var derfor groenne indtil 2026-08-05 kl. 13:00 UTC
// og roede bagefter: main blev roed uden en eneste ny commit, og enhver PR
// branchet fra den arvede fejlen. Wrapperen goer det umuligt at glemme igen.
function pick(auctions, opts = {}) {
  return pickFirstBidRecommendation(auctions, { now: NOW, ...opts });
}

function auction(overrides) {
  return {
    id: "a1",
    status: "active",
    current_price: 10000,
    calculated_end: FAR_FUTURE,
    rider: { id: "r1", team_id: null },
    seller_team_id: null,
    current_bidder_id: null,
    ...overrides,
  };
}

test("pickFirstBidRecommendation vælger den billigste kandidat", () => {
  const auctions = [
    auction({ id: "expensive", current_price: 50000 }),
    auction({ id: "cheap", current_price: 5000 }),
    auction({ id: "mid", current_price: 20000 }),
  ];
  const result = pick(auctions, { myTeamId: "team-1" });
  assert.equal(result.id, "cheap");
});

test("pickFirstBidRecommendation ekskluderer auktioner manageren allerede fører", () => {
  const auctions = [
    auction({ id: "leading", current_price: 1000, current_bidder_id: "team-1" }),
    auction({ id: "next-cheapest", current_price: 5000 }),
  ];
  const result = pick(auctions, { myTeamId: "team-1" });
  assert.equal(result.id, "next-cheapest");
});

test("pickFirstBidRecommendation ekskluderer auktioner manageren selv sælger", () => {
  const auctions = [
    auction({
      id: "own-sale",
      current_price: 100,
      seller_team_id: "team-1",
      rider: { id: "r-mine", team_id: "team-1" },
    }),
    auction({ id: "next-cheapest", current_price: 8000 }),
  ];
  const result = pick(auctions, { myTeamId: "team-1" });
  assert.equal(result.id, "next-cheapest");
});

test("pickFirstBidRecommendation ekskluderer auktioner der lukker inden for MIN_TIME_LEFT_MS", () => {
  const closingSoon = new Date(NOW.getTime() + FIRST_BID_MIN_TIME_LEFT_MS - 1000).toISOString();
  const auctions = [
    auction({ id: "closing-soon", current_price: 1, calculated_end: closingSoon }),
    auction({ id: "has-time", current_price: 9000 }),
  ];
  const result = pick(auctions, { myTeamId: "team-1", now: NOW });
  assert.equal(result.id, "has-time");
});

test("pickFirstBidRecommendation ekskluderer completed auktioner", () => {
  const auctions = [
    auction({ id: "done", current_price: 1, status: "completed" }),
    auction({ id: "active-one", current_price: 9000 }),
  ];
  const result = pick(auctions, { myTeamId: "team-1" });
  assert.equal(result.id, "active-one");
});

test("pickFirstBidRecommendation ekskluderer auktioner uden rytter (defensive)", () => {
  const auctions = [
    auction({ id: "no-rider", current_price: 1, rider: null }),
    auction({ id: "has-rider", current_price: 9000 }),
  ];
  const result = pick(auctions, { myTeamId: "team-1" });
  assert.equal(result.id, "has-rider");
});

test("pickFirstBidRecommendation bruger calculated_end som tie-break ved samme pris", () => {
  const soonerEnd = new Date(NOW.getTime() + 20 * 60 * 1000).toISOString();
  const laterEnd = new Date(NOW.getTime() + 40 * 60 * 1000).toISOString();
  const auctions = [
    auction({ id: "later", current_price: 5000, calculated_end: laterEnd }),
    auction({ id: "sooner", current_price: 5000, calculated_end: soonerEnd }),
  ];
  const result = pick(auctions, { myTeamId: "team-1", now: NOW });
  assert.equal(result.id, "sooner");
});

test("pickFirstBidRecommendation returnerer null når der ingen kandidater er", () => {
  const result = pick([], { myTeamId: "team-1" });
  assert.equal(result, null);
});

test("pickFirstBidRecommendation returnerer null for undefined/null input (defensive)", () => {
  assert.equal(pick(null, { myTeamId: "team-1" }), null);
  assert.equal(pick(undefined, { myTeamId: "team-1" }), null);
});
