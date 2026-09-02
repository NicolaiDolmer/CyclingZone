import test from "node:test";
import assert from "node:assert/strict";

import {
  processEmailRetryDrain,
  isMissingRetryColumnError,
} from "./emailRetrySweep.js";
import { nextEmailAttemptDelayMs, MAX_EMAIL_ATTEMPTS } from "./emailService.js";

// ── Supabase-mock (chainable, registrerer writes) — spejler discordWebhookOutbox.test.js ──

function makeSupabaseMock({ failedRows = [], selectError = null, updateError = null } = {}) {
  const writes = { updates: [] };
  const supabase = {
    from(table) {
      assert.equal(table, "email_log");
      return {
        select() {
          const builder = {
            eq: () => builder,
            not: () => builder,
            lte: () => builder,
            order: () => builder,
            limit: () =>
              Promise.resolve(selectError ? { data: null, error: selectError } : { data: failedRows, error: null }),
          };
          return builder;
        },
        update(values) {
          return {
            eq: (col, id) => {
              writes.updates.push({ id, values });
              return Promise.resolve({ error: updateError });
            },
          };
        },
      };
    },
  };
  return { supabase, writes };
}

const NOW = new Date("2026-08-18T12:00:00Z");
const PAYLOAD = { to: "player@example.com", subject: "Subject", html: "<p>hi</p>", text: "hi", unsubscribeUrl: "https://cyclingzone.org/unsub?token=x" };

function makeDeps({ sendResults = [] } = {}) {
  const sendCalls = [];
  const captures = [];
  let i = 0;
  const resend = {
    emails: {
      send: async (payload, opts) => {
        sendCalls.push({ payload, opts });
        const result = sendResults[i] ?? sendResults.at(-1) ?? { data: { id: "provider-1" }, error: null };
        i += 1;
        return result;
      },
    },
  };
  return {
    resendFactory: () => resend,
    captureExceptionFn: (err, ctx) => captures.push({ err, ctx }),
    readStage: async () => "on",
    now: NOW,
    _sendCalls: sendCalls,
    _captures: captures,
  };
}

function withResendKey(fn) {
  const old = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_key";
  return fn().finally(() => { process.env.RESEND_API_KEY = old; });
}

// #2853: a readStage double that answers per-type instead of one fixed
// value for every call — lets a test put different types in different
// stages within the same drain run.
function stagesFor(map) {
  return async (_supabase, type) => map[type] ?? "off";
}

// ── gating ─────────────────────────────────────────────────────────────────

test("no-op (does not query) when the email-loop stage is not exactly 'on'", async () => {
  const { supabase } = makeSupabaseMock({ failedRows: [{ id: "should-not-be-queried" }] });
  const result = await processEmailRetryDrain({ supabase, readStage: async () => "dry_run", now: NOW });
  assert.deepEqual(result, { processed: 0, sent: 0, rescheduled: 0, dead: 0 });
});

test("no-op when RESEND_API_KEY is not set, even if stage is 'on'", async () => {
  const old = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const { supabase } = makeSupabaseMock({ failedRows: [{ id: "should-not-be-queried" }] });
    const result = await processEmailRetryDrain({ supabase, readStage: async () => "on", now: NOW });
    assert.deepEqual(result, { processed: 0, sent: 0, rescheduled: 0, dead: 0 });
  } finally {
    process.env.RESEND_API_KEY = old;
  }
});

test("empty queue: no send attempts, no alarm", () =>
  withResendKey(async () => {
    const { supabase } = makeSupabaseMock({ failedRows: [] });
    const deps = makeDeps();
    const result = await processEmailRetryDrain({ supabase, ...deps });
    assert.deepEqual(result, { processed: 0, sent: 0, rescheduled: 0, dead: 0 });
    assert.equal(deps._captures.length, 0);
  }));

// ── per-type gating (#2853) ─────────────────────────────────────────────────

test("a row whose own type has been flipped back off is left untouched, other due rows still drain", () =>
  withResendKey(async () => {
    const { supabase, writes } = makeSupabaseMock({
      failedRows: [
        { id: "row-off", dedupe_key: "day1:user-1", attempts: 1, retry_payload: PAYLOAD, email_type: "day1" },
        { id: "row-on", dedupe_key: "welcome:user-2", attempts: 1, retry_payload: PAYLOAD, email_type: "welcome" },
      ],
    });
    const deps = makeDeps({ sendResults: [{ data: { id: "provider-1" }, error: null }] });
    deps.readStage = stagesFor({ welcome: "on", day1: "off", race_digest: "off" });

    const result = await processEmailRetryDrain({ supabase, ...deps });

    assert.deepEqual(result, { processed: 1, sent: 1, rescheduled: 0, dead: 0 });
    assert.equal(deps._sendCalls.length, 1);
    assert.equal(deps._sendCalls[0].opts.idempotencyKey, "welcome:user-2");
    assert.equal(writes.updates.length, 1, "the off-type row is never written — left queued for the next tick");
  }));

