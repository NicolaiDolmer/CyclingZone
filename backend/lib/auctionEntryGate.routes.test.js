import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #3134 · auktions-spærre source-contract — samme stil som
// loanAmountValidation.routes.test.js: en fuld HTTP-mock af POST
// /auctions/:id/bid ville kræve at stubbe squad-cap/signing/assertMarketOpen
// osv. Beviser i stedet at BEGGE bud-veje (manuelt bud + proxy/autobud)
// faktisk kalder evaluateAuctionEntryGate med team.created_at/auction.created_at
// og returnerer den rigtige errorCode — de rene evalueringsregler er allerede
// fuldt unit-testet i newAccountGates.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker) {
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route-markør "${marker}" findes ikke i api.js`);
  // Blokken frem til næste route-registrering (samme teknik som
  // loanAmountValidation.routes.test.js) — robust uanset CRLF/LF og
  // hvor lang selve route-handleren er.
  const end = apiSource.indexOf("router.", start + marker.length);
  return apiSource.slice(start, end === -1 ? start + 4000 : end);
}

test("POST /auctions/:id/bid kalder evaluateAuctionEntryGate med team+auction created_at og afviser med auction_created_before_account", () => {
  const block = routeBlock('router.post("/auctions/:id/bid"');
  assert.match(block, /evaluateAuctionEntryGate\(\{/, "route skal kalde evaluateAuctionEntryGate");
  assert.match(block, /teamCreatedAt:\s*req\.team\.created_at/);
  assert.match(block, /auctionCreatedAt:\s*auction\.created_at/);
  assert.match(block, /errorCode:\s*"auction_created_before_account"/);
  assert.match(block, /res\.status\(403\)/);
});

test("PATCH /auctions/:id/proxy kalder SAMME gate (autobud kan ikke omgå bud-endpointets spærre)", () => {
  const block = routeBlock('router.patch("/auctions/:id/proxy"');
  assert.match(block, /evaluateAuctionEntryGate\(\{/, "proxy-route skal kalde evaluateAuctionEntryGate");
  assert.match(block, /teamCreatedAt:\s*req\.team\.created_at/);
  assert.match(block, /auctionCreatedAt:\s*auction\.created_at/);
  assert.match(block, /errorCode:\s*"auction_created_before_account"/);
  // Proxy-routens auctions-select var tidligere en eksplicit kolonneliste
  // (ikke "*") — created_at skal være tilføjet, ellers er auction.created_at altid undefined.
  assert.match(block, /\.from\("auctions"\)\s*\n\s*\.select\("[^"]*\bcreated_at\b[^"]*"\)/);
});

test("GET /finance/loans-relaterede fejlkoder for lånespærren findes i loanEngine (regressions-anker for i18n-nøgler)", async () => {
  const loanEngineSource = readFileSync(resolve(__dirname, "./loanEngine.js"), "utf8");
  for (const code of ["error.loanGateRaceDaysOnly", "error.loanGateAccountAgeOnly", "error.loanGateEither"]) {
    assert.match(loanEngineSource, new RegExp(code.replace(".", "\\.")), `${code} skal være en gyldig err.code i loanEngine.js`);
  }
});
