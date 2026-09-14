import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRADE_REPORT_TYPES,
  TRADE_REPORT_MESSAGE_MIN_LENGTH,
  TRADE_REPORT_MESSAGE_MAX_LENGTH,
  parseTransferEventId,
  isTradeReportable,
  validateTradeReport,
} from "./tradeReport.js";

test("TRADE_REPORT_TYPES excludes academy — it has no counterparty to report against", () => {
  assert.deepEqual(TRADE_REPORT_TYPES, ["auction", "transfer", "swap"]);
  assert.equal(TRADE_REPORT_TYPES.includes("academy"), false);
});

test("parseTransferEventId splits the teamTransferHistory.js composite id", () => {
  assert.deepEqual(parseTransferEventId("auction:abc-123"), { type: "auction", id: "abc-123" });
  assert.deepEqual(parseTransferEventId("transfer:xyz"), { type: "transfer", id: "xyz" });
  assert.deepEqual(parseTransferEventId("swap:uuid-with-colons:in-it"), { type: "swap", id: "uuid-with-colons:in-it" });
});

test("parseTransferEventId returns null for malformed/missing ids", () => {
  assert.equal(parseTransferEventId(""), null);
  assert.equal(parseTransferEventId("no-colon-here"), null);
  assert.equal(parseTransferEventId(":leading-colon"), null);
  assert.equal(parseTransferEventId(null), null);
  assert.equal(parseTransferEventId(undefined), null);
});

test("isTradeReportable accepts a completed trade with a real counterparty", () => {
  assert.equal(isTradeReportable({ id: "auction:a1", counterparty: { id: "t2" }, no_sale: false }), true);
  assert.equal(isTradeReportable({ id: "transfer:o1", counterparty: { id: "t2" } }), true);
  assert.equal(isTradeReportable({ id: "swap:s1", counterparty: { id: "t2" } }), true);
});

test("isTradeReportable rejects academy events (no counterparty by design)", () => {
  assert.equal(isTradeReportable({ id: "academy:g1", counterparty: null }), false);
});

test("isTradeReportable rejects a no_sale auction — nothing changed hands", () => {
  assert.equal(isTradeReportable({ id: "auction:a-nosale", counterparty: null, no_sale: true }), false);
});

test("isTradeReportable rejects an event without a counterparty (e.g. guaranteed AI sale with no join)", () => {
  assert.equal(isTradeReportable({ id: "auction:a1", counterparty: null, no_sale: false }), false);
});

test("isTradeReportable rejects a malformed/missing event", () => {
  assert.equal(isTradeReportable(null), false);
  assert.equal(isTradeReportable(undefined), false);
  assert.equal(isTradeReportable({ id: "not-a-composite-id", counterparty: { id: "t2" } }), false);
});

test("validateTradeReport rejects a message under the minimum length", () => {
  assert.equal(validateTradeReport({ message: "" }), "report.tooShort");
  assert.equal(validateTradeReport({ message: "   " }), "report.tooShort");
  assert.equal(validateTradeReport({ message: "short" }), "report.tooShort");
  assert.equal(validateTradeReport({ message: undefined }), "report.tooShort");
});

test("validateTradeReport rejects a message over the max length", () => {
  const tooLong = "a".repeat(TRADE_REPORT_MESSAGE_MAX_LENGTH + 1);
  assert.equal(validateTradeReport({ message: tooLong }), "report.tooLong");
});

test("validateTradeReport accepts a message within bounds", () => {
  assert.equal(validateTradeReport({ message: "This trade looked off to me." }), null);
});

test("validateTradeReport accepts messages at the exact boundaries", () => {
  assert.equal(validateTradeReport({ message: "a".repeat(TRADE_REPORT_MESSAGE_MIN_LENGTH) }), null);
  assert.equal(validateTradeReport({ message: "a".repeat(TRADE_REPORT_MESSAGE_MAX_LENGTH) }), null);
});
