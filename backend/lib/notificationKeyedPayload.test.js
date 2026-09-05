import test from "node:test";
import assert from "node:assert/strict";
import { buildKeyedNotification, notifyUserWithKeys } from "./notificationService.js";
import { translate, bundledLanguages } from "./i18nServer.js";

// #4734 · Kontrakten for en noegle-baaret notifikation:
//   • metadata baerer titleCode/titleParams/messageCode/messageParams — det er
//     dem frontend rendrer i modtagerens users.language (#666).
//   • title/message er FALLBACK (dedup-noegle + gamle klienter + e-mail-digest)
//     og skal vaere UDLEDT af noeglen, ikke skrevet ved siden af. Det er praecis
//     dét de 20 auktions-kaldsteder brød foer #4734.

const AUCTION_WON = {
  titleCode: "notif.auction.wonTitle",
  messageCode: "notif.auction.wonMessage",
  messageParams: { rider: "Tadej P", price: 1200 },
};

test("buildKeyedNotification laegger noegle + parametre i metadata", () => {
  const payload = buildKeyedNotification({ ...AUCTION_WON, metadata: { riderId: "r1" } });
  assert.equal(payload.metadata.titleCode, "notif.auction.wonTitle");
  assert.equal(payload.metadata.messageCode, "notif.auction.wonMessage");
  assert.deepEqual(payload.metadata.messageParams, { rider: "Tadej P", price: 1200 });
  // Kalderens egen metadata overlever (riderId bruges af notifikations-linket).
  assert.equal(payload.metadata.riderId, "r1");
});

test("fallback-teksten er UDLEDT af noeglen, ikke en parallel streng", () => {
  const payload = buildKeyedNotification(AUCTION_WON);
  assert.equal(payload.title, translate("notif.auction.wonTitle", {}, { language: "en" }));
  assert.equal(payload.message, translate("notif.auction.wonMessage", AUCTION_WON.messageParams, { language: "en" }));
  assert.equal(payload.message, "Tadej P is now on your team for 1200 CZ$");
});

test("noeglerne kan rendres i hvert bundlet sprog — ingen af dem giver bare noeglen tilbage", () => {
  for (const lng of bundledLanguages()) {
    const title = translate(AUCTION_WON.titleCode, {}, { language: lng });
    const message = translate(AUCTION_WON.messageCode, AUCTION_WON.messageParams, { language: lng });
    assert.notEqual(title, AUCTION_WON.titleCode, `titel mangler i ${lng}`);
    assert.notEqual(message, AUCTION_WON.messageCode, `besked mangler i ${lng}`);
    assert.match(message, /Tadej P/, `rytternavnet blev tabt i ${lng}`);
  }
  // Og de to sprog siger faktisk noget forskelligt (ellers er da en kopi af en).
  assert.notEqual(
    translate(AUCTION_WON.messageCode, AUCTION_WON.messageParams, { language: "da" }),
    translate(AUCTION_WON.messageCode, AUCTION_WON.messageParams, { language: "en" }),
  );
});

test("en manglende noegle giver noeglen selv, aldrig en tom notifikation", () => {
  const payload = buildKeyedNotification({ titleCode: "notif.doesNot.exist", messageCode: "notif.doesNot.exist2" });
  assert.equal(payload.title, "notif.doesNot.exist");
  assert.equal(payload.message, "notif.doesNot.exist2");
});

test("notifyUserWithKeys sender noegle, parametre OG fallback videre til notifyUser", async () => {
  const calls = [];
  const res = await notifyUserWithKeys({
    supabase: null,
    userId: "u1",
    type: "auction_won",
    ...AUCTION_WON,
    relatedId: "a1",
    metadata: { riderId: "r1" },
    notify: async (args) => { calls.push(args); return { delivered: true, deduped: false }; },
  });

  assert.equal(calls.length, 1);
  const sent = calls[0];
  assert.equal(sent.userId, "u1");
  assert.equal(sent.type, "auction_won");
  assert.equal(sent.relatedId, "a1");
  assert.equal(sent.title, "You won the auction");
  assert.equal(sent.message, "Tadej P is now on your team for 1200 CZ$");
  assert.equal(sent.metadata.messageCode, "notif.auction.wonMessage");
  assert.equal(sent.metadata.riderId, "r1");
  assert.deepEqual(res, { delivered: true, deduped: false });
});
