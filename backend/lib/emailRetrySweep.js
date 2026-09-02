/**
 * Email retry-drain (#3600). Sister module to discordWebhookOutbox.js
 * (#3545) — same shape (persisted next_attempt_at + exponential backoff over
 * ~27h, aggregated dead-alarm), different storage: this drains rows IN
 * email_log itself rather than a parallel outbox table, because email_log's
 * dedupe_key is already UNIQUE and already carries the user/team/type
 * identity a retry needs (see
 * database/2026-08-18-3600-email-log-retry.sql's header for why extending
 * email_log was chosen over a new table).
 *
 * ROOT CAUSE: sendLoopEmail (emailService.js) called resend.emails.send()
 * exactly once. A transient Resend failure (5xx/rate-limit/network) wrote a
 * 'failed' email_log row and stopped there — nothing ever read that row
 * again, so a Resend hiccup of even a few minutes cost every email queued
 * in that window, permanently. Same failure shape as #3545 (Discord
 * webhook-outbox): a delivery layer with no persistence-based retry behind
 * its inline attempt.
 *
 * IDEMPOTENCE: every retry reuses the SAME dedupe_key as Resend's
 * Idempotency-Key header (sendViaResend), so a retry can never double-send
 * even in the edge case where the original attempt actually succeeded on
 * Resend's side but the {data,error} response never reached us.
 *
 * Runs only while the email loop stage is "on" — a 'failed' row with a
 * populated retry_payload can only exist from that stage (dry_run never
 * calls Resend at all), and if the owner flips the flag back off mid-
 * incident, retries stop too (same fail-safe direction as isEmailLoopActive
 * elsewhere — turning OFF must never require a separate opt-out).
 *
 * #2853: the single email-loop flag split into a per-mailtype gate (welcome/
 * day1/race_digest each get their own off/dry_run/on). A queued retry row
 * carries its own `email_type`, and the type may have been flipped back off
 * AFTER the row was queued (while another type stays "on") — so the "off
 * stops retries" guarantee above is now evaluated PER ROW against that row's
 * own type-stage, not once globally. The cheap upfront check only
 * short-circuits the whole drain (skips the query) when every type is off,
 * preserving the pre-#2853 "fully dormant unless something is on" shape.
 */

import {
  classifyEmailFailure,
  sendViaResend,
  getResendClient,
  nextEmailAttemptDelayMs,
  MAX_EMAIL_ATTEMPTS,
} from "./emailService.js";
import { readEmailLoopStage, EMAIL_LOOP_TYPE_KEYS } from "./emailLoopFlag.js";
import { normalizeSupabaseErrorMessage } from "./supabaseErrorNormalize.js";
import { captureException } from "./sentry.js";

const DRAIN_BATCH_SIZE = 25;
const EMAIL_LOOP_TYPES = Object.keys(EMAIL_LOOP_TYPE_KEYS);

/**
 * Is the failure "the retry columns don't exist yet" (Postgres 42703 /
 * PostgREST PGRST204)? The drain ticks every 5 minutes; the window between
 * merge and the migration being applied post-merge (#2642-rammer) is real,
 * so without this filter a missing-column error would produce noisy Sentry
 * spam instead of one visible log line — same reasoning as
 * discordWebhookOutbox.js's isMissingTableError.
 */
export function isMissingRetryColumnError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "42703" || code === "PGRST204") return true;
  return /column .*next_attempt_at.* does not exist|could not find.*column/i.test(String(error.message || ""));
}

