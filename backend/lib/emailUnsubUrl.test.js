import test from "node:test";
import assert from "node:assert/strict";
import {
  unsubscribeUrlFor,
  unsubscribeUrlForStage,
  assertUnsubSecretForStage,
  DRY_RUN_UNSUB_TOKEN,
  EMAIL_UNSUB_BASE_DEFAULT,
} from "./emailUnsubUrl.js";
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

// ─── #2853: stage-bevidst URL + én-fejl-pr.-koersel ──────────────────────────

test("dry_run uden hemmelighed giver en dummy-token i stedet for at kaste", () => {
  const url = unsubscribeUrlForStage({ userId: "user-1", secret: undefined, stage: "dry_run" });
  assert.equal(url, `${EMAIL_UNSUB_BASE_DEFAULT}?token=${DRY_RUN_UNSUB_TOKEN}`);
});

test("dry_run-tokenet kan ALDRIG verificeres (den afmelder ingen ved et uheld)", () => {
  assert.equal(verifyUnsubToken(DRY_RUN_UNSUB_TOKEN, "hvilken-som-helst-hemmelighed"), null);
});

test("dry_run MED hemmelighed signerer helt normalt", () => {
  const url = unsubscribeUrlForStage({ userId: "user-1", secret: "s3cret", stage: "dry_run" });
  assert.equal(url, unsubscribeUrlFor("user-1", "s3cret"));
});

test("stage=on uden hemmelighed kaster stadig - en rigtig mail maa aldrig faa en falsk unsub-URL", () => {
  assert.throws(() => unsubscribeUrlForStage({ userId: "user-1", secret: undefined, stage: "on" }), /secret required/);
});

test("assertUnsubSecretForStage kaster kun ved stage=on", () => {
  assert.throws(() => assertUnsubSecretForStage("on", undefined), /EMAIL_UNSUB_SECRET/);
  assert.doesNotThrow(() => assertUnsubSecretForStage("dry_run", undefined));
  assert.doesNotThrow(() => assertUnsubSecretForStage("off", undefined));
  assert.doesNotThrow(() => assertUnsubSecretForStage("on", "s3cret"));
});