test("every type off/dry_run: the upfront check skips the query entirely, even with due rows in the table", () =>
  withResendKey(async () => {
    const { supabase, writes } = makeSupabaseMock({
      failedRows: [{ id: "row-1", dedupe_key: "day1:user-1", attempts: 1, retry_payload: PAYLOAD, email_type: "day1" }],
    });
    const deps = makeDeps();
    deps.readStage = stagesFor({ welcome: "dry_run", day1: "off", race_digest: "off" });

    const result = await processEmailRetryDrain({ supabase, ...deps });

    assert.deepEqual(result, { processed: 0, sent: 0, rescheduled: 0, dead: 0 });
    assert.equal(writes.updates.length, 0);
  }));

test("a row with no email_type (pre-#2853 data) falls back to the legacy shared flag, same as before", () =>
  withResendKey(async () => {
    const { supabase, writes } = makeSupabaseMock({
      failedRows: [{ id: "row-1", dedupe_key: "welcome:user-1", attempts: 1, retry_payload: PAYLOAD }],
    });
    const deps = makeDeps({ sendResults: [{ data: { id: "provider-1" }, error: null }] });
    // readStage(supabase, row.email_type) is called with `undefined` for a
    // row that predates #2853 — that's the same call shape as the legacy
    // type-agnostic read (readEmailLoopStage(supabase) with no type arg).
    // day1="on" only satisfies the upfront "is anything on at all" check;
    // undefined="on" is what actually lets this specific row through.
    deps.readStage = stagesFor({ day1: "on", undefined: "on" });

    const result = await processEmailRetryDrain({ supabase, ...deps });

    assert.deepEqual(result, { processed: 1, sent: 1, rescheduled: 0, dead: 0 });
    assert.equal(writes.updates.length, 1);
  }));

// ── successful retry ─────────────────────────────────────────────────────

test("successful retry marks the row sent and clears the retry state (the recovered email reaches the player)", () =>
  withResendKey(async () => {
    const { supabase, writes } = makeSupabaseMock({
      failedRows: [{ id: "row-1", dedupe_key: "day1:user-1", attempts: 1, retry_payload: PAYLOAD }],
    });
    const deps = makeDeps({ sendResults: [{ data: { id: "provider-99" }, error: null }] });

    const result = await processEmailRetryDrain({ supabase, ...deps });

    assert.deepEqual(result, { processed: 1, sent: 1, rescheduled: 0, dead: 0 });
    assert.equal(deps._sendCalls.length, 1);
    assert.equal(deps._sendCalls[0].payload.to[0], PAYLOAD.to);
    assert.equal(deps._sendCalls[0].opts.idempotencyKey, "day1:user-1", "retry reuses the SAME idempotencyKey — cannot double-send");
    assert.deepEqual(writes.updates, [
      { id: "row-1", values: { status: "sent", provider_id: "provider-99", error: null, next_attempt_at: null, retry_payload: null } },
    ]);
    assert.equal(deps._captures.length, 0);
  }));

// ── retryable failure still short of max attempts ───────────────────────────

test("continued 5xx reschedules with growing backoff, does NOT mark dead, does NOT alarm yet", () =>
  withResendKey(async () => {
    const { supabase, writes } = makeSupabaseMock({
      failedRows: [{ id: "row-1", dedupe_key: "welcome:user-1", attempts: 2, retry_payload: PAYLOAD }],
    });
    const deps = makeDeps({ sendResults: [{ data: null, error: { message: "internal error", statusCode: 500 } }] });

    const result = await processEmailRetryDrain({ supabase, ...deps });

    assert.deepEqual(result, { processed: 1, sent: 0, rescheduled: 1, dead: 0 });
    assert.equal(writes.updates.length, 1);
    const { values } = writes.updates[0];
    assert.equal(values.attempts, 3);
    assert.equal(values.status, undefined, "must not be marked dead yet — status column untouched");
    assert.equal(values.next_attempt_at, new Date(NOW.getTime() + nextEmailAttemptDelayMs(3)).toISOString());
    assert.equal(deps._captures.length, 0, "must only alarm once the email is REALLY lost");
  }));

// ── permanent failure ───────────────────────────────────────────────────────

