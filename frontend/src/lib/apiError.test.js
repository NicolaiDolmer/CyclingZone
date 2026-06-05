import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApiError } from "./apiError.js";

// Fake t() that resolves the auction error namespace and interpolates params.
function fakeT(key, params = {}) {
  const table = {
    "errors:api.cannot_bid_own_rider": "You can't bid on your own rider",
    "errors:api.bid_below_minimum": "Bid must be at least {min} CZ$",
    "errors:api.insufficient_balance_after_bids": "You have {available} CZ$ left after your existing bids",
  };
  const tmpl = table[key];
  if (tmpl == null) return key; // i18next returns the key unchanged when missing
  return tmpl.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}

test("resolves a coded error via the errors namespace", () => {
  const out = resolveApiError({ errorCode: "cannot_bid_own_rider", error: "Du kan ikke byde på din egen rytter" }, fakeT, "fallback");
  assert.equal(out, "You can't bid on your own rider");
});

test("formats numeric params with locale separators", () => {
  const out = resolveApiError({ errorCode: "bid_below_minimum", errorParams: { min: 1500000 } }, fakeT, "fallback");
  // formatBackendParams runs min through formatNumber (default locale 'en' under node)
  assert.equal(out, "Bid must be at least 1,500,000 CZ$");
});

test("falls back to legacy DA error when the code is unknown", () => {
  const out = resolveApiError({ errorCode: "totally_unknown_code", error: "Du kan ikke byde på din egen rytter" }, fakeT, "fallback");
  assert.equal(out, "Du kan ikke byde på din egen rytter");
});

test("uses legacy error string when no errorCode is present", () => {
  const out = resolveApiError({ error: "Auction has ended" }, fakeT, "fallback");
  assert.equal(out, "Auction has ended");
});

test("uses caller fallback when nothing else is available", () => {
  assert.equal(resolveApiError({}, fakeT, "Bidding failed"), "Bidding failed");
  assert.equal(resolveApiError(null, fakeT, "Bidding failed"), "Bidding failed");
});

test("returns empty string when there is nothing to show", () => {
  assert.equal(resolveApiError(undefined, fakeT), "");
});
