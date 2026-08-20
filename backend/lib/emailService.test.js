import test from "node:test";
import assert from "node:assert/strict";
import { sendLoopEmail, FROM_ADDRESS, classifyEmailFailure, nextEmailAttemptDelayMs, MAX_EMAIL_ATTEMPTS } from "./emailService.js";

// Mock supabase covering the three tables sendLoopEmail touches:
//   app_config (flag read, done by the injected `readStage` normally, but we
//               also exercise the real readEmailLoopStage import indirectly
//               via readStage override below in most tests for isolation),
//   email_log  (dedupe select + insert),
//   users      (prefs select).
function makeSupabase({ emailLogExisting = false, userRow = { email_prefs: {} }, insertError = null } = {}) {
  const emailLogInserts = [];
  const calls = [];
  return {
    emailLogInserts,
    calls,
    from(table) {
      calls.push(table);
      if (table === "email_log") {
        return {
          select(cols) {
            assert.equal(cols, "id");
            return {
              eq(col, _dedupeKey) {
                assert.equal(col, "dedupe_key");
                return {
                  maybeSingle: async () => ({
                    data: emailLogExisting ? { id: "existing-row" } : null,
                    error: null,
                  }),
                };
              },
            };
          },
          insert: async (row) => {
            emailLogInserts.push(row);
            return { error: insertError };
          },
        };
      }
      if (table === "users") {
        return {
          select(cols) {
            assert.equal(cols, "email_prefs");
            return { eq: () => ({ maybeSingle: async () => ({ data: userRow, error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const baseArgs = {
  userId: "user-1",
  teamId: "team-1",
  type: "welcome",
  dedupeKey: "welcome:user-1",
  to: "player@example.com",
  subject: "Subject",
  html: "<p>hi</p>",
  text: "hi",
  unsubscribeUrl: "https://cyclingzone.org/api/email/unsubscribe?token=abc",
};

function stageReader(stage) {
  return async () => stage;
}

function neverCalledResendFactory() {
  return () => { throw new Error("resendFactory must not be called in this path"); };
}

test("stage=off skips before touching email_log or users at all", async () => {
  const supabase = makeSupabase();
  const result = await sendLoopEmail({
    supabase,
    ...baseArgs,
    readStage: stageReader("off"),
    resendFactory: neverCalledResendFactory(),
  });
  assert.deepEqual(result, { skipped: "flag_off" });
  assert.deepEqual(supabase.calls, [], "no table touched when flag is off");
});

test("dedupe: an existing email_log row for the dedupe_key skips the send", async () => {
  const supabase = makeSupabase({ emailLogExisting: true });
  const result = await sendLoopEmail({
    supabase,
    ...baseArgs,
    readStage: stageReader("dry_run"),
    resendFactory: neverCalledResendFactory(),
  });
  assert.deepEqual(result, { skipped: "dedupe" });
  assert.equal(supabase.emailLogInserts.length, 0);
});

test("prefs: master 'all'=false skips the send", async () => {
  const supabase = makeSupabase({ userRow: { email_prefs: { all: false } } });
  const result = await sendLoopEmail({
    supabase,
    ...baseArgs,
    readStage: stageReader("dry_run"),
    resendFactory: neverCalledResendFactory(),
  });
  assert.deepEqual(result, { skipped: "prefs" });
});

test("prefs: per-type false skips the send", async () => {
  const supabase = makeSupabase({ userRow: { email_prefs: { welcome: false } } });
  const result = await sendLoopEmail({
    supabase,
    ...baseArgs,
    readStage: stageReader("dry_run"),
    resendFactory: neverCalledResendFactory(),
  });
  assert.deepEqual(result, { skipped: "prefs" });
});

test("prefs: absent key means enabled (default-on) and the send proceeds to dry_run", async () => {
  const supabase = makeSupabase({ userRow: { email_prefs: {} } });
  const result = await sendLoopEmail({
    supabase,
    ...baseArgs,
    readStage: stageReader("dry_run"),
    resendFactory: neverCalledResendFactory(),
  });
  assert.deepEqual(result, { status: "dry_run" });
});

test("stage=dry_run logs a dry_run row and never calls Resend", async () => {
  const supabase = makeSupabase();
  const result = await sendLoopEmail({
    supabase,
    ...baseArgs,
    readStage: stageReader("dry_run"),
    resendFactory: neverCalledResendFactory(),
  });
  assert.deepEqual(result, { status: "dry_run" });
  assert.equal(supabase.emailLogInserts.length, 1);
  assert.deepEqual(supabase.emailLogInserts[0], {
    user_id: "user-1",
    team_id: "team-1",
    email_type: "welcome",
    dedupe_key: "welcome:user-1",
    status: "dry_run",
  });
});

test("stage=on sends via the injected Resend client with idempotencyKey + List-Unsubscribe headers, logs sent", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldSecret = process.env.EMAIL_UNSUB_SECRET;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  try {
    const supabase = makeSupabase();
    const sendCalls = [];
    const resendFactory = () => ({
      emails: {
        send: async (payload, opts) => {
          sendCalls.push({ payload, opts });
          return { data: { id: "provider-id-123" }, error: null };
        },
      },
    });

    const result = await sendLoopEmail({
      supabase,
      ...baseArgs,
      readStage: stageReader("on"),
      resendFactory,
    });

    assert.deepEqual(result, { status: "sent", providerId: "provider-id-123" });
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].payload.from, FROM_ADDRESS);
    assert.deepEqual(sendCalls[0].payload.to, ["player@example.com"]);
    assert.equal(sendCalls[0].payload.headers["List-Unsubscribe"], `<${baseArgs.unsubscribeUrl}>`);
    assert.equal(sendCalls[0].payload.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.equal(sendCalls[0].opts.idempotencyKey, "welcome:user-1");

    assert.equal(supabase.emailLogInserts.length, 1);
    assert.deepEqual(supabase.emailLogInserts[0], {
      user_id: "user-1",
      team_id: "team-1",
      email_type: "welcome",
      dedupe_key: "welcome:user-1",
      status: "sent",
      provider_id: "provider-id-123",
    });
  } finally {
    process.env.RESEND_API_KEY = oldKey;
    process.env.EMAIL_UNSUB_SECRET = oldSecret;
  }
});

test("stage=on: a permanent Resend failure (4xx) logs status failed, captures immediately, and is NOT queued for retry (#3600)", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldSecret = process.env.EMAIL_UNSUB_SECRET;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  try {
    const supabase = makeSupabase();
    const resendFactory = () => ({
      emails: { send: async () => ({ data: null, error: { message: "domain not verified", statusCode: 403, name: "invalid_from_address" } }) },
    });
    const captured = [];

    const result = await sendLoopEmail({
      supabase,
      ...baseArgs,
      readStage: stageReader("on"),
      resendFactory,
      captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
    });

    assert.deepEqual(result, { status: "failed", error: "domain not verified", retryable: false });
    assert.equal(supabase.emailLogInserts.length, 1);
    assert.deepEqual(supabase.emailLogInserts[0], {
      user_id: "user-1",
      team_id: "team-1",
      email_type: "welcome",
      dedupe_key: "welcome:user-1",
      status: "failed",
      error: "domain not verified",
      attempts: 1,
      next_attempt_at: null,
      retry_payload: null,
    });
    assert.equal(captured.length, 1, "Sentry capture called exactly once, immediately, for a permanent failure");
  } finally {
    process.env.RESEND_API_KEY = oldKey;
    process.env.EMAIL_UNSUB_SECRET = oldSecret;
  }
});

test("stage=on: a retryable Resend failure (5xx) logs status failed, queues a retry, and does NOT capture immediately (#3600)", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldSecret = process.env.EMAIL_UNSUB_SECRET;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  try {
    const supabase = makeSupabase();
    const resendFactory = () => ({
      emails: { send: async () => ({ data: null, error: { message: "internal error", statusCode: 500, name: "internal_server_error" } }) },
    });
    const captured = [];
    const now = new Date("2026-08-18T12:00:00Z");

    const result = await sendLoopEmail({
      supabase,
      ...baseArgs,
      readStage: stageReader("on"),
      resendFactory,
      captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
      now,
    });

    assert.deepEqual(result, { status: "failed", error: "internal error", retryable: true });
    assert.equal(supabase.emailLogInserts.length, 1);
    const row = supabase.emailLogInserts[0];
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, 1);
    assert.equal(row.next_attempt_at, new Date(now.getTime() + nextEmailAttemptDelayMs(1)).toISOString());
    assert.deepEqual(row.retry_payload, {
      to: baseArgs.to,
      subject: baseArgs.subject,
      html: baseArgs.html,
      text: baseArgs.text,
      unsubscribeUrl: baseArgs.unsubscribeUrl,
    });
    assert.equal(captured.length, 0, "Sentry capture deferred to the retry-drain's dead-alarm, not fired on the first hiccup");
  } finally {
    process.env.RESEND_API_KEY = oldKey;
    process.env.EMAIL_UNSUB_SECRET = oldSecret;
  }
});

test("classifyEmailFailure — failure matrix mirrors discordWebhookDelivery.js's classifyWebhookFailure (#3600)", () => {
  assert.deepEqual(classifyEmailFailure(429), { kind: "retryable", reason: "rate-limited" });
  assert.deepEqual(classifyEmailFailure(500), { kind: "retryable", reason: "resend-5xx" });
  assert.deepEqual(classifyEmailFailure(503), { kind: "retryable", reason: "resend-5xx" });
  assert.deepEqual(classifyEmailFailure(null), { kind: "retryable", reason: "network" });
  assert.deepEqual(classifyEmailFailure(undefined), { kind: "retryable", reason: "network" });

  assert.deepEqual(classifyEmailFailure(404), { kind: "permanent", reason: "config-error" });
  assert.deepEqual(classifyEmailFailure(400), { kind: "permanent", reason: "config-error" });
  assert.deepEqual(classifyEmailFailure(401), { kind: "permanent", reason: "config-error" });
});

test("nextEmailAttemptDelayMs — increases then plateaus, ~27h horizon across the retryable attempts (#3600)", () => {
  assert.equal(MAX_EMAIL_ATTEMPTS, 8);
  // Delays actually consumed on the road to exhaustion: after attempts 1..7
  // a retry is still scheduled; attempt 8 is where processEmailRetryDrain
  // marks the row dead (attempts >= MAX_EMAIL_ATTEMPTS), so no 8th delay is
  // ever used — same accounting as discordWebhookOutbox.js's ~27h comment.
  const delays = Array.from({ length: MAX_EMAIL_ATTEMPTS - 1 }, (_, i) => nextEmailAttemptDelayMs(i + 1));
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] >= delays[i - 1], "backoff must never shrink");
  assert.equal(delays.at(-1), delays.at(-2), "schedule plateaus at the last step instead of growing forever");
  const totalMs = delays.reduce((a, b) => a + b, 0);
  assert.ok(totalMs > 20 * 60 * 60 * 1000 && totalMs < 30 * 60 * 60 * 1000, "total retry horizon should be roughly ~27h");
});

test("stage=on without RESEND_API_KEY throws before touching Resend", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldSecret = process.env.EMAIL_UNSUB_SECRET;
  delete process.env.RESEND_API_KEY;
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  try {
    const supabase = makeSupabase();
    await assert.rejects(
      () =>
        sendLoopEmail({
          supabase,
          ...baseArgs,
          readStage: stageReader("on"),
          resendFactory: neverCalledResendFactory(),
        }),
      /RESEND_API_KEY/
    );
  } finally {
    process.env.RESEND_API_KEY = oldKey;
    process.env.EMAIL_UNSUB_SECRET = oldSecret;
  }
});

test("stage=on without EMAIL_UNSUB_SECRET throws before touching Resend", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldSecret = process.env.EMAIL_UNSUB_SECRET;
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.EMAIL_UNSUB_SECRET;
  try {
    const supabase = makeSupabase();
    await assert.rejects(
      () =>
        sendLoopEmail({
          supabase,
          ...baseArgs,
          readStage: stageReader("on"),
          resendFactory: neverCalledResendFactory(),
        }),
      /EMAIL_UNSUB_SECRET/
    );
  } finally {
    process.env.RESEND_API_KEY = oldKey;
    process.env.EMAIL_UNSUB_SECRET = oldSecret;
  }
});

test("requires userId, type, dedupeKey and to", async () => {
  const supabase = makeSupabase();
  await assert.rejects(() => sendLoopEmail({ supabase, ...baseArgs, userId: null, readStage: stageReader("dry_run") }));
  await assert.rejects(() => sendLoopEmail({ supabase, ...baseArgs, type: null, readStage: stageReader("dry_run") }));
  await assert.rejects(() => sendLoopEmail({ supabase, ...baseArgs, dedupeKey: null, readStage: stageReader("dry_run") }));
  await assert.rejects(() => sendLoopEmail({ supabase, ...baseArgs, to: null, readStage: stageReader("dry_run") }));
});
