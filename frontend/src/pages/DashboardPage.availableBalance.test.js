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
  assert.match(balance, /const balanceUnconfirmed = !team \|\| teamRefreshing \|\| Boolean\(teamError\) \|\| reservationUnconfirmed;/);
  // Codex P2 on #8466: an invalidated reservation is old until its refetch lands.
  assert.match(balance, /const reservationUnconfirmed = reservation\.isFetching\s*&& runtime\.client\.getQueryState\(reservationKey\)\?\.isInvalidated === true;/);
  assert.match(balance, /resolveBalanceDisplay\(balance, reservation\.data \?\? null, \{ failed, timedOut, balanceUnconfirmed \}\)/);
  for (const source of [dashboard, sidebar, auctions]) {
    assert.match(source, /const marketBalance = useMarketBalance\((balance)?\)/);
    assert.match(source, /t\("finance:balance\.available", \{ value: formatNumber\(marketBalance\.value\) \}\)/);
    assert.match(source, /marketBalance\.locked > 0/);
    assert.match(source, /t\("finance:balance\.lockedInBids", \{ value: formatNumber\(marketBalance\.locked\) \}\)/);
  }
});

test("#8357 the balance never disappears: each surface renders the raw balance when the reservation is unknown", () => {
  for (const source of [dashboard, sidebar, auctions]) {
    assert.match(source, /marketBalance(\?)?\.mode === "balance"|marketBalance\.mode !== "pending"/);
    assert.doesNotMatch(source, /marketBalance\.available|marketBalance\.reserved/);
  }
  // The skeleton is bounded: after the wait the hook falls back to the raw balance.
  assert.match(balance, /setTimeout\(\(\) => setTimedOut\(true\), RESERVED_WAIT_MS\)/);
  assert.match(balance, /const failed = reservation\.isError;/);
});

test("#8357 one source: the sidebar shows the shared team balance, not its own copy", () => {
  assert.match(balance, /const balance = team\?\.balance \?\? fallbackBalance \?\? null;/);
  assert.match(sidebar, /const marketBalance = useMarketBalance\(balance\);/);
  assert.match(sidebar, /\{marketBalance && \(\s*<div className="px-4 py-3 border-b border-cz-sidebar-border">/);
  assert.doesNotMatch(sidebar, /\{formatNumber\(balance\)\} CZ\$/);
});

test("#8357 a successful auction start refreshes the reservation before navigation", () => {
  assert.match(riderProfile, /refreshMarketBalance\(\);\s*navigate\("\/auctions"\)/);
});
