import test from "node:test";
import assert from "node:assert/strict";
import {
  checkChoice,
  initialChoice,
  issueMessage,
  lengthParts,
  modeForAmount,
  primaryLabelKey,
  summaryFor,
} from "./buyerCardModel.ts";

// Opfundne eksempelbeloeb, ikke spillets tal.
const AUTO = 1500;

test("an amount below the auto price is a bid, at or above it starts an auction", () => {
  assert.equal(modeForAmount(1499, AUTO), "bid");
  assert.equal(modeForAmount(1500, AUTO), "auction");
  assert.equal(modeForAmount(1600, AUTO), "auction");
  assert.equal(modeForAmount(null, AUTO), null);
  assert.equal(modeForAmount(0, AUTO), null);
  assert.equal(modeForAmount(10.5, AUTO), null);
});

test("the card opens on the asking price and the segment that amount belongs to", () => {
  assert.deepEqual(initialChoice(1200, AUTO), { mode: "bid", amount: 1200 });
  // Auto-prisen maa vaere lig udbudsprisen: saa hoerer standardbeloebet til auktionen.
  assert.deepEqual(initialChoice(1500, AUTO), { mode: "auction", amount: 1500 });
  assert.deepEqual(initialChoice(null, AUTO), { mode: "bid", amount: null });
});

test("a bid from the auto price and up is refused and offers the auction instead", () => {
  const check = checkChoice({ mode: "bid", amount: 1600, autoPrice: AUTO, hours: "0", minutes: "30" });
  assert.deepEqual(check, { issue: { code: "bidFromAutoPrice", price: AUTO }, switchTo: "auction" });
  assert.deepEqual(issueMessage(check.issue!), { key: "buyerCard.errorBidFromAuto", price: AUTO });
  assert.deepEqual(
    checkChoice({ mode: "bid", amount: 1500, autoPrice: AUTO, hours: "0", minutes: "30" }).switchTo,
    "auction",
  );
});

test("an auction below the auto price is refused and offers the bid instead", () => {
  const check = checkChoice({ mode: "auction", amount: 1200, autoPrice: AUTO, hours: "0", minutes: "30" });
  assert.deepEqual(check, { issue: { code: "auctionBelowAutoPrice", price: AUTO }, switchTo: "bid" });
  assert.deepEqual(issueMessage(check.issue!), { key: "buyerCard.errorAuctionMinimum", price: AUTO });
});

test("switching segment keeps the amount and checks it against the new choice", () => {
  // Samme beloeb, to valg: gyldigt som bud, fejl som auktion (og omvendt).
  const amount = 1400;
  assert.equal(checkChoice({ mode: "bid", amount, autoPrice: AUTO, hours: "0", minutes: "30" }).issue, null);
  assert.equal(
    checkChoice({ mode: "auction", amount, autoPrice: AUTO, hours: "0", minutes: "30" }).issue?.code,
    "auctionBelowAutoPrice",
  );
  const high = 1700;
  assert.equal(checkChoice({ mode: "auction", amount: high, autoPrice: AUTO, hours: "0", minutes: "30" }).issue, null);
  assert.equal(
    checkChoice({ mode: "bid", amount: high, autoPrice: AUTO, hours: "0", minutes: "30" }).issue?.code,
    "bidFromAutoPrice",
  );
});

test("an empty amount asks for an amount and offers no switch", () => {
  for (const mode of ["bid", "auction"] as const) {
    const check = checkChoice({ mode, amount: null, autoPrice: AUTO, hours: "0", minutes: "30" });
    assert.deepEqual(check, { issue: { code: "empty" }, switchTo: null });
    assert.equal(issueMessage(check.issue!).key, "buyerCard.errorEmpty");
  }
});

test("the auction length uses the same 30 min to 24 hour bounds as today", () => {
  const at = (hours: string, minutes: string) =>
    checkChoice({ mode: "auction", amount: 1600, autoPrice: AUTO, hours, minutes }).issue?.code ?? null;
  assert.equal(at("0", "30"), null);
  assert.equal(at("24", "0"), null);
  assert.equal(at("0", "29"), "duration");
  assert.equal(at("24", "1"), "duration");
  assert.equal(at("", "30"), "duration");
  // Laengden er ligegyldig for et bud.
  assert.equal(checkChoice({ mode: "bid", amount: 1400, autoPrice: AUTO, hours: "", minutes: "" }).issue, null);
  assert.equal(issueMessage({ code: "duration" }).key, "buyerCard.errorDuration");
});

test("an auction amount above the database limit is refused without a switch", () => {
  const check = checkChoice({ mode: "auction", amount: 2147483648, autoPrice: AUTO, hours: "0", minutes: "30" });
  assert.deepEqual(check, { issue: { code: "auctionAmountInvalid" }, switchTo: null });
  assert.equal(issueMessage(check.issue!).key, "buyerCard.errorAuctionAmount");
});

test("the summary says what happens, with amount and length", () => {
  assert.deepEqual(summaryFor({ mode: "bid", amount: 1400, hours: "0", minutes: "30" }), {
    key: "buyerCard.summaryBid",
    amount: 1400,
    length: null,
  });
  assert.deepEqual(summaryFor({ mode: "auction", amount: 1600, hours: "2", minutes: "45" }), {
    key: "buyerCard.summaryAuction",
    amount: 1600,
    length: { hours: 2, minutes: 45 },
  });
  assert.deepEqual(lengthParts("0", "90"), null);
  assert.deepEqual(lengthParts("1", "5"), { hours: 1, minutes: 5 });
});

test("the one gold button names the action of the chosen segment", () => {
  assert.equal(primaryLabelKey("bid"), "buyerCard.sendBid");
  assert.equal(primaryLabelKey("auction"), "buyerCard.startAuction");
});
