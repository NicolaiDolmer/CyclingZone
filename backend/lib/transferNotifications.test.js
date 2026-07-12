// #2174 · Verificér at transfer/auktion/swap/leje-notification-builders emitter
// EN-first title/message + korrekte i18n-koder + params (indbakken følger sprog).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBidReceivedNotification,
  buildAuctionOutbidNotification,
  buildWatchlistAuctionNotification,
  buildTransferOfferReceivedNotification,
  buildTransferOfferAcceptedNotification,
  buildSwapProposedNotification,
  buildSwapCompletedNotification,
  buildAdminTransferCancelledNotification,
} from "./transferNotifications.js";

test("bidReceived: EN-first + code + params + riderId", () => {
  const n = buildBidReceivedNotification({ bidderName: "Team A", amount: 12000, riderName: "Jan Ullrich", riderId: "r1" });
  assert.equal(n.type, "bid_received");
  assert.match(n.title, /New bid/);
  assert.doesNotMatch(n.title + n.message, /[æøåÆØÅ]/, "ingen dansk i EN-fallback");
  assert.equal(n.metadata.titleCode, "notif.transfer.bidReceived.title");
  assert.equal(n.metadata.messageCode, "notif.transfer.bidReceived.message");
  assert.equal(n.metadata.messageParams.amount, 12000, "amount er råt tal (frontend formaterer locale-aware)");
  assert.equal(n.metadata.riderId, "r1");
});

test("auctionOutbid genbruger bidReceived-message-koden", () => {
  const n = buildAuctionOutbidNotification({ bidderName: "B", amount: 5, riderName: "R", riderId: "r2" });
  assert.equal(n.metadata.titleCode, "notif.transfer.auctionOutbid.title");
  assert.equal(n.metadata.messageCode, "notif.transfer.bidReceived.message");
});

test("watchlistAuction: startPrice sendes råt", () => {
  const n = buildWatchlistAuctionNotification({ riderName: "R", startPrice: 90000, riderId: "r3" });
  assert.equal(n.metadata.messageParams.startPrice, 90000);
  assert.equal(n.metadata.riderId, "r3");
});

test("transferOfferReceived + accepted: koder + params", () => {
  const recv = buildTransferOfferReceivedNotification({ buyerName: "Buyer", amount: 300, riderName: "R", riderId: "r4" });
  assert.equal(recv.metadata.messageCode, "notif.transfer.offerReceived.message");
  const acc = buildTransferOfferAcceptedNotification({ sellerName: "Seller", riderName: "R", price: 300, riderId: "r4" });
  assert.equal(acc.metadata.messageParams.price, 300);
});

test("swapProposed: cash-variant vælger messageCash", () => {
  const withCash = buildSwapProposedNotification({ proposerName: "P", offeredName: "A", requestedName: "B", cash: 500, riderId: "r5" });
  assert.equal(withCash.metadata.messageCode, "notif.transfer.swapProposed.messageCash");
  assert.equal(withCash.metadata.messageParams.cashSign, "+");
  const noCash = buildSwapProposedNotification({ proposerName: "P", offeredName: "A", requestedName: "B", cash: 0, riderId: "r5" });
  assert.equal(noCash.metadata.messageCode, "notif.transfer.swapProposed.message");
});

test("swapCompleted: deferred vælger messageDeferred", () => {
  const def = buildSwapCompletedNotification({ offeredName: "A", requestedName: "B", deferred: true });
  assert.equal(def.metadata.messageCode, "notif.transfer.swapCompleted.messageDeferred");
  const now = buildSwapCompletedNotification({ offeredName: "A", requestedName: "B", deferred: false });
  assert.equal(now.metadata.messageCode, "notif.transfer.swapCompleted.message");
});


test("admin-annulleringer: reason-variant vælger messageReason", () => {
  const noReason = buildAdminTransferCancelledNotification({ riderName: "R", reason: "" });
  assert.equal(noReason.metadata.messageCode, "notif.transfer.adminTransferCancelled.message");
  const withReason = buildAdminTransferCancelledNotification({ riderName: "R", reason: "duplicate deal" });
  assert.equal(withReason.metadata.messageCode, "notif.transfer.adminTransferCancelled.messageReason");
  assert.equal(withReason.metadata.messageParams.reason, "duplicate deal");
});

