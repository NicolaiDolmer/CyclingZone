import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #3826 · route-source-contract i samme stil som auctionEntryGate.routes.test.js.
// Bug: PATCH /auctions/:id/proxy brugte getAuctionBidSquadBlock (kun senior-cap),
// mens POST /auctions/:id/bid brugte den delte getAuctionBidRoomBlock (senior +
// akademi-fallback for ungdomsauktioner). En manager med fuld seniortrup men ledig
// akademiplads kunne derfor byde almindeligt på en ungdomsauktion, men ikke sætte
// et proxy-loft på samme auktion. Beviser at proxy-routen nu kalder SAMME delte
// helper som bud-routen, i stedet for en kopieret senior-only variant.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker) {
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route-markør "${marker}" findes ikke i api.js`);
  const end = apiSource.indexOf("router.", start + marker.length);
  return apiSource.slice(start, end === -1 ? start + 6000 : end);
}

test("PATCH /auctions/:id/proxy bruger getAuctionBidRoomBlock (samme delte helper som bud-endpointet), ikke getAuctionBidSquadBlock", () => {
  const block = routeBlock('router.patch("/auctions/:id/proxy"');
  assert.match(
    block,
    /getAuctionBidRoomBlock\(\{/,
    "proxy-route skal kalde den delte getAuctionBidRoomBlock, som har akademi-fallbacken"
  );
  assert.doesNotMatch(
    block,
    /getAuctionBidSquadBlock\(\{/,
    "proxy-route må ikke længere kalde den senior-only getAuctionBidSquadBlock direkte"
  );
  assert.match(block, /isYouth:\s*auction\.is_youth/);
  assert.match(block, /academySlots:\s*ACADEMY\.SLOTS/);
  assert.match(block, /errorCode:\s*"no_eligible_room_bid"/);
});

test("PATCH /auctions/:id/proxy henter is_youth på auktionen (ellers er akademi-fallbacken altid falsk)", () => {
  const block = routeBlock('router.patch("/auctions/:id/proxy"');
  assert.match(
    block,
    /\.from\("auctions"\)\s*\n\s*\.select\("[^"]*\bis_youth\b[^"]*"\)/,
    "auctions-select på proxy-routen skal inkludere is_youth"
  );
});

test("getAuctionBidSquadBlock bruges IKKE længere direkte i api.js (kun via getAuctionBidRoomBlock i auctionRules.js)", () => {
  assert.doesNotMatch(
    apiSource,
    /getAuctionBidSquadBlock/,
    "api.js skal ikke importere/kalde getAuctionBidSquadBlock direkte — brug getAuctionBidRoomBlock (delt helper med akademi-fallback)"
  );
});
