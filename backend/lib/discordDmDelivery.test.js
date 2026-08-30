import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyDmFailure,
  parseRetryAfterMs,
  parseDiscordErrorCode,
  attemptDmDelivery,
  isPermanentRecipientFailure,
  PERMANENT_RECIPIENT_FAILURE_REASONS,
  DISCORD_CODE_INVALID_RECIPIENT,
  DISCORD_CODE_INVALID_FORM_BODY,
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

// ── isPermanentRecipientFailure (#3483) ──────────────────────────────────────

test("isPermanentRecipientFailure — 403 og 400/404 er modtager-fejl, 401 er ikke", () => {
  // Begge permanente modtager-grene tæller på dead-connection-tælleren (#3130).
  assert.equal(isPermanentRecipientFailure(classifyDmFailure(403).reason), true);
  assert.equal(isPermanentRecipientFailure(classifyDmFailure(400).reason), true);
  assert.equal(isPermanentRecipientFailure(classifyDmFailure(404).reason), true);
  // 401 er VORES bot-token, ikke modtageren — må aldrig afkoble spillere i flok.
  assert.equal(isPermanentRecipientFailure(classifyDmFailure(401).reason), false);
  // Retryable-reasons og ukendt/manglende input tæller heller ikke.
  assert.equal(isPermanentRecipientFailure(classifyDmFailure(429).reason), false);
  assert.equal(isPermanentRecipientFailure(classifyDmFailure(500).reason), false);
  assert.equal(isPermanentRecipientFailure(undefined), false);
  assert.equal(isPermanentRecipientFailure(null), false);
});

test("PERMANENT_RECIPIENT_FAILURE_REASONS er frosset og indeholder ikke token-invalid", () => {
  assert.deepEqual([...PERMANENT_RECIPIENT_FAILURE_REASONS], ["recipient-blocked", "bad-request"]);
  assert.equal(Object.isFrozen(PERMANENT_RECIPIENT_FAILURE_REASONS), true);
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

// ── Trin-bevidst 400/404 (#3483, review af PR #4460) ─────────────────────────
// Reviewets HIGH-fund: klassifikationen så kun på HTTP-status, så et 400 fra
// postDm (VORES payload, kode 50035) blev til 'bad-request' — nøjagtig samme
// reason som et 400 fra openDm (den døde modtager). En payload-fejl er ikke
// bruger-specifik: den rammer hver eneste tilknyttet spiller i samme
// notifikations-runde, så tre af dem ville have nulstillet discord_id for alle.

test("classifyDmFailure — 400/404 er kun en modtager-fejl når det kommer fra openDm", () => {
  assert.deepEqual(classifyDmFailure(400, { step: "openDm" }), {
    kind: "permanent",
    reason: "bad-request",
  });
  assert.deepEqual(classifyDmFailure(404, { step: "openDm" }), {
    kind: "permanent",
    reason: "bad-request",
  });
  // postDm sender vores embed → aldrig modtagerens skyld.
  assert.deepEqual(classifyDmFailure(400, { step: "postDm" }), {
    kind: "permanent",
    reason: "payload-rejected",
  });
  assert.deepEqual(classifyDmFailure(404, { step: "postDm" }), {
    kind: "permanent",
    reason: "payload-rejected",
  });
  // Default-step er openDm, så eksisterende kaldere bevarer adfærden.
  assert.equal(classifyDmFailure(400).reason, "bad-request");
  // Trin-uafhængige grene er uændrede.
  assert.equal(classifyDmFailure(401, { step: "postDm" }).reason, "token-invalid");
  assert.equal(classifyDmFailure(403, { step: "postDm" }).reason, "recipient-blocked");
  assert.equal(classifyDmFailure(429, { step: "postDm" }).reason, "rate-limited");
});

test("classifyDmFailure — kode 50035 på openDm er stadig vores payload, ikke modtageren", () => {
  assert.equal(
    classifyDmFailure(400, { step: "openDm", discordCode: DISCORD_CODE_INVALID_FORM_BODY }).reason,
    "payload-rejected"
  );
  // 50033 "Invalid Recipient(s)" er derimod præcis den døde kobling #3483 fandt.
  assert.equal(
    classifyDmFailure(400, { step: "openDm", discordCode: DISCORD_CODE_INVALID_RECIPIENT }).reason,
    "bad-request"
  );
});

test("payload-rejected tæller ALDRIG på dead-connection-tælleren (#3483)", () => {
  assert.equal(isPermanentRecipientFailure("payload-rejected"), false);
  assert.equal(
    isPermanentRecipientFailure(classifyDmFailure(400, { step: "postDm" }).reason),
    false
  );
  assert.ok(!PERMANENT_RECIPIENT_FAILURE_REASONS.includes("payload-rejected"));
});

test("parseDiscordErrorCode — læser code, tåler ikke-JSON og manglende felt", () => {
  assert.equal(parseDiscordErrorCode(JSON.stringify({ code: 50035, message: "x" })), 50035);
  assert.equal(parseDiscordErrorCode(JSON.stringify({ message: "x" })), null);
  assert.equal(parseDiscordErrorCode("<html>502</html>"), null);
  assert.equal(parseDiscordErrorCode(""), null);
});

test("attemptDmDelivery — 400 på postDm afkobler ikke modtageren", async () => {
  const { fetchFn, calls } = makeFetchSequence([
    { status: 200, body: { id: "chan-1" } },
    { status: 400, body: { code: 50035, message: "Invalid Form Body" } },
  ]);
  const result = await attemptDmDelivery({
    discordId: "u1",
    payload: { embeds: [{ title: "x".repeat(9000) }] },
    botToken: "t",
    fetchFn,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, "permanent");
  assert.equal(result.failure.reason, "payload-rejected");
  assert.equal(result.failure.step, "postDm");
  assert.equal(isPermanentRecipientFailure(result.failure.reason), false);
  // Permanent → ingen retry-storm på en payload Discord aldrig accepterer.
  assert.equal(calls.length, 2);
});

test("attemptDmDelivery — 400 på openDm er stadig en død kobling (#3483)", async () => {
  const { fetchFn } = makeFetchSequence([
    { status: 400, body: { code: 50033, message: "Invalid Recipient(s)" } },
  ]);
  const result = await attemptDmDelivery({
    discordId: "afmeldt",
    payload: {},
    botToken: "t",
    fetchFn,
    sleepFn: noSleep,
  });
  assert.equal(result.failure.reason, "bad-request");
  assert.equal(result.failure.step, "openDm");
  assert.equal(isPermanentRecipientFailure(result.failure.reason), true);
});
