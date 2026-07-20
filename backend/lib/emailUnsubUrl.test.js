import test from "node:test";
import assert from "node:assert/strict";
import { unsubscribeUrlFor, EMAIL_UNSUB_BASE_DEFAULT } from "./emailUnsubUrl.js";
import { verifyUnsubToken } from "./emailUnsubToken.js";

const SECRET = "test-secret-do-not-use-in-prod";

test("EMAIL_UNSUB_BASE_DEFAULT is the production cyclingzone.org path", () => {
  assert.equal(EMAIL_UNSUB_BASE_DEFAULT, "https://cyclingzone.org/api/email/unsubscribe");
});

test("unsubscribeUrlFor defaults to EMAIL_UNSUB_BASE_DEFAULT when no env override is set", () => {
  delete process.env.EMAIL_UNSUB_BASE_URL;
  const url = unsubscribeUrlFor("user-123", SECRET);
  assert.ok(url.startsWith(`${EMAIL_UNSUB_BASE_DEFAULT}?token=`));
  const token = new URL(url).searchParams.get("token");
  assert.equal(verifyUnsubToken(token, SECRET), "user-123");
});

test("unsubscribeUrlFor honours EMAIL_UNSUB_BASE_URL env override", () => {
  process.env.EMAIL_UNSUB_BASE_URL = "https://staging.example.com/api/email/unsubscribe";
  try {
    const url = unsubscribeUrlFor("user-123", SECRET);
    assert.ok(url.startsWith("https://staging.example.com/api/email/unsubscribe?token="));
  } finally {
    delete process.env.EMAIL_UNSUB_BASE_URL;
  }
});

test("unsubscribeUrlFor honours an explicit base argument over the env var", () => {
  process.env.EMAIL_UNSUB_BASE_URL = "https://should-not-be-used.example.com";
  try {
    const url = unsubscribeUrlFor("user-123", SECRET, "https://explicit.example.com/unsub");
    assert.ok(url.startsWith("https://explicit.example.com/unsub?token="));
  } finally {
    delete process.env.EMAIL_UNSUB_BASE_URL;
  }
});
