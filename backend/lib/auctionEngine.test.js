import test from "node:test";
import assert from "node:assert/strict";

import { checkBidExtension, DEFAULT_AUCTION_CONFIG } from "./auctionEngine.js";

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
