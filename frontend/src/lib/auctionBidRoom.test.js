import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBidRoom, SENIOR_CAP, ACADEMY_CAP } from "./auctionBidRoom.js";

test("senior-auktion: blokeret når senior fuld", () => {
  const r = computeBidRoom({ isYouth: false, seniorCount: SENIOR_CAP, academyCount: 0 });
  assert.equal(r.blocked, true);
  assert.equal(r.reason, "senior_full");
});

test("senior-auktion: tilladt når senior har plads", () => {
  const r = computeBidRoom({ isYouth: false, seniorCount: 20, academyCount: ACADEMY_CAP });
  assert.equal(r.blocked, false);
});

test("youth: blokeret KUN når begge fulde", () => {
  const r = computeBidRoom({ isYouth: true, seniorCount: SENIOR_CAP, academyCount: ACADEMY_CAP });
  assert.equal(r.blocked, true);
  assert.equal(r.reason, "both_full");
});

test("youth: senior fuld men akademi plads → tilladt, destination academy", () => {
  const r = computeBidRoom({ isYouth: true, seniorCount: SENIOR_CAP, academyCount: 5 });
  assert.equal(r.blocked, false);
  assert.equal(r.destination, "academy");
});

test("youth: senior plads → tilladt, destination senior (senior-først)", () => {
  const r = computeBidRoom({ isYouth: true, seniorCount: 20, academyCount: ACADEMY_CAP });
  assert.equal(r.blocked, false);
  assert.equal(r.destination, "senior");
});

test("null counts (endnu ikke hentet) behandles som ikke-fuld → ikke blokeret", () => {
  assert.equal(computeBidRoom({ isYouth: true, seniorCount: null, academyCount: null }).blocked, false);
  assert.equal(computeBidRoom({ isYouth: false, seniorCount: null, academyCount: null }).blocked, false);
});
