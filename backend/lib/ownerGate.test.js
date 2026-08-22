// #3750 — ejer-gaten er fail-closed og læser en kommasepareret allowlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwnerUser, parseOwnerIds } from "./ownerGate.js";

test("parseOwnerIds: kommasepareret, trimmet, tomme led fjernes", () => {
  assert.deepEqual(parseOwnerIds(" a , b,,c "), ["a", "b", "c"]);
  assert.deepEqual(parseOwnerIds(undefined), []);
  assert.deepEqual(parseOwnerIds(""), []);
});

test("isOwnerUser: FAIL-CLOSED uden env — ingen er ejer", () => {
  assert.equal(isOwnerUser("abc", undefined), false);
  assert.equal(isOwnerUser("abc", ""), false);
});

test("isOwnerUser: kun id'er på listen er ejer; manglende userId er aldrig ejer", () => {
  assert.equal(isOwnerUser("abc", "abc"), true);
  assert.equal(isOwnerUser("abc", "x, abc ,y"), true);
  assert.equal(isOwnerUser("abd", "abc"), false);
  assert.equal(isOwnerUser(null, "abc"), false);
  assert.equal(isOwnerUser(undefined, "abc"), false);
});
