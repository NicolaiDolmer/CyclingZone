// #6801 · Foerste batch af backend-spillertekst flyttet til noegler.
//
// Kontrakten: DA-teksten er den samme som foer (den var hardkodet dansk til
// ALLE), EN-teksten er ny (en en-manager fik dansk). Begge sprog renderes fra
// backendMessages via samme translate() som Discord-DM og in-app-fallback.

import test from "node:test";
import assert from "node:assert/strict";
import { translate } from "./i18nServer.js";
import { buildKeyedNotification } from "./notificationService.js";

const da = (key, params) => translate(key, params, { language: "da" });
const en = (key, params) => translate(key, params, { language: "en" });

test("admin-annulleret auktion: DA uaendret, EN paa engelsk", () => {
  const p = { rider: "Rider A" };
  assert.equal(da("notif.auction.cancelledTitle"), "Auktion annulleret");
  assert.equal(
    da("notif.auction.adminCancelledBidder", p),
    "Auktionen på Rider A er annulleret af en admin. Dit bud er frigivet og din balance er igen disponibel.",
  );
  assert.equal(da("notif.auction.adminCancelledSeller", p), "Din auktion på Rider A er annulleret af en admin.");
  assert.equal(en("notif.auction.cancelledTitle"), "Auction cancelled");
  assert.match(en("notif.auction.adminCancelledBidder", p), /^The auction for Rider A was cancelled by an admin\./);
  assert.equal(en("notif.auction.adminCancelledSeller", p), "Your auction for Rider A was cancelled by an admin.");
});

test("handel afventer bekraeftelse: sælger/koeber-gren og DA uaendret", () => {
  const seller = { role: "seller", riderName: "Rider A" };
  const buyer = { role: "buyer", riderName: "Rider A" };
  assert.equal(da("notif.transfer.confirmPending.title"), "Handlen afventer din bekræftelse");
  assert.equal(
    da("notif.transfer.confirmPending.message", seller),
    "Sælger har bekræftet handlen på Rider A. Bekræft for at gennemføre.",
  );
  assert.equal(
    da("notif.transfer.confirmPending.message", buyer),
    "Køber har bekræftet handlen på Rider A. Bekræft for at gennemføre.",
  );
  assert.equal(
    en("notif.transfer.confirmPending.message", buyer),
    "The buyer has confirmed the deal on Rider A. Confirm to complete it.",
  );
});

test("byttehandel afventer bekraeftelse: begge sider", () => {
  assert.equal(da("notif.transfer.swapConfirmPending.title"), "Byttehandel afventer din bekræftelse");
  assert.equal(
    da("notif.transfer.swapConfirmPending.message", { side: "proposing" }),
    "Det foreslående hold har bekræftet byttehandlen. Bekræft for at gennemføre.",
  );
  assert.equal(
    da("notif.transfer.swapConfirmPending.message", { side: "receiving" }),
    "Det modtagende hold har bekræftet byttehandlen. Bekræft for at gennemføre.",
  );
  assert.equal(
    en("notif.transfer.swapConfirmPending.message", { side: "receiving" }),
    "The receiving team has confirmed the swap. Confirm to complete it.",
  );
});

test("autobud-beskeder: DA uaendret (bortset fra tankestregen i 'stoppet')", () => {
  assert.equal(da("notif.autoBidStopped.title"), "Dit autobud er stoppet");
  assert.equal(
    da("notif.autoBidStopped.message", { riderName: "Rider A" }),
    "Dit autobud på Rider A stoppede pga. utilstrækkelig balance. Sørg for at have penge på kontoen for at byde igen.",
  );
  assert.equal(
    da("notif.autoBidMatched.message", { leaderName: "Hold A", riderName: "Rider A" }),
    "Hold A's autobud matchede dit bud på Rider A og beholder føringen ved identisk bud",
  );
  assert.equal(da("notif.autoBidOutbid.message", { bidderName: "Hold B", riderName: "Rider A" }), "Hold B's autobud overbød dig på Rider A");
  assert.equal(
    en("notif.autoBidOutbid.message", { bidderName: "Team B", riderName: "Rider A" }),
    "Team B's auto-bid outbid you on Rider A",
  );
  // De to api.js-kaldsteder genbruger autoBidPlaced + de eksisterende titler.
  assert.equal(da("notif.autoBidPlaced.message", { bidderName: "Hold B", amount: 500, riderName: "Rider A" }), "Hold B's autobud bød 500 CZ$ på Rider A");
});

