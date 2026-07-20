import test from "node:test";
import assert from "node:assert/strict";
import { EMAIL_PREF_TYPES, isEmailTypeEnabled, sanitizeEmailPrefs } from "./emailPrefs.js";

test("EMAIL_PREF_TYPES lists the three loop email types", () => {
  assert.deepEqual(EMAIL_PREF_TYPES, ["welcome", "day1", "race_digest"]);
});

test("isEmailTypeEnabled defaults to on when prefs are absent", () => {
  assert.equal(isEmailTypeEnabled({}, "welcome"), true);
  assert.equal(isEmailTypeEnabled(null, "welcome"), true);
  assert.equal(isEmailTypeEnabled(undefined, "day1"), true);
});

test("isEmailTypeEnabled is false when the type key is explicitly false", () => {
  assert.equal(isEmailTypeEnabled({ welcome: false }, "welcome"), false);
  assert.equal(isEmailTypeEnabled({ welcome: true }, "welcome"), true);
});

test("isEmailTypeEnabled honors the master 'all' key over per-type keys", () => {
  assert.equal(isEmailTypeEnabled({ all: false }, "welcome"), false);
  assert.equal(isEmailTypeEnabled({ all: false, welcome: true }, "welcome"), false, "all=false wins even if the type is explicitly true");
  assert.equal(isEmailTypeEnabled({ all: true, day1: false }, "day1"), false, "per-type false still suppresses when all!==false");
});

test("isEmailTypeEnabled fails open for unknown types", () => {
  assert.equal(isEmailTypeEnabled({}, "some_future_type"), true);
  assert.equal(isEmailTypeEnabled({ some_future_type: false }, "some_future_type"), true);
});

test("sanitizeEmailPrefs keeps known boolean keys (including 'all') and reports unknown keys", () => {
  const { prefs, unknownKeys } = sanitizeEmailPrefs({
    all: false,
    welcome: true,
    bogus_key: false,
  });
  assert.deepEqual(prefs, { all: false, welcome: true });
  assert.deepEqual(unknownKeys, ["bogus_key"]);
});

test("sanitizeEmailPrefs drops non-boolean values", () => {
  const { prefs, unknownKeys } = sanitizeEmailPrefs({
    welcome: "false",
    day1: 0,
    race_digest: true,
  });
  assert.deepEqual(prefs, { race_digest: true });
  assert.deepEqual(unknownKeys, []);
});

test("sanitizeEmailPrefs tolerates non-object input", () => {
  assert.deepEqual(sanitizeEmailPrefs(null), { prefs: {}, unknownKeys: [] });
  assert.deepEqual(sanitizeEmailPrefs("nope"), { prefs: {}, unknownKeys: [] });
});
