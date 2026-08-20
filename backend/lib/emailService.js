// Single choke-point for sending a retention-loop email (#2725). Every cron
// sweep (welcome/day1/race_digest) calls sendLoopEmail instead of touching
// Resend directly, so flag/dedupe/prefs gating and email_log bookkeeping
// live in exactly one place.
//
// Gate order (each one short-circuits the rest):
//   1. flag off             -> {skipped:"flag_off"}, no email_log row at all.
//   2. dedupe_key already logged -> {skipped:"dedupe"} (idempotent retries).
//   3. email_prefs opt-out (type or master "all") -> {skipped:"prefs"}.
//   4. flag dry_run         -> logs status "dry_run", never calls Resend.
//   5. flag on              -> sends via Resend, idempotencyKey = dedupe_key.
//
// Resend send failures are handled INSIDE this function (log "failed" +
// Sentry for permanent failures) and never thrown — a bad send for one user
// must never abort the rest of a sweep. Precondition errors (missing params,
// DB read failures, missing secrets while stage=on) DO throw; callers
// isolate those per-user with their own try/catch, matching the house sweep
// pattern (see academyHealSweep.js / checkDebtWarnings in cron.js).
//
// #3600: a Resend failure classified "retryable" (5xx/network/rate-limit) is
// NOT dropped after the single attempt above — it's scheduled for retry via
// email_log.next_attempt_at/retry_payload, drained by emailRetrySweep.js on
// a 5-min cadence (mirrors backend/lib/discordWebhookOutbox.js's #3545
// pattern 1:1). "permanent" failures (bad address, invalid API key,
// validation error) are never retried — same distinction as
// discordWebhookDelivery.js's classifyWebhookFailure. Sentry fires
// immediately for permanent failures (same as before #3600); for retryable
// failures it's deferred to the point the retry sweep actually gives up
// (exhausted attempts), so a few seconds of Resend flakiness no longer looks
// like a lost email.

import { Resend } from "resend";
import { readEmailLoopStage } from "./emailLoopFlag.js";
import { isEmailTypeEnabled } from "./emailPrefs.js";
import { captureException } from "./sentry.js";

export const FROM_ADDRESS = "Cycling Zone <updates@cyclingzone.org>";

let resendSingleton = null;

// Lazy + memoized so importing this module never requires RESEND_API_KEY to
// be set (tests, dry_run/off-only environments). Constructed fresh only once
// per process; tests inject their own fake client via `resendFactory` instead
// of touching this singleton.
export function getResendClient() {
  if (resendSingleton) return resendSingleton;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("sendLoopEmail: RESEND_API_KEY not set");
  resendSingleton = new Resend(apiKey);
  return resendSingleton;
}

// Backoff schedule per attempt-number (1-indexed), last value repeats.
// Total horizon ≈ 27h — identical schedule to discord_webhook_outbox's
// RETRY_SCHEDULE_MS (#3545), reused deliberately so operators only have to
// remember one retry cadence across the codebase.
const RETRY_SCHEDULE_MS = [
  5 * 60 * 1000, // +5 min
  15 * 60 * 1000, // +15 min
  60 * 60 * 1000, // +1 h
  3 * 60 * 60 * 1000, // +3 h
  6 * 60 * 60 * 1000, // +6 h
  8 * 60 * 60 * 1000, // +8 h
  8 * 60 * 60 * 1000, // +8 h
];

export const MAX_EMAIL_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;

export function nextEmailAttemptDelayMs(attempts) {
  const index = Math.min(Math.max(attempts - 1, 0), RETRY_SCHEDULE_MS.length - 1);
  return RETRY_SCHEDULE_MS[index];
}

/**
 * Classify a Resend send failure by its HTTP status code (error.statusCode —
 * null for a network-level failure). Mirrors
 * discordWebhookDelivery.js's classifyWebhookFailure 1:1: 429/5xx/network are
 * transient and worth retrying, 4xx (config/content: bad address, invalid
 * API key, validation) is a persistent problem a retry cannot fix.
 */
export function classifyEmailFailure(statusCode) {
  if (statusCode === 429) return { kind: "retryable", reason: "rate-limited" };
  if (statusCode == null) return { kind: "retryable", reason: "network" };
  if (statusCode >= 500) return { kind: "retryable", reason: "resend-5xx" };
  if (statusCode >= 400) return { kind: "permanent", reason: "config-error" };
  return { kind: "retryable", reason: `http-${statusCode}` };
}

/**
 * The single Resend API call, factored out so both the first attempt
 * (sendLoopEmail below) and the retry sweep (emailRetrySweep.js) build the
 * exact same request — headers, idempotencyKey — from a rendered email.
 */
