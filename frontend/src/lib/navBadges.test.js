import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNavBadgeCounts, resolveNavBadgeCount, formatNavBadgeCount } from "./navBadges.js";

// #3521: Transfers-menupunktets badge må aldrig blandes sammen med Indbakkens
// ulæst-notifikations-tal — de to lever i hver deres nøgle i kortet.
test("buildNavBadgeCounts holder notifikations- og transfers-tal adskilt", () => {
  const counts = buildNavBadgeCounts({ unread: 4, pendingOffersCount: 2 });
  assert.deepEqual(counts, { "/notifications": 4, "/transfers": 2 });
});

test("buildNavBadgeCounts defaulter til 0/0 uden argumenter", () => {
  assert.deepEqual(buildNavBadgeCounts(), { "/notifications": 0, "/transfers": 0 });
});

test("resolveNavBadgeCount slår tallet op for et item med badge: true", () => {
  const counts = buildNavBadgeCounts({ unread: 3, pendingOffersCount: 5 });
  assert.equal(resolveNavBadgeCount({ to: "/transfers", badge: true }, counts), 5);
  assert.equal(resolveNavBadgeCount({ to: "/notifications", badge: true }, counts), 3);
});

test("resolveNavBadgeCount er 0 for items uden badge: true, uanset kortet", () => {
  const counts = buildNavBadgeCounts({ unread: 3, pendingOffersCount: 5 });
  // #987-parret: transferList-genvejen (/transfers?tab=market) har bevidst
  // ikke badge: true — kun det primære Transfers-punkt skal lyse op.
  assert.equal(resolveNavBadgeCount({ to: "/transfers?tab=market", badge: false }, counts), 0);
  assert.equal(resolveNavBadgeCount({ to: "/team" }, counts), 0);
});

test("resolveNavBadgeCount er 0 for et badge-item uden en nøgle i kortet", () => {
  assert.equal(resolveNavBadgeCount({ to: "/unknown", badge: true }, {}), 0);
});

test("formatNavBadgeCount capper ved 100+ (#3439: hævet fra 9+ til 99+), viser ellers det rå tal", () => {
  assert.equal(formatNavBadgeCount(0), "0");
  assert.equal(formatNavBadgeCount(1), "1");
  assert.equal(formatNavBadgeCount(9), "9");
  assert.equal(formatNavBadgeCount(10), "10");
  assert.equal(formatNavBadgeCount(99), "99");
  assert.equal(formatNavBadgeCount(100), "99+");
  assert.equal(formatNavBadgeCount(142), "99+");
});
