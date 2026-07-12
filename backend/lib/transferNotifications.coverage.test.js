// #2174 · Key-guard: hver title/messageCode som transferNotifications-builderne
// (og transferExecution's issueNotificationMetadata) kan emittere SKAL findes i
// BÅDE en + da backendMessages.json. Fanger en fremtidig builder-gren uden
// tilsvarende locale-nøgle → ellers ville EN-fallbacken (eller rå key) lække.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as builders from "./transferNotifications.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "..", "..", "frontend", "public", "locales");

function loadFlat(lang) {
  const raw = JSON.parse(readFileSync(join(LOCALES, lang, "backendMessages.json"), "utf8"));
  const out = new Set();
  (function walk(o, p) {
    for (const [k, v] of Object.entries(o)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object") walk(v, key);
      else out.add(key);
    }
  })(raw, "");
  return out;
}

const EN = loadFlat("en");
const DA = loadFlat("da");

// Repræsentative kald for HVER builder — dækker begge grene af enhver
// betinget messageCode (cash/ingen-cash, refund, buy-option, sæson-range).
const SAMPLES = [
  builders.buildBidReceivedNotification({ bidderName: "A", amount: 1, riderName: "R", riderId: "r" }),
  builders.buildAuctionOutbidNotification({ bidderName: "A", amount: 1, riderName: "R", riderId: "r" }),
  builders.buildWatchlistAuctionNotification({ riderName: "R", startPrice: 1, riderId: "r" }),
  builders.buildWatchlistListedNotification({ riderName: "R", askingPrice: 1, riderId: "r" }),
  builders.buildTransferInterestNotification({ riderName: "R", riderId: "r" }),
  builders.buildTransferOfferReceivedNotification({ buyerName: "B", amount: 1, riderName: "R", riderId: "r" }),
  builders.buildTransferNewBidNotification({ buyerName: "B", amount: 1, riderName: "R", riderId: "r" }),
  builders.buildTransferOfferAcceptedNotification({ sellerName: "S", riderName: "R", price: 1, riderId: "r" }),
  builders.buildTransferCounterAcceptedNotification({ buyerName: "B", riderName: "R", price: 1, riderId: "r" }),
  builders.buildTransferOfferRejectedNotification({ riderName: "R", riderId: "r" }),
  builders.buildTransferCounterNotification({ counterName: "C", riderName: "R", counterAmount: 1, riderId: "r" }),
  builders.buildTransferCancelledNotification({ actorName: "A", riderName: "R", riderId: "r" }),
  builders.buildTransferWithdrawnNotification({ buyerName: "B", riderName: "R", riderId: "r" }),
  builders.buildTransferOnAuctionCancelledNotification({ riderName: "R", riderId: "r" }),
  builders.buildTransferStaleCancelledNotification({ riderName: "R", riderId: "r" }),
  builders.buildTransferCompletedNotification({ riderName: "R", price: 1, deferred: false, riderId: "r" }),
  builders.buildTransferCompletedNotification({ riderName: "R", price: 1, deferred: true, riderId: "r" }),
  builders.buildSwapProposedNotification({ proposerName: "P", offeredName: "A", requestedName: "B", cash: 0, riderId: "r" }),
  builders.buildSwapProposedNotification({ proposerName: "P", offeredName: "A", requestedName: "B", cash: 5, riderId: "r" }),
  builders.buildSwapAcceptedNotification({ accepterName: "P", offeredName: "A", requestedName: "B", cash: 0 }),
  builders.buildSwapAcceptedNotification({ accepterName: "P", offeredName: "A", requestedName: "B", cash: 5 }),
  builders.buildSwapRejectedNotification({ rejecterName: "P" }),
  builders.buildSwapCounterNotification({ counterName: "C", offeredName: "A", requestedName: "B", counterCash: 5 }),
  builders.buildSwapCounterAcceptedNotification({ accepterName: "P" }),
  builders.buildSwapCompletedNotification({ offeredName: "A", requestedName: "B", deferred: false }),
  builders.buildSwapCompletedNotification({ offeredName: "A", requestedName: "B", deferred: true }),
  builders.buildSwapPulledOutNotification({ actorName: "P" }),
  builders.buildSwapCancelledStaleNotification({ riderName: "R" }),
  builders.buildAdminTransferCancelledNotification({ riderName: "R", reason: "" }),
  builders.buildAdminTransferCancelledNotification({ riderName: "R", reason: "x" }),
  builders.buildAdminSwapCancelledNotification({ offeredName: "A", requestedName: "B", reason: "" }),
  builders.buildAdminSwapCancelledNotification({ offeredName: "A", requestedName: "B", reason: "x" }),
];

// describeTransferIssue/describeSwapIssue-koder (fra transferExecution) — hardkodet
// her fordi funktionerne er private i modulet; matcher notif.transfer.issue.*.
const ISSUE_CODES = [
  "notif.transfer.issue.title",
  "notif.transfer.issue.swapTitle",
  "notif.transfer.issue.sellerNoLongerOwns",
  "notif.transfer.issue.sellerSquadTooSmall",
  "notif.transfer.issue.buyerSquadFull",
  "notif.transfer.issue.buyerCannotAfford",
  "notif.transfer.issue.offeredMoved",
  "notif.transfer.issue.requestedMoved",
  "notif.transfer.issue.proposingCannotAfford",
  "notif.transfer.issue.receivingCannotAfford",
];

test("alle builder-koder findes i en+da backendMessages.json", () => {
  const missing = [];
  const codes = new Set(ISSUE_CODES);
  for (const s of SAMPLES) {
    if (s.metadata?.titleCode) codes.add(s.metadata.titleCode);
    if (s.metadata?.messageCode) codes.add(s.metadata.messageCode);
  }
  for (const code of codes) {
    if (!EN.has(code)) missing.push(`en mangler ${code}`);
    if (!DA.has(code)) missing.push(`da mangler ${code}`);
  }
  assert.equal(missing.length, 0, missing.join("\n"));
});

test("EN-fallback title/message indeholder ingen danske tegn", () => {
  const danish = /[æøåÆØÅ]/;
  for (const s of SAMPLES) {
    assert.doesNotMatch(s.title || "", danish, `dansk i title: ${s.title}`);
    assert.doesNotMatch(s.message || "", danish, `dansk i message: ${s.message}`);
  }
});
