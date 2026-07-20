import test from "node:test";
import assert from "node:assert/strict";
import { signUnsubToken, verifyUnsubToken } from "./emailUnsubToken.js";

const SECRET = "test-secret-do-not-use-in-prod";

test("signUnsubToken + verifyUnsubToken round-trip for a valid token", () => {
  const token = signUnsubToken("user-123", SECRET);
  assert.equal(verifyUnsubToken(token, SECRET), "user-123");
});

test("signUnsubToken requires userId and secret", () => {
  assert.throws(() => signUnsubToken(null, SECRET));
  assert.throws(() => signUnsubToken("user-123", null));
});

test("verifyUnsubToken rejects a tampered userId (mac no longer matches)", () => {
  const token = signUnsubToken("user-123", SECRET);
  const [, mac] = token.split(".");
  const tampered = `user-456.${mac}`;
  assert.equal(verifyUnsubToken(tampered, SECRET), null);
});

test("verifyUnsubToken rejects a tampered mac", () => {
  const token = signUnsubToken("user-123", SECRET);
  const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
  assert.equal(verifyUnsubToken(tampered, SECRET), null);
});

test("verifyUnsubToken rejects a token signed with a different secret", () => {
  const token = signUnsubToken("user-123", SECRET);
  assert.equal(verifyUnsubToken(token, "a-completely-different-secret"), null);
});

test("verifyUnsubToken rejects malformed tokens", () => {
  assert.equal(verifyUnsubToken("", SECRET), null);
  assert.equal(verifyUnsubToken(null, SECRET), null);
  assert.equal(verifyUnsubToken("no-dot-here", SECRET), null);
  assert.equal(verifyUnsubToken("user-123.", SECRET), null);
  assert.equal(verifyUnsubToken(".maconly", SECRET), null);
  assert.equal(verifyUnsubToken(123, SECRET), null);
});

test("verifyUnsubToken rejects when secret is missing", () => {
  const token = signUnsubToken("user-123", SECRET);
  assert.equal(verifyUnsubToken(token, ""), null);
  assert.equal(verifyUnsubToken(token, null), null);
});

test("verifyUnsubToken tolerates a userId that itself contains a dot", () => {
  // Defensive: userId is a UUID in practice (no dots), but lastIndexOf('.')
  // means signing/verifying is still correct even if that ever changes.
  const token = signUnsubToken("weird.user.id", SECRET);
  assert.equal(verifyUnsubToken(token, SECRET), "weird.user.id");
});
