import test from "node:test";
import assert from "node:assert/strict";

import { classifyWebhookFailure, attemptWebhookDelivery } from "./discordWebhookDelivery.js";

// ── classifyWebhookFailure ───────────────────────────────────────────────────

test("classifyWebhookFailure — fejl-matrix (#2882)", () => {
  assert.deepEqual(classifyWebhookFailure(429), { kind: "retryable", reason: "rate-limited" });
  assert.deepEqual(classifyWebhookFailure(500), { kind: "retryable", reason: "discord-5xx" });
  assert.deepEqual(classifyWebhookFailure(503), { kind: "retryable", reason: "discord-5xx" });
  assert.deepEqual(classifyWebhookFailure(null), { kind: "retryable", reason: "network" });
  assert.deepEqual(classifyWebhookFailure(undefined), { kind: "retryable", reason: "network" });
  // #2395: 4xx ≠ 429 = permanent config-/routing-fejl (dødt/slettet webhook).
  assert.deepEqual(classifyWebhookFailure(404), { kind: "permanent", reason: "config-error" });
  assert.deepEqual(classifyWebhookFailure(400), { kind: "permanent", reason: "config-error" });
  assert.deepEqual(classifyWebhookFailure(401), { kind: "permanent", reason: "config-error" });
});

// ── attemptWebhookDelivery ───────────────────────────────────────────────────

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
      headers: { get: (name) => (next.headers && next.headers[name]) ?? null },
    };
  };
  return { fetchFn, calls };
}

const noSleep = async () => {};

test("attemptWebhookDelivery — succes på første forsøg", async () => {
  const { fetchFn, calls } = makeFetchSequence([{ status: 204 }]);
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: { embeds: [{ title: "Tour des Fjords" }] },
    fetchFn,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
});

// Kerne-scenariet fra #2882: 429 med Retry-After (body.retry_after) → retry → succes.
test("attemptWebhookDelivery — 429 med retry_after i body → retry → succes", async () => {
  const { fetchFn, calls } = makeFetchSequence([
    { status: 429, body: { retry_after: 0.001, message: "You are being rate limited." } },
    { status: 204 },
  ]);
  const sleeps = [];
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: { embeds: [] },
    fetchFn,
    sleepFn: async (ms) => sleeps.push(ms),
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
  // retry_after fra Discord respekteres (1ms), ikke default-backoff (500ms)
  assert.deepEqual(sleeps, [1]);
});

// Samme scenarie, men retry_after kommer kun via Retry-After-headeren (ingen JSON-body).
test("attemptWebhookDelivery — 429 med Retry-After-header (ingen JSON-body) → retry → succes", async () => {
  const { fetchFn, calls } = makeFetchSequence([
    { status: 429, body: null, headers: { "Retry-After": "0.002" } },
    { status: 204 },
  ]);
  const sleeps = [];
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: { embeds: [] },
    fetchFn,
    sleepFn: async (ms) => sleeps.push(ms),
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [2]);
});

test("attemptWebhookDelivery — 404 (dødt webhook, #2395) er permanent: INGEN retry", async () => {
  const { fetchFn, calls } = makeFetchSequence([{ status: 404, body: { message: "Unknown Webhook" } }]);
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/deleted",
    payload: {},
    fetchFn,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, "permanent");
  assert.equal(result.failure.reason, "config-error");
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 1);
});

// Endelig fiasko: vedvarende 429 overlever ALLE forsøg → skal komme tilbage som
// retryable (ikke permanent), så kalderen (sendWebhook) kan logge det synligt.
test("attemptWebhookDelivery — vedvarende 429 overlever alle forsøg → retryable failure efter maxAttempts", async () => {
  const { fetchFn, calls } = makeFetchSequence([{ status: 429, body: { retry_after: 0 } }]);
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: {},
    fetchFn,
    sleepFn: noSleep,
    maxAttempts: 3,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, "retryable");
  assert.equal(result.failure.reason, "rate-limited");
  assert.equal(result.attempts, 3);
  assert.equal(calls.length, 3);
});

test("attemptWebhookDelivery — netværksfejl retries og fejler retryable efter maxAttempts", async () => {
  const { fetchFn, calls } = makeFetchSequence([new Error("ECONNRESET")]);
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: {},
    fetchFn,
    sleepFn: noSleep,
    maxAttempts: 3,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, "retryable");
  assert.equal(result.failure.reason, "network");
  assert.equal(result.attempts, 3);
  assert.equal(calls.length, 3);
  assert.match(result.error, /ECONNRESET/);
});

test("attemptWebhookDelivery — lang retry_after overstiger inline-loft → deferred i stedet for at blokere", async () => {
  const { fetchFn, calls } = makeFetchSequence([{ status: 429, body: { retry_after: 60 } }]);
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: {},
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

test("attemptWebhookDelivery — 5xx retries derefter succes", async () => {
  const { fetchFn, calls } = makeFetchSequence([
    { status: 502, body: { message: "Bad Gateway" } },
    { status: 204 },
  ]);
  const sleeps = [];
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: {},
    fetchFn,
    sleepFn: async (ms) => sleeps.push(ms),
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
  // Ingen retry_after på 5xx → default stigende backoff (500ms * attempt 1)
  assert.deepEqual(sleeps, [500]);
});
