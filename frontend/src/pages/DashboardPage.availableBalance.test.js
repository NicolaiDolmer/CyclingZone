import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const dashboard = read("./DashboardPage.jsx");
const sidebar = read("../components/Layout.jsx");
const auctions = read("./AuctionsPage.jsx");
const balance = read("../data/marketBalance.ts");
const riderProfile = read("./RiderStatsPage.jsx");

test("#8357 uses the shared finance calculation for each balance surface", () => {
  assert.match(balance, /fetchReservedBalance\(supabase, teamId, signal\)/);
  assert.match(balance, /computeAvailableBalance\(team\.balance, reserved\)/);
  for (const source of [dashboard, sidebar, auctions]) {
    assert.match(source, /const marketBalance = useMarketBalance\(\)/);
    assert.match(source, /t\("finance:balance\.available", \{ value: formatNumber\(marketBalance\.available\) \}\)/);
    assert.match(source, /marketBalance\.reserved > 0/);
    assert.match(source, /t\("finance:balance\.lockedInBids", \{ value: formatNumber\(marketBalance\.reserved\) \}\)/);
  }
});

test("#8357 a successful auction start refreshes the reservation before navigation", () => {
  assert.match(riderProfile, /refreshMarketBalance\(\);\s*navigate\("\/auctions"\)/);
});
