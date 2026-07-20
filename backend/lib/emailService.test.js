import test from "node:test";
import assert from "node:assert/strict";
import { sendLoopEmail, FROM_ADDRESS } from "./emailService.js";

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

test("stage=on: a Resend {error} response logs status failed and does NOT throw", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldSecret = process.env.EMAIL_UNSUB_SECRET;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  try {
    const supabase = makeSupabase();
    const resendFactory = () => ({
      emails: { send: async () => ({ data: null, error: { message: "domain not verified" } }) },
    });
    const captured = [];

    const result = await sendLoopEmail({
      supabase,
      ...baseArgs,
      readStage: stageReader("on"),
      resendFactory,
      captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
    });

    assert.deepEqual(result, { status: "failed", error: "domain not verified" });
    assert.equal(supabase.emailLogInserts.length, 1);
    assert.equal(supabase.emailLogInserts[0].status, "failed");
    assert.equal(supabase.emailLogInserts[0].error, "domain not verified");
    assert.equal(captured.length, 1, "Sentry capture called exactly once for the failed send");
  } finally {
    process.env.RESEND_API_KEY = oldKey;
    process.env.EMAIL_UNSUB_SECRET = oldSecret;
  }
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
