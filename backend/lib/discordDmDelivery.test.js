import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyDmFailure,
  parseRetryAfterMs,
  attemptDmDelivery,
} from "./discordDmDelivery.js";

// ── classifyDmFailure ────────────────────────────────────────────────────────

test("classifyDmFailure — fejl-matrix (#1115)", () => {
  assert.deepEqual(classifyDmFailure(401), { kind: "permanent", reason: "token-invalid" });
  assert.deepEqual(classifyDmFailure(403), { kind: "permanent", reason: "recipient-blocked" });
  assert.deepEqual(classifyDmFailure(400), { kind: "permanent", reason: "bad-request" });
  assert.deepEqual(classifyDmFailure(404), { kind: "permanent", reason: "bad-request" });
  assert.deepEqual(classifyDmFailure(429), { kind: "retryable", reason: "rate-limited" });
  assert.deepEqual(classifyDmFailure(500), { kind: "retryable", reason: "discord-5xx" });
  assert.deepEqual(classifyDmFailure(503), { kind: "retryable", reason: "discord-5xx" });
  assert.deepEqual(classifyDmFailure(null), { kind: "retryable", reason: "network" });
  assert.deepEqual(classifyDmFailure(undefined), { kind: "retryable", reason: "network" });
  // Ukendte koder → retryable (hellere prøve igen end droppe)
  assert.equal(classifyDmFailure(418).kind, "retryable");
});

// ── parseRetryAfterMs ────────────────────────────────────────────────────────

test("parseRetryAfterMs — body.retry_after (sekunder, decimal) vinder", () => {
  const ms = parseRetryAfterMs(null, JSON.stringify({ retry_after: 1.5 }));
  assert.equal(ms, 1500);
});

test("parseRetryAfterMs — Retry-After-header som fallback", () => {
  const res = { headers: { get: (name) => (name === "Retry-After" ? "3" : null) } };
  assert.equal(parseRetryAfterMs(res, "not json"), 3000);
});

test("parseRetryAfterMs — ingen info → null", () => {
  const res = { headers: { get: () => null } };
  assert.equal(parseRetryAfterMs(res, ""), null);
});

// ── attemptDmDelivery ────────────────────────────────────────────────────────

function makeFetchSequence(responses) {
  const calls = [];
  let i = 0;
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body ?? {},
      text: async () => JSON.stringify(next.body ?? {}),
      headers: { get: () => null },
    };
  };
  return { fetchFn, calls };
}

const noSleep = async () => {};

test("attemptDmDelivery — succes på første forsøg (open + post)", async () => {
  const { fetchFn, calls } = makeFetchSequence([
    { status: 200, body: { id: "chan-1" } },
    { status: 200, body: {} },
  ]);
  const result = await attemptDmDelivery({
    discordId: "u1",
    payload: { content: "hej" },
    botToken: "t",
    fetchFn,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /users\/@me\/channels$/);
  assert.match(calls[1].url, /channels\/chan-1\/messages$/);
  // Token sendes som Bot-header, aldrig i URL
  assert.equal(calls[0].opts.headers.Authorization, "Bot t");
});

test("attemptDmDelivery — 429 på openDm → retry → succes (rod-årsag 9/6)", async () => {
  const { fetchFn, calls } = makeFetchSequence([
    { status: 429, body: { retry_after: 0.001 } },
    { status: 200, body: { id: "chan-1" } },
    { status: 200, body: {} },
  ]);
  const sleeps = [];
  const result = await attemptDmDelivery({
    discordId: "u1",
    payload: {},
    botToken: "t",
    fetchFn,
    sleepFn: async (ms) => sleeps.push(ms),
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 3);
  // retry_after fra Discord respekteres (1 ms, ikke default-backoff 500 ms)
  assert.deepEqual(sleeps, [1]);
});

test("attemptDmDelivery — 401 er permanent: INGEN retry", async () => {
  const { fetchFn, calls } = makeFetchSequence([{ status: 401, body: { message: "Unauthorized" } }]);
  const result = await attemptDmDelivery({
    discordId: "u1",
    payload: {},
    botToken: "stale",
    fetchFn,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, "permanent");
  assert.equal(result.failure.reason, "token-invalid");
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 1);
});

test("attemptDmDelivery — 403 (modtager har lukket DMs) er permanent", async () => {
  const { fetchFn } = makeFetchSequence([{ status: 403, body: {} }]);
  const result = await attemptDmDelivery({
    discordId: "u1",
    payload: {},
    botToken: "t",
    fetchFn,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.reason, "recipient-blocked");
});

test("attemptDmDelivery — netværksfejl retries og fejler retryable efter maxAttempts", async () => {
  const { fetchFn, calls } = makeFetchSequence([new Error("ECONNRESET")]);
  const result = await attemptDmDelivery({
    discordId: "u1",
    payload: {},
    botToken: "t",
    fetchFn,
    sleepFn: noSleep,
    maxAttempts: 3,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, "retryable");
  assert.equal(result.attempts, 3);
  assert.equal(calls.length, 3);
  assert.match(result.error, /ECONNRESET/);
});

test("attemptDmDelivery — langt retry_after overstiger inline-loft → defer til outbox", async () => {
  // Discord beder om 60s pause — det skal IKKE blokere en fire-and-forget-promise.
  const { fetchFn, calls } = makeFetchSequence([{ status: 429, body: { retry_after: 60 } }]);
  const result = await attemptDmDelivery({
    discordId: "u1",
    payload: {},
    botToken: "t",
    fetchFn,
    sleepFn: noSleep,
    maxInlineWaitMs: 5000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, "retryable");
  assert.equal(result.failure.deferred, true);
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 1);
});

test("attemptDmDelivery — fejl på postDm-steppet rapporteres med step-navn", async () => {
  const { fetchFn } = makeFetchSequence([
    { status: 200, body: { id: "chan-1" } },
    { status: 500, body: { message: "boom" } },
    { status: 200, body: { id: "chan-1" } },
    { status: 500, body: { message: "boom" } },
  ]);
  const result = await attemptDmDelivery({
    discordId: "u1",
    payload: {},
    botToken: "t",
    fetchFn,
    sleepFn: noSleep,
    maxAttempts: 2,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /^postDm 500/);
  assert.equal(result.failure.reason, "discord-5xx");
});