test("a permanent failure (bad address / invalid key) gives up immediately, regardless of attempts left", () =>
  withResendKey(async () => {
    const { supabase, writes } = makeSupabaseMock({
      failedRows: [{ id: "row-1", dedupe_key: "welcome:user-1", attempts: 1, retry_payload: PAYLOAD }],
    });
    const deps = makeDeps({ sendResults: [{ data: null, error: { message: "invalid recipient", statusCode: 422 } }] });

    const result = await processEmailRetryDrain({ supabase, ...deps });

    assert.deepEqual(result, { processed: 1, sent: 0, rescheduled: 0, dead: 1 });
    const { values } = writes.updates[0];
    assert.equal(values.attempts, 2);
    assert.equal(values.next_attempt_at, null);
    assert.equal(values.retry_payload, null);
    assert.equal(deps._captures.length, 1, "one aggregated alarm for this drain run");
    assert.match(deps._captures[0].err.message, /1 mail\(s\) opgivet/);
  }));

// ── exhausted attempts ───────────────────────────────────────────────────────

test("exhausted attempts (still retryable) → dead + one aggregated alarm for the whole run", () =>
  withResendKey(async () => {
    const { supabase, writes } = makeSupabaseMock({
      failedRows: [
        { id: "row-1", dedupe_key: "day1:user-1", attempts: MAX_EMAIL_ATTEMPTS - 1, retry_payload: PAYLOAD },
        { id: "row-2", dedupe_key: "day1:user-2", attempts: MAX_EMAIL_ATTEMPTS - 1, retry_payload: PAYLOAD },
      ],
    });
    const deps = makeDeps({ sendResults: [{ data: null, error: { message: "internal error", statusCode: 500 } }] });

    const result = await processEmailRetryDrain({ supabase, ...deps });

    assert.deepEqual(result, { processed: 2, sent: 0, rescheduled: 0, dead: 2 });
    assert.equal(writes.updates.filter((u) => u.values.next_attempt_at === null).length, 2);
    assert.equal(deps._captures.length, 1, "one aggregated alarm, not one per row");
    assert.match(deps._captures[0].err.message, /2 mail\(s\) opgivet/);
  }));

// ── defensive: missing payload ──────────────────────────────────────────────

test("a row missing retry_payload (shouldn't happen) stops retrying it instead of looping forever", () =>
  withResendKey(async () => {
    const { supabase, writes } = makeSupabaseMock({
      failedRows: [{ id: "row-1", dedupe_key: "welcome:user-1", attempts: 1, retry_payload: null }],
    });
    const deps = makeDeps();

    const result = await processEmailRetryDrain({ supabase, ...deps });

    assert.deepEqual(result, { processed: 1, sent: 0, rescheduled: 0, dead: 1 });
    assert.equal(deps._sendCalls.length, 0, "must not call Resend without content to send");
    assert.equal(writes.updates[0].values.next_attempt_at, null);
  }));

// ── missing-column tolerance (merge/migration gap) ──────────────────────────

test("missing retry columns (migration not applied yet) does not alarm, in either direction", () =>
  withResendKey(async () => {
    const missing = { code: "42703", message: 'column "next_attempt_at" does not exist' };
    const { supabase } = makeSupabaseMock({ selectError: missing });
    const deps = makeDeps();

    const result = await processEmailRetryDrain({ supabase, ...deps });

    assert.deepEqual(result, { processed: 0, sent: 0, rescheduled: 0, dead: 0 });
    assert.equal(deps._captures.length, 0);
  }));

test("isMissingRetryColumnError distinguishes a missing column from a real failure", () => {
  assert.equal(isMissingRetryColumnError({ code: "42703", message: "x" }), true);
  assert.equal(isMissingRetryColumnError({ code: "PGRST204", message: "x" }), true);
  assert.equal(isMissingRetryColumnError({ message: 'column "next_attempt_at" does not exist' }), true);
  assert.equal(isMissingRetryColumnError({ code: "42501", message: "permission denied" }), false);
  assert.equal(isMissingRetryColumnError({ message: "connection reset" }), false);
  assert.equal(isMissingRetryColumnError(null), false);
});

// ── select failure (real) ────────────────────────────────────────────────────

test("a real select failure captures and returns a zero-result instead of throwing", () =>
  withResendKey(async () => {
    const { supabase } = makeSupabaseMock({ selectError: { message: "connection reset" } });
    const deps = makeDeps();

    const result = await processEmailRetryDrain({ supabase, ...deps });

    assert.deepEqual(result, { processed: 0, sent: 0, rescheduled: 0, dead: 0 });
    assert.equal(deps._captures.length, 1);
    assert.match(deps._captures[0].err.message, /select fejlede/);
  }));
