// #2718/#2719/#2254 — regressionsværn for "døde klik".
//
// De to invarianter der faktisk holder spilleren fri af det oprindelige symptom:
//   1. En blokeret kontrol må ALDRIG bruge `disabled` (så ville klikket forsvinde
//      i browseren, og spilleren får intet svar — han trykker bare igen).
//   2. En blokeret kontrol skal pege på en synlig begrundelse (aria-describedby).
//
// Hooket kan ikke køres uden React-runtime i node --test, så kontrakten testes på
// kilden — samme mønster som ui/*.source.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), "utf8");

const hook = read("useBlockedAction.js");
const note = read("../components/ui/BlockedNote.jsx");
const bidding = read("useAuctionBidding.js");
const manage = read("../components/rider/RiderManageActions.jsx");
const auctions = read("../pages/AuctionsPage.jsx");

test("blokerede kontroller bruger aria-disabled, ALDRIG disabled", () => {
  assert.match(hook, /"aria-disabled":\s*true/);
  assert.ok(
    !/\bdisabled:\s*true/.test(hook),
    "en blokeret knap må ikke sættes disabled — så sluger browseren klikket og spilleren får intet svar (#2718)",
  );
});

test("blokerede kontroller peger på en synlig begrundelse", () => {
  assert.match(hook, /"aria-describedby":\s*reasonId/);
  assert.match(note, /id=\{id\}/);
  assert.match(note, /role="status"/);
});

test("guard kører IKKE handleren når kontrollen er blokeret", () => {
  assert.match(hook, /if\s*\(!blocked\)\s*return\s+run\?\.\(event\)/);
  assert.match(hook, /setPulseKey\(\(n\)\s*=>\s*n\s*\+\s*1\)/);
});

test("auktions-hooket har begrundelser for BÅDE bud og autobud-loft", () => {
  assert.match(bidding, /bidBlockedReason/);
  assert.match(bidding, /proxyBlockedReason/);
  assert.match(bidding, /auctions:bid\.blockedBelowMin/);
  assert.match(bidding, /auctions:bid\.proxy\.blockedBelowMin/);
});

test("auktions-knapperne er ikke længere disabled af beløbs-validering (#2719)", () => {
  assert.ok(
    !/disabled=\{bidStatus === "loading" \|\| bidAmount < minBid\}/.test(auctions),
    "bud-knappen må kun være disabled mens et kald kører — validering går via aria-disabled + BlockedNote",
  );
  assert.ok(
    !/disabled=\{proxyStatus === "loading" \|\| proxyInput < minBid\}/.test(auctions),
    "autobud-Gem må kun være disabled mens et kald kører — validering går via aria-disabled + BlockedNote",
  );
  assert.match(auctions, /<BlockedNote/);
});

test("fjern-autobud kaster ikke længere resultatet væk (#2719)", () => {
  assert.match(bidding, /reportActionFailure\("auction_proxy_remove"/);
  assert.match(bidding, /setProxyStatus\("loading"\)/);
  assert.ok(
    !/async function handleRemoveProxy\(\)\s*\{\s*await onRemoveProxy\(auction\.id\);\s*\}/.test(bidding),
    "resultatet af fjern-kaldet skal håndteres, ikke ignoreres",
  );
});

// #3619: samme klasse som #2719, men på throw-siden. Kalder-siderne
// (AuctionsPage/RiderStatsPage) laver bar `await fetch(...)` uden try/catch, så
// et tabt net midt i kaldet — mobil-WebKit kaster "TypeError: Load failed",
// CYCLINGZONE-4E — afviste onConfirm-promisen unhandled: status stod fast på
// "loading", og spilleren fik intet svar. Invarianten er derfor: ALLE tre
// kald ud af hooket skal ligge i en try/catch der lander i en fejl-status.
function handlerBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `fandt ikke ${startMarker} i useAuctionBidding.js`);
  const end = endMarker ? source.indexOf(endMarker, start) : source.length;
  assert.ok(end > start, `fandt ikke ${endMarker} efter ${startMarker}`);
  return source.slice(start, end);
}

const OUTBOUND_CALLS = [
  { call: "onBid", start: "function handleBid()", end: "function handleSaveProxy()", statusReset: /setBidStatus\("error"\)/ },
  { call: "onSetProxy", start: "function handleSaveProxy()", end: "async function handleRemoveProxy()", statusReset: /setProxyStatus\("error"\)/ },
  { call: "onRemoveProxy", start: "async function handleRemoveProxy()", end: "return {", statusReset: /fail\(\{ text: t\("auctions:error\.proxyRemoveFailed"\), cause \}\)/ },
];

for (const { call, start, end, statusReset } of OUTBOUND_CALLS) {
  test(`${call} kaldes inde i try/catch — et tabt net må ikke efterlade knappen i loading (#3619)`, () => {
    const body = handlerBody(bidding, start, end);
    assert.match(
      body,
      new RegExp(`try\\s*\\{[^}]*await ${call}\\(`, "s"),
      `await ${call}(...) skal ligge i en try — ellers bliver netværksfejlen en unhandled rejection`,
    );
    assert.match(body, /catch \(cause\) \{/);
    // Fanget er ikke nok: catch-grenen skal forlade loading-tilstanden.
    assert.match(body, statusReset);
    assert.match(body, /cause,?\s*[,}]/, "den kastede Error skal videre til Sentry som cause");
  });
}

test("netværksfejl viser en lokaliseret besked, ikke en tom fejl-status (#3619)", () => {
  const hits = bidding.match(/t\("errors:generic\.networkError"\)/g) || [];
  assert.equal(hits.length, 2, "både bud og autobud-gem skal vise netværks-teksten");
  assert.match(bidding, /setBidStatus\("error"\);\s*setErrorText\(t\("errors:generic\.networkError"\)\)/);
  assert.match(bidding, /setProxyStatus\("error"\);\s*setProxyErrorText\(t\("errors:generic\.networkError"\)\)/);
});

test("kontraktforlængelse har dobbelt-submit-værn + Sentry-rapportering (#2718)", () => {
  assert.match(manage, /inFlight\s*=\s*useRef\(false\)/);
  assert.match(manage, /if \(inFlight\.current\) return;/);
  assert.match(manage, /reportActionFailure\("rider_contract_extend"/);
  // Tilbuddet er brugt op efter en forlængelse — ellers viser en ny åbning den
  // løn der lige er forhandlet væk.
  assert.match(manage, /setExtendQuote\(null\)/);
});

test("bekræft-knappen siger hvad den laver i stedet for bare '...' (#2718)", () => {
  assert.match(manage, /manage\.extend\.loadingTerms/);
  assert.match(manage, /manage\.extend\.working/);
  assert.ok(
    !/\{extendBusy \? "\.\.\." :/.test(manage),
    "en bar '...' er ikke et arbejds-signal — brug spinner + label",
  );
});
