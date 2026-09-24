// #5242 — grænsefladekontrakten mellem useAuctionBidding.js og dens
// kaldere (onBid/onSetProxy/onRemoveProxy, implementeret af RiderStatsPage.jsx
// og AuctionsPage.jsx). useBlockedAction.test.js dækker allerede at kaldene
// ligger i try/catch (#3619); denne fil verificerer den anden halvdel af
// kontrakten, som PR #5554's "Rettelser 23/9 aften" hang på: hooket viser KUN
// sin netværksfejl-tekst/telemetri når kaldet KASTER — et resultat der bare
// returnerer { ok:false } rammer den almindelige fejl-gren i stedet. Havde
// siderne ikke kastet eksplicit på res.networkError (se
// apiFetchNetworkBranch.test.js), var denne gren derfor UNÅELIG for en
// transportfejl.
//
// Hooket kan ikke køres uden React-runtime i node --test, så kontrakten testes
// på kilden — samme mønster som useBlockedAction.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), "utf8");

const bidding = read("useAuctionBidding.js");

function handlerBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `fandt ikke ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `fandt ikke ${endMarker} efter ${startMarker}`);
  return source.slice(start, end);
}

test("handleBid: netværksteksten vises KUN i catch-grenen (et kastet onBid), ikke ved result.ok===false", () => {
  const body = handlerBody(bidding, "function handleBid()", "function handleSaveProxy()");
  const catchBranch = body.slice(body.indexOf("catch (cause) {"), body.indexOf("if (result.race)"));
  const resultBranch = body.slice(body.indexOf("if (result.race)"));

  assert.match(catchBranch, /setErrorText\(t\("errors:generic\.networkError"\)\)/, "kastet onBid skal vise netværksteksten");
  assert.match(catchBranch, /reportActionFailure\("auction_bid", \{\s*reason: "network"/, "kastet onBid skal rapportere reason:network");
  assert.ok(
    !/errors:generic\.networkError/.test(resultBranch),
    "et returneret { ok:false } (ikke kastet) må ikke vise netværksteksten — den gren læser result.error",
  );
  assert.match(resultBranch, /setErrorText\(result\.error \|\| ""\)/);
});

test("handleSaveProxy: netværksteksten vises KUN i catch-grenen (et kastet onSetProxy), ikke ved result.ok===false", () => {
  const body = handlerBody(bidding, "function handleSaveProxy()", "async function handleRemoveProxy()");
  const catchBranch = body.slice(body.indexOf("catch (cause) {"), body.indexOf("setProxyStatus(result.ok"));
  const resultBranch = body.slice(body.indexOf("setProxyStatus(result.ok"));

  assert.match(catchBranch, /setProxyErrorText\(t\("errors:generic\.networkError"\)\)/, "kastet onSetProxy skal vise netværksteksten");
  assert.match(catchBranch, /reportActionFailure\("auction_proxy_save", \{\s*reason: "network"/, "kastet onSetProxy skal rapportere reason:network");
  assert.ok(
    !/errors:generic\.networkError/.test(resultBranch),
    "et returneret { ok:false } (ikke kastet) må ikke vise netværksteksten — den gren læser result.error",
  );
});

test("handleRemoveProxy: en kastet onRemoveProxy rapporteres til Sentry med cause (samme kastekontrakt som de to andre)", () => {
  const body = handlerBody(bidding, "async function handleRemoveProxy()", "return {");
  const catchBranch = body.slice(body.indexOf("} catch (cause) {"));
  assert.match(catchBranch, /fail\(\{ text: t\("auctions:error\.proxyRemoveFailed"\), cause \}\)/);
  assert.match(body, /reportActionFailure\("auction_proxy_remove", \{\s*reason: detail\.reason,\s*cause: detail\.cause/);
});

test("alle tre handlere kalder deres onX(...) inde i EN try — bekræfter hvorfor sidernes eksplicitte throw (#5242) er nødvendig", () => {
  assert.equal((bidding.match(/try \{/g) || []).length, 3, "handleBid, handleSaveProxy og handleRemoveProxy skal hver have præcis én try");
  assert.equal((bidding.match(/catch \(cause\) \{/g) || []).length, 3);
});