test("rytter ankommet: alle tre aarsager, DA og EN", () => {
  const base = { riderName: "Rider A" };
  assert.equal(da("notif.riderArrived.title"), "Rytteren er ankommet");
  assert.equal(
    da("notif.riderArrived.message", { ...base, reason: "tourFinished", raceName: "Tour X" }),
    "Rider A er nu skiftet til dit hold. Tour X er kørt færdigt.",
  );
  assert.equal(
    da("notif.riderArrived.message", { ...base, reason: "tourFinishedUnnamed" }),
    "Rider A er nu skiftet til dit hold. Hans etapeløb er kørt færdigt.",
  );
  assert.equal(
    da("notif.riderArrived.message", { ...base, reason: "dealCompleted" }),
    "Rider A er nu skiftet til dit hold. Hans handel er nu gennemført.",
  );
  assert.equal(
    en("notif.riderArrived.message", { ...base, reason: "tourFinished", raceName: "Tour X" }),
    "Rider A has joined your team. Tour X has finished.",
  );
});

test("trup-haandhaevelse: plural-linjer, tomme linjer udelades, EN-tekst uaendret", () => {
  const onlyPurchases = {
    purchasedCount: 3, purchasedNames: "A, B, C",
    deferredCount: 0, deferredNames: "",
    soldCount: 0, soldNames: "",
    salesDeferredCount: 0,
    fine: 1000, points: 2,
  };
  assert.equal(
    en("notif.squadEnforced.message", onlyPurchases),
    "Auto-purchased 3 riders: A, B, C\nFine: 1000 CZ$ · Deduction: 2 points",
  );
  const mixed = {
    purchasedCount: 1, purchasedNames: "A",
    deferredCount: 1, deferredNames: "A",
    soldCount: 2, soldNames: "D, E",
    salesDeferredCount: 1,
    fine: 500, points: 1,
  };
  assert.equal(
    en("notif.squadEnforced.message", mixed),
    [
      "Auto-purchased 1 rider: A",
      "1 rider will join the team once their ongoing stage race finishes: A",
      "Auto-sold 2 riders: D, E",
      "1 rider in an ongoing stage race will be sold after the race instead",
      "Fine: 500 CZ$ · Deduction: 1 points",
    ].join("\n"),
  );
  assert.equal(
    da("notif.squadEnforced.message", onlyPurchases),
    "Auto-købte 3 ryttere: A, B, C\nBøde: 1000 CZ$ · Fradrag: 2 point",
  );
  assert.equal(en("notif.squadEnforced.title"), "Squad size enforced");
  assert.equal(da("notif.squadEnforced.title"), "Holdstørrelse håndhævet");
});

test("buildKeyedNotification giver EN-fallback + koder til frontend for batchen", () => {
  const n = buildKeyedNotification({
    titleCode: "notif.auction.cancelledTitle",
    messageCode: "notif.auction.adminCancelledSeller",
    messageParams: { rider: "Rider A" },
  });
  assert.equal(n.title, "Auction cancelled");
  assert.equal(n.message, "Your auction for Rider A was cancelled by an admin.");
  assert.equal(n.metadata.titleCode, "notif.auction.cancelledTitle");
  assert.deepEqual(n.metadata.messageParams, { rider: "Rider A" });
});