export async function sendViaResend({ resend, to, subject, html, text, unsubscribeUrl, dedupeKey }) {
  return resend.emails.send(
    {
      from: FROM_ADDRESS,
      to: [to],
      subject,
      html,
      text,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    },
    { idempotencyKey: dedupeKey }
  );
}

export async function sendLoopEmail({
  supabase,
  userId,
  teamId = null,
  type,
  dedupeKey,
  to,
  subject,
  html,
  text,
  unsubscribeUrl,
  readStage = readEmailLoopStage,
  resendFactory = getResendClient,
  captureExceptionFn = captureException,
  now = new Date(),
} = {}) {
  if (!supabase?.from) throw new Error("sendLoopEmail: supabase required");
  if (!userId || !type || !dedupeKey || !to) {
    throw new Error("sendLoopEmail: userId, type, dedupeKey and to are required");
  }

  const stage = await readStage(supabase);
  if (stage === "off") return { skipped: "flag_off" };

  const { data: existing, error: dedupeErr } = await supabase
    .from("email_log").select("id").eq("dedupe_key", dedupeKey).maybeSingle();
  if (dedupeErr) throw new Error(`sendLoopEmail dedupe-check: ${dedupeErr.message}`);
  if (existing) return { skipped: "dedupe" };

  const { data: userRow, error: userErr } = await supabase
    .from("users").select("email_prefs").eq("id", userId).maybeSingle();
  if (userErr) throw new Error(`sendLoopEmail prefs-lookup: ${userErr.message}`);
  if (!isEmailTypeEnabled(userRow?.email_prefs, type)) return { skipped: "prefs" };

  if (stage === "dry_run") {
    const { error: insertErr } = await supabase.from("email_log").insert({
      user_id: userId, team_id: teamId, email_type: type, dedupe_key: dedupeKey, status: "dry_run",
    });
    if (insertErr) throw new Error(`sendLoopEmail dry_run log: ${insertErr.message}`);
    return { status: "dry_run" };
  }

  // stage === "on" from here.
  if (!process.env.RESEND_API_KEY) throw new Error("sendLoopEmail: RESEND_API_KEY not set");
  if (!process.env.EMAIL_UNSUB_SECRET) throw new Error("sendLoopEmail: EMAIL_UNSUB_SECRET not set");

  const resend = resendFactory();
  const { data, error } = await sendViaResend({ resend, to, subject, html, text, unsubscribeUrl, dedupeKey });

  if (error) {
    const message = error.message ?? String(error);
    const failure = classifyEmailFailure(error.statusCode ?? null);
    const retryable = failure.kind === "retryable";

    const { error: logErr } = await supabase.from("email_log").insert({
      user_id: userId, team_id: teamId, email_type: type, dedupe_key: dedupeKey,
      status: "failed", error: message, attempts: 1,
      // #3600: only retryable failures get a next_attempt_at + a snapshot of
      // the rendered email — a permanent failure (bad address, invalid API
      // key, validation) would just fail again identically, so there's
      // nothing to retry and no payload to keep around.
      next_attempt_at: retryable ? new Date(now.getTime() + nextEmailAttemptDelayMs(1)).toISOString() : null,
      retry_payload: retryable ? { to, subject, html, text, unsubscribeUrl } : null,
    });
    if (logErr) console.error(`[emailService] failed-log insert error for ${dedupeKey}:`, logErr.message);

    if (retryable) {
      console.warn(`[emailService] send failed (${failure.reason}), queued for retry: ${dedupeKey}`);
    } else {
      // #3600: permanent failures still alarm immediately — same as before,
      // and matching discordNotifier.js's sendWebhook (only retryable
      // failures defer the alarm to the drain's dead-alarm).
      captureExceptionFn(new Error(`email send failed (${type}): ${message}`), {
        tags: { flow: "email-loop", emailType: type, reason: failure.reason },
        extra: { userId, dedupeKey },
      });
    }
    return { status: "failed", error: message, retryable };
  }

  const { error: logErr } = await supabase.from("email_log").insert({
    user_id: userId, team_id: teamId, email_type: type, dedupe_key: dedupeKey,
    status: "sent", provider_id: data?.id ?? null,
  });
  if (logErr) {
    // Send already succeeded — a logging failure here must never look like a
    // send failure. Best-effort visibility only; the dedupe gap this could
    // theoretically open is bounded by Resend's own 24h idempotency window.
    console.error(`[emailService] sent-log insert error for ${dedupeKey}:`, logErr.message);
    captureExceptionFn(new Error(`email_log insert failed after send (${type}): ${logErr.message}`), {
      tags: { flow: "email-loop", emailType: type },
      extra: { userId, dedupeKey },
    });
  }

  return { status: "sent", providerId: data?.id ?? null };
}
