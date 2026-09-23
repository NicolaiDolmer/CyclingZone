import test from "node:test";
import assert from "node:assert/strict";

import { createServer } from "node:http";

import { classifyWebhookFailure, attemptWebhookDelivery, WEBHOOK_REQUEST_TIMEOUT_MS } from "./discordWebhookDelivery.js";

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

// ── #3624 · timeout pr. POST ────────────────────────────────────────────────

// fetch der aldrig svarer, men respekterer signalet — som undici's fetch.
function makeHangingFetch() {
  const calls = [];
  const fetchFn = (url, opts) => {
    calls.push({ url, opts });
    return new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => reject(opts.signal.reason), { once: true });
    });
  };
  return { fetchFn, calls };
}

test("attemptWebhookDelivery (#3624) — hvert POST baerer et timeout-signal (standard 10 s)", async () => {
  assert.equal(WEBHOOK_REQUEST_TIMEOUT_MS, 10_000);
  const { fetchFn, calls } = makeFetchSequence([{ status: 204 }]);
  await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: {},
    fetchFn,
    sleepFn: noSleep,
  });
  assert.ok(calls[0].opts.signal instanceof AbortSignal, "signal sendes med til fetch");
  assert.equal(calls[0].opts.signal.aborted, false);
});

test("attemptWebhookDelivery (#3624) — haengende Discord-kald afbrydes: retryable timeout, ingen inline-retry", async () => {
  const { fetchFn, calls } = makeHangingFetch();
  const sleeps = [];
  const started = Date.now();
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: {},
    fetchFn,
    sleepFn: async (ms) => sleeps.push(ms),
    timeoutMs: 30,
  });
  assert.ok(Date.now() - started < 2000, "leveringen slipper koeen kort efter loftet");
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.deepEqual(result.failure, { kind: "retryable", reason: "timeout", deferred: true });
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 1, "intet straks-retry mod et endpoint der ikke svarer");
  assert.deepEqual(sleeps, []);
  assert.match(result.error, /timeout/);
});

test("attemptWebhookDelivery (#3624) — timeout efter et 5xx stopper retry-loopet", async () => {
  let n = 0;
  const hanging = makeHangingFetch();
  const fetchFn = (url, opts) => {
    n++;
    if (n === 1) {
      return Promise.resolve({ ok: false, status: 503, text: async () => "", headers: { get: () => null } });
    }
    return hanging.fetchFn(url, opts);
  };
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: {},
    fetchFn,
    sleepFn: noSleep,
    timeoutMs: 30,
  });
  assert.equal(result.failure.reason, "timeout");
  assert.equal(result.attempts, 2);
  assert.equal(n, 2);
});

test("attemptWebhookDelivery (#3624) — haengende svar-body efter fejl-status: timeout, eet POST", async () => {
  let posts = 0;
  const fetchFn = (_url, opts) => {
    posts++;
    return Promise.resolve({
      ok: false,
      status: 502,
      headers: { get: () => null },
      text: () => new Promise((_, reject) => {
        opts.signal.addEventListener("abort", () => reject(opts.signal.reason), { once: true });
      }),
    });
  };
  const started = Date.now();
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: {},
    fetchFn,
    sleepFn: noSleep,
    maxAttempts: 4,
    timeoutMs: 30,
  });
  assert.ok(Date.now() - started < 2000);
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.deepEqual(result.failure, { kind: "retryable", reason: "timeout", deferred: true });
  assert.equal(result.attempts, 1);
  assert.equal(posts, 1, "ingen inline-retry selvom der var forsoeg tilbage");
});

test("attemptWebhookDelivery (#3624) — en body der fejler UDEN timeout er stadig en almindelig 5xx-retry", async () => {
  let posts = 0;
  const fetchFn = () => {
    posts++;
    if (posts === 2) return Promise.resolve({ ok: true, status: 204 });
    return Promise.resolve({
      ok: false,
      status: 502,
      headers: { get: () => null },
      text: () => Promise.reject(new Error("socket hang up")),
    });
  };
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/abc",
    payload: {},
    fetchFn,
    sleepFn: noSleep,
    timeoutMs: 1000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test("attemptWebhookDelivery (#3624) — permanent 4xx forbliver permanent, ogsaa med haengende body", async () => {
  const fetchFn = (_url, opts) => Promise.resolve({
    ok: false,
    status: 404,
    headers: { get: () => null },
    text: () => new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => reject(opts.signal.reason), { once: true });
    }),
  });
  const result = await attemptWebhookDelivery({
    webhookUrl: "https://discord.com/api/webhooks/1/deleted",
    payload: {},
    fetchFn,
    sleepFn: noSleep,
    timeoutMs: 30,
  });
  assert.equal(result.failure.kind, "permanent");
  assert.equal(result.attempts, 1);
});

test("attemptWebhookDelivery (#3624) — rigtig fetch mod en server der aldrig svarer", async () => {
  const server = createServer(() => { /* svarer bevidst aldrig */ });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const result = await attemptWebhookDelivery({
      webhookUrl: `http://127.0.0.1:${port}/api/webhooks/1/abc`,
      payload: { content: "x" },
      sleepFn: noSleep,
      timeoutMs: 100,
    });
    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, "timeout");
    assert.equal(result.attempts, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