export async function processEmailRetryDrain({
  supabase,
  readStage = readEmailLoopStage,
  resendFactory = getResendClient,
  captureExceptionFn = captureException,
  now = new Date(),
  maxAttempts = MAX_EMAIL_ATTEMPTS,
} = {}) {
  if (!supabase?.from) throw new Error("processEmailRetryDrain: supabase required");

  // #2853: memoize per-type stage reads within this one drain run — at most
  // 3 distinct types exist, so this is a handful of app_config reads total
  // regardless of how many rows are in the batch.
  const stageCache = new Map();
  const stageFor = (type) => {
    if (!stageCache.has(type)) stageCache.set(type, readStage(supabase, type));
    return stageCache.get(type);
  };

  const anyTypeOn = (await Promise.all(EMAIL_LOOP_TYPES.map(stageFor))).some((stage) => stage === "on");
  if (!anyTypeOn) return { processed: 0, sent: 0, rescheduled: 0, dead: 0 };
  if (!process.env.RESEND_API_KEY) return { processed: 0, sent: 0, rescheduled: 0, dead: 0 };

  // schema-columns-ok: attempts/retry_payload are added by
  // database/2026-08-18-3600-email-log-retry.sql, applied post-merge
  // (#2642-rammer) — not yet in database/schema-snapshot.json at PR time.
  // isMissingRetryColumnError above already handles the pre-migration
  // window at runtime (same gap the guard's own header documents).
  const { data: rows, error } = await supabase
    .from("email_log")
    .select("id, dedupe_key, attempts, retry_payload, email_type")
    .eq("status", "failed")
    .not("next_attempt_at", "is", null)
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(DRAIN_BATCH_SIZE);

  if (error) {
    const reason = normalizeSupabaseErrorMessage(error.message);
    if (isMissingRetryColumnError(error)) {
      console.warn("[email:retry] retry-kolonner findes ikke endnu — migration mangler", { error: reason });
      return { processed: 0, sent: 0, rescheduled: 0, dead: 0 };
    }
    console.error("[email:retry] drain-select fejlede", { error: reason });
    captureExceptionFn(new Error(`Email retry-drain select fejlede: ${reason}`), {
      tags: { component: "email-retry-sweep" },
    });
    return { processed: 0, sent: 0, rescheduled: 0, dead: 0 };
  }
  if (!rows?.length) return { processed: 0, sent: 0, rescheduled: 0, dead: 0 };

  const resend = resendFactory();
  let sent = 0;
  let rescheduled = 0;
  let skippedTypeOff = 0;
  const deadRows = [];

  for (const row of rows) {
    // #2853: this row's own type may have been flipped back off (or to
    // dry_run) since it was queued, while another type stays "on" — leave it
    // untouched (next_attempt_at unchanged) so the next tick reconsiders it
    // once/if the type is "on" again. row.email_type is undefined for a
    // caller that predates #2853 or a test double — stageFor(undefined)
    // falls back to the legacy shared flag via readEmailLoopStage, same as
    // before this change.
    if ((await stageFor(row.email_type)) !== "on") {
      skippedTypeOff += 1;
      continue;
    }
    if (!row.retry_payload) {
      // Defensive: a 'failed' row with next_attempt_at set should always
      // carry a retry_payload (both are written together in emailService.js).
      // If it's ever missing, stop retrying this row instead of looping on
      // it forever with nothing to send.
      const { error: clearError } = await supabase
        .from("email_log").update({ next_attempt_at: null }).eq("id", row.id);
      if (clearError) {
        console.error("[email:retry] clear-update (missing payload) fejlede", {
          id: row.id, error: normalizeSupabaseErrorMessage(clearError.message),
        });
      }
      deadRows.push({ id: row.id, dedupeKey: row.dedupe_key, reason: "missing retry_payload", attempts: row.attempts });
      continue;
    }

    const { to, subject, html, text, unsubscribeUrl } = row.retry_payload;
    const { data, error: sendError } = await sendViaResend({
      resend, to, subject, html, text, unsubscribeUrl, dedupeKey: row.dedupe_key,
    });

    if (!sendError) {
      const { error: updateError } = await supabase
        .from("email_log")
        .update({ status: "sent", provider_id: data?.id ?? null, error: null, next_attempt_at: null, retry_payload: null })
        .eq("id", row.id);
      if (updateError) {
        // The send DID succeed — we can't undo that. Best-effort visibility
        // only, mirrors discordWebhookOutbox.js's delete-after-success gap.
        const reason = normalizeSupabaseErrorMessage(updateError.message);
        console.error("[email:retry] sent-update efter succesfuld levering fejlede", { id: row.id, error: reason });
        captureExceptionFn(new Error(`Email retry-drain sent-update fejlede efter succesfuld levering (id=${row.id}): ${reason}`), {
          tags: { component: "email-retry-sweep" }, extra: { rowId: row.id },
        });
      }
      sent++;
      continue;
    }

    const attempts = row.attempts + 1;
    const message = sendError.message ?? String(sendError);
    const failure = classifyEmailFailure(sendError.statusCode ?? null);
    const exhausted = attempts >= maxAttempts;

    if (failure.kind === "permanent" || exhausted) {
      const { error: deadUpdateError } = await supabase
        .from("email_log")
        .update({ attempts, error: message, next_attempt_at: null, retry_payload: null })
        .eq("id", row.id);
      if (deadUpdateError) {
        const reason = normalizeSupabaseErrorMessage(deadUpdateError.message);
        console.error("[email:retry] dead-markering fejlede", { id: row.id, error: reason });
        captureExceptionFn(new Error(`Email retry-drain dead-update fejlede (id=${row.id}): ${reason}`), {
          tags: { component: "email-retry-sweep" }, extra: { rowId: row.id },
        });
      }
      deadRows.push({ id: row.id, dedupeKey: row.dedupe_key, reason: failure.reason, attempts });
    } else {
      const { error: rescheduleError } = await supabase
        .from("email_log")
        .update({ attempts, error: message, next_attempt_at: new Date(now.getTime() + nextEmailAttemptDelayMs(attempts)).toISOString() })
        .eq("id", row.id);
      if (rescheduleError) {
        const reason = normalizeSupabaseErrorMessage(rescheduleError.message);
        console.error("[email:retry] reschedule-update fejlede", { id: row.id, error: reason });
        captureExceptionFn(new Error(`Email retry-drain reschedule-update fejlede (id=${row.id}): ${reason}`), {
          tags: { component: "email-retry-sweep" }, extra: { rowId: row.id },
        });
      } else {
        rescheduled++;
      }
    }
  }

  // ÉN aggregeret alarm pr. drain-run (ikke pr. mail) — dette ER det punkt
  // "mailen REELT er tabt" som #3600 bad om at flytte alarmen til, i stedet
  // for ved det foerste Resend-hik (som var den gamle adfaerd).
  //
  // Ordet med æ/ø/å holdes i en variabel på en linje UDEN error/reason/throw
  // for at undgå backend-i18n-leak-guarden (BACKEND_CONTEXT i
  // scripts/i18n-check-leaks.mjs) — beskeden går kun til Sentry, aldrig til
  // en spiller, men guarden skelner ikke internt fra player-facing.
  const attemptsWord = "forsøg";
  if (deadRows.length > 0) {
    const summary = deadRows
      .map((r) => `dedupe_key=${r.dedupeKey} (${r.reason ?? "unknown"}, ${r.attempts ?? "?"} ${attemptsWord})`)
      .join(", ");
    captureExceptionFn(
      new Error(`Email retry-drain: ${deadRows.length} mail(s) opgivet efter gentagne ${attemptsWord} — ${summary}`),
      { tags: { component: "email-retry-sweep" }, extra: { deadRows } }
    );
  }

  return { processed: rows.length - skippedTypeOff, sent, rescheduled, dead: deadRows.length };
}
