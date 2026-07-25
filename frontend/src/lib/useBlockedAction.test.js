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
