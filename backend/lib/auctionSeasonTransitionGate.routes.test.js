import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #5846 · source-contract (samme stil som auctionEntryGate.routes.test.js): hvor
// sæsonskifte-gaten sidder i auktions-ruterne. Selve før/under/efter-reglen er
// unit-testet i seasonTransitionBoundary.test.js.
//   - OPRET (POST /auctions): henter grænsen via fetchSeasonTransitionBoundary og
//     afviser med auction_end_crosses_season_transition.
//   - BYD (POST /auctions/:id/bid + PATCH /auctions/:id/proxy): ingen sæsonskifte-
//     gate. Et bud er uafhængigt af skiftets tilstand, så eksisterende auktioner kan
//     bydes på før, under og efter skiftet.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker) {
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route-markør "${marker}" findes ikke i api.js`);
  const end = apiSource.indexOf("router.", start + marker.length);
  return apiSource.slice(start, end === -1 ? start + 4000 : end);
}

const SEASON_GATE = /fetchSeasonTransitionBoundary|getAuctionSeasonBoundaryIssue|crosses_season_transition/;

test("#5846 POST /auctions bruger den tilstandsbevidste grænse (fetchSeasonTransitionBoundary) og afviser med errorCode", () => {
  const block = routeBlock('router.post("/auctions", ');
  assert.match(block, /fetchSeasonTransitionBoundary\(supabase\)/);
  assert.match(block, /getAuctionSeasonBoundaryIssue\(calculatedEnd, seasonTransitionBoundary\)/);
  assert.match(block, /errorCode:\s*"auction_end_crosses_season_transition"/);
});

test("#5846 POST /auctions/:id/bid har ingen sæsonskifte-gate (bud virker før, under og efter skiftet)", () => {
  const block = routeBlock('router.post("/auctions/:id/bid"');
  assert.doesNotMatch(block, SEASON_GATE);
  assert.doesNotMatch(block, /season_transition_planned_at/);
});

test("#5846 PATCH /auctions/:id/proxy har ingen sæsonskifte-gate (autobud virker før, under og efter skiftet)", () => {
  const block = routeBlock('router.patch("/auctions/:id/proxy"');
  assert.doesNotMatch(block, SEASON_GATE);
  assert.doesNotMatch(block, /season_transition_planned_at/);
});
