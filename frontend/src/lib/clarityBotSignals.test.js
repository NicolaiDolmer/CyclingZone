import { test } from "node:test";
import assert from "node:assert/strict";
import { isLikelyAutomation, isPrerendering, isSelfReferralEntry } from "./clarityBotSignals.js";

test("isLikelyAutomation is true when navigator.webdriver is true", () => {
  assert.equal(isLikelyAutomation({ webdriver: true }), true);
});

test("isLikelyAutomation is false for a normal browser navigator", () => {
  assert.equal(isLikelyAutomation({ webdriver: false }), false);
  assert.equal(isLikelyAutomation({}), false);
});

test("isLikelyAutomation tolerates a missing navigator", () => {
  assert.equal(isLikelyAutomation(undefined), false);
});

test("isPrerendering is true when document.prerendering is true", () => {
  assert.equal(isPrerendering({ prerendering: true }), true);
});

test("isPrerendering is false for a normal, already-activated document", () => {
  assert.equal(isPrerendering({ prerendering: false }), false);
  assert.equal(isPrerendering({}), false);
});

test("isPrerendering tolerates a missing document", () => {
  assert.equal(isPrerendering(undefined), false);
});

test("isSelfReferralEntry is true when referrer origin matches our own origin (#3819 dominant signal)", () => {
  assert.equal(
    isSelfReferralEntry("https://cyclingzone.org/racehub", "https://cyclingzone.org"),
    true,
  );
});

test("isSelfReferralEntry is false for a real external referrer", () => {
  assert.equal(
    isSelfReferralEntry("https://google.com/search?q=cyclingzone", "https://cyclingzone.org"),
    false,
  );
});

test("isSelfReferralEntry is false for direct traffic (empty referrer)", () => {
  assert.equal(isSelfReferralEntry("", "https://cyclingzone.org"), false);
  assert.equal(isSelfReferralEntry(null, "https://cyclingzone.org"), false);
});

test("isSelfReferralEntry is false for a malformed referrer instead of throwing", () => {
  assert.equal(isSelfReferralEntry("not-a-url", "https://cyclingzone.org"), false);
});

test("isSelfReferralEntry tolerates a missing origin", () => {
  assert.equal(isSelfReferralEntry("https://cyclingzone.org/", undefined), false);
});
