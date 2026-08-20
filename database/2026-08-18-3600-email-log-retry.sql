-- #3600 · Retry queue for the email retention-loop's failed sends.
--
-- PROBLEM: sendLoopEmail (backend/lib/emailService.js) calls
-- resend.emails.send() exactly once. Any Resend failure — a transient 5xx,
-- rate-limit, or network hiccup — writes a 'failed' row to email_log and is
-- never retried. A short Resend outage costs every email queued during that
-- window, permanently. Same failure SHAPE as the Discord webhook-outbox bug
-- (#3545, 2026-08-10-discord-webhook-outbox.sql): a delivery layer with only
-- inline (or zero) retry, no persistence-based retry behind it.
--
-- FIX: extend email_log in place rather than adding a parallel outbox table.
-- email_log already carries the dedupe/audit identity we need (dedupe_key is
-- UNIQUE, so a row IS the retry state for that send attempt); it was just
-- missing the columns to schedule and rehydrate a retry:
--   attempts        — inline attempt count so far (starts at 1, same
--                      convention as discord_webhook_outbox.attempts).
--   next_attempt_at — when the retry sweep should try again. NULL means "not
--                      retryable" (send succeeded, was a dry_run, or the
--                      failure was permanent/exhausted) — the sweep's WHERE
--                      clause is exactly `next_attempt_at IS NOT NULL AND
--                      next_attempt_at <= now()`, so permanent failures need
--                      no separate status value to stay untouched.
--   retry_payload   — the rendered email (to/subject/html/text/
--                      unsubscribeUrl) captured at the moment of the failed
--                      attempt, so the retry sweep can resend byte-identical
--                      content without re-deriving it from live team/user
--                      state (which may have drifted by the time of retry).
--                      NULL once a row stops being retryable, so a dead
--                      row's payload doesn't linger indefinitely.
--
-- IDEMPOTENCY unchanged: retries reuse the SAME dedupe_key as Resend's
-- Idempotency-Key header, so a retry can never double-send even if the
-- original attempt actually succeeded on Resend's side but the response was
-- lost in transit (see emailService.js's sendLoopEmail module header).
--
-- Backend logic: backend/lib/emailService.js (classifyEmailFailure,
-- enqueue-on-retryable-failure) + backend/lib/emailRetrySweep.js (drain,
-- mirrors backend/lib/discordWebhookOutbox.js's processWebhookOutboxDrain).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS. Safe to
-- re-run. Non-destructive (no data loss on existing rows — new columns
-- default to NULL/1) — no owner-gate needed per the
-- 2026-08-05-discord-race-digest-log.sql precedent.
--
-- ⚠️ Denne fil COMMITTES kun — den anvendes ALDRIG af implementerings-agenten
--    mod prod under selve PR'en. Claude applier migrationen som et SEPARAT
--    post-merge-skridt (idempotent + post-verify, #2642-rammer, jf. CLAUDE.md
--    hard rule 9).
--
-- Rollback:
--   ALTER TABLE public.email_log DROP COLUMN IF EXISTS attempts;
--   ALTER TABLE public.email_log DROP COLUMN IF EXISTS next_attempt_at;
--   ALTER TABLE public.email_log DROP COLUMN IF EXISTS retry_payload;
--   DROP INDEX IF EXISTS public.email_log_retry_due_idx;

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_payload JSONB;

-- Drain-query: WHERE status='failed' AND next_attempt_at IS NOT NULL AND
-- next_attempt_at <= now() ORDER BY next_attempt_at.
CREATE INDEX IF NOT EXISTS email_log_retry_due_idx
  ON public.email_log (next_attempt_at)
  WHERE status = 'failed' AND next_attempt_at IS NOT NULL;

COMMENT ON COLUMN public.email_log.attempts IS
  '#3600: inline send-attempt count for this dedupe_key (starts at 1). Incremented by the retry sweep on each additional Resend attempt.';
COMMENT ON COLUMN public.email_log.next_attempt_at IS
  '#3600: when the retry sweep should next attempt this row. NULL = not retryable (sent/dry_run, or permanent/exhausted failure) — the retry sweep never touches a NULL row.';
COMMENT ON COLUMN public.email_log.retry_payload IS
  '#3600: rendered email snapshot ({to, subject, html, text, unsubscribeUrl}) captured at the failed attempt, so the retry sweep can resend without re-deriving content. Cleared (NULL) once the row is no longer retryable.';
