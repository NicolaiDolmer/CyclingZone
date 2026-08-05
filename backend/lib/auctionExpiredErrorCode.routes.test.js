import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #3110 · bud/autobud-knappen forblev aktiv efter countdown nåede 0 (Sentry
// CYCLINGZONE-3Y, 4 hold ramt på 19 timer). Frontend disabler nu knappen når
// klienten selv opdager udløb (useAuctionBidding.js), men et kald kan stadig
// nå igennem i race-vinduet lige før — serverens tidlige isAuctionExpired-tjek
// i BÅDE POST /bid og PATCH /proxy manglede errorCode, så klienten faldt
// tilbage til den rå, uoversatte "Auction has ended" i stedet for den
// lokaliserede errors:api.auction_expired-tekst (samme kode som DB-trigger-
// grenen længere nede i hver handler allerede brugte). Samme
// route-source-teknik som auctionEntryGate.routes.test.js — en fuld HTTP-mock
// ville kræve at stubbe hele kæden af supabase-kald i disse handlere.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker) {
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route-markør "${marker}" findes ikke i api.js`);
  const end = apiSource.indexOf("router.", start + marker.length);
  return apiSource.slice(start, end === -1 ? start + 4000 : end);
}

test("#3110 POST /auctions/:id/bid — tidligt isAuctionExpired-tjek returnerer errorCode auction_expired", () => {
  const block = routeBlock('router.post("/auctions/:id/bid"');
  // Skær ved næste isAuctionExpired-forekomst (DB-trigger-grenen længere nede
  // i samme handler) så vi kun tjekker det TIDLIGE early-return.
  const early = block.slice(0, block.indexOf("isAuctionExpired") + 4000);
  assert.match(early, /if \(isAuctionExpired\(auction\.calculated_end\)\) \{\s*\n\s*return res\.status\(400\)\.json\(\{ error: "Auction has ended", errorCode: "auction_expired" \}\);/);
});

test("#3110 PATCH /auctions/:id/proxy — samme tidlige errorCode-fix som bud-endpointet", () => {
  const block = routeBlock('router.patch("/auctions/:id/proxy"');
  const early = block.slice(0, block.indexOf("isAuctionExpired") + 4000);
  assert.match(early, /if \(isAuctionExpired\(auction\.calculated_end\)\) \{\s*\n\s*return res\.status\(400\)\.json\(\{ error: "Auction has ended", errorCode: "auction_expired" \}\);/);
});

test("#3110 errors:api.auction_expired-nøglen findes i BÅDE en og da locale (regressions-anker for i18n)", () => {
  const enSource = readFileSync(resolve(__dirname, "../../frontend/public/locales/en/errors.json"), "utf8");
  const daSource = readFileSync(resolve(__dirname, "../../frontend/public/locales/da/errors.json"), "utf8");
  assert.match(enSource, /"auction_expired":\s*"/);
  assert.match(daSource, /"auction_expired":\s*"/);
});
