-- #2725 · Transactional email retention loop (welcome / day-1 nudge / race digest).
--
-- Ships DORMANT: backend/lib/emailLoopFlag.js reads app_config key
-- "email_loop_enabled" (off|dry_run|on, fail-safe → off). No cron sweep sends a
-- real email until the owner approves the copy in the PR and flips the flag
-- off → dry_run → on. This migration only adds the storage the loop needs;
-- it does not touch app_config itself (flag row is created/flipped manually
-- by the owner, same as auto_prize_enabled / stage_scheduler_enabled).
--
-- email_log: dedupe + audit trail for every send attempt (or dry_run/failed
-- attempt). dedupe_key is the idempotency anchor shared with the Resend
-- Idempotency-Key header (format "<type>:<userId>" or
-- "digest:<userId>:<YYYY-MM-DD Copenhagen date>") — UNIQUE so a re-run of a
-- cron sweep (overlapping tick, retry) can never double-send.
--
-- users.email_prefs: per-type opt-out JSONB, mirrors the existing
-- discord_dm_prefs pattern (2026-07-03-discord-dm-prefs.sql) — absent key =
-- enabled (default-on). Master switch is the "all" key
-- (email_prefs.all === false mutes every loop email for that user), set by
-- the one-click unsubscribe link.
--
-- RLS: service-role only. No player-facing table/route reads email_log
-- directly; the unsubscribe endpoint mutates users.email_prefs via the
-- backend's service-role client, not client-side RLS.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + CREATE
-- INDEX IF NOT EXISTS. Safe to re-run.
--
-- ⚠️ Denne fil COMMITTES kun — den anvendes ALDRIG af implementerings-
--    agenten mod prod. EJEREN merger PR'en og applier migrationen som et
--    SEPARAT post-merge-skridt (#2642-rammer: idempotent + post-verify).
--
-- Rollback:
--   DROP TABLE IF EXISTS public.email_log;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS email_prefs;

CREATE TABLE IF NOT EXISTS public.email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  team_id UUID,
  email_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('sent', 'dry_run', 'failed')),
  provider_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_log_user_id_email_type_idx
  ON public.email_log (user_id, email_type);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: new tables get default schema-level grants to
-- anon/authenticated in this project (jf. 2026-07-02-revoke-ability-caps-
-- client-select.sql-topologien) — RLS-with-no-policies already blocks every
-- row for those roles, but an explicit REVOKE documents intent and matches
-- the hardening pattern used across this repo.
REVOKE ALL ON public.email_log FROM anon, authenticated;
GRANT ALL ON public.email_log TO service_role;

COMMENT ON TABLE public.email_log IS
  '#2725: send/dry-run/failed log for the transactional email retention loop (welcome/day1/race_digest). dedupe_key is the idempotency anchor shared with Resend''s Idempotency-Key header. service-role only — no anon/authenticated policies.';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.users.email_prefs IS
  '#2725: per-type email opt-outs (welcome/day1/race_digest) + master "all" key. Absent key = enabled (default-on), mirrors discord_dm_prefs. Set to {"all": false} by the one-click unsubscribe link.';
