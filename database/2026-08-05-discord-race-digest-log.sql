-- #3400 · Discord race/stage-result digest DM — dedupe log (max 1 DM/manager/day).
--
-- PROBLEM: race_result/stage_result must mirror to Discord DM (#3400), but a
-- team can accumulate MULTIPLE race_results rows in one Copenhagen calendar
-- day (a stage race's catch-up scheduler can run several stages in one tick,
-- #2090's "maks 5 etaper/dag"). Sending one DM per event would spam a manager
-- on a busy day — the AC explicitly caps it at 1 digest DM per manager per
-- day. A hard cap needs a PERSISTED marker, not just an in-memory per-tick
-- guard: cron.js already uses in-memory Maps for tick-level dedup (e.g.
-- stageSchedulerSeenKeys), but those reset on every Railway redeploy, which
-- would let a second digest slip through on the SAME calendar day after a
-- restart — unacceptable for a "no spam" hard cap.
--
-- FIX (mirrors the existing email_log pattern from
-- 2026-07-20-2725-email-retention-loop.sql, same dedupe-anchor shape): one
-- row per (user_id, digest_date), UNIQUE so a re-run of the sweep (overlapping
-- tick, retry) can never double-send. digest_date is the Copenhagen calendar
-- date (YYYY-MM-DD), same format as emailRaceDigestSweep.js's dedupeKey.
--
-- RLS: service-role only (same REVOKE/GRANT-hardening pattern as email_log —
-- no player-facing table/route reads this directly).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS. Safe to
-- re-run.
--
-- ⚠️ Denne fil COMMITTES kun — den anvendes ALDRIG af implementerings-agenten
--    mod prod under selve PR'en. Claude applier migrationen som et SEPARAT
--    post-merge-skridt (idempotent + post-verify, #2642-rammer, jf. CLAUDE.md
--    hard rule 9). Ikke-destruktiv (kun CREATE) — ingen ejer-gate nødvendig.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.discord_race_digest_log;

CREATE TABLE IF NOT EXISTS public.discord_race_digest_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  digest_date TEXT NOT NULL,
  item_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, digest_date)
);

CREATE INDEX IF NOT EXISTS discord_race_digest_log_user_id_idx
  ON public.discord_race_digest_log (user_id);

ALTER TABLE public.discord_race_digest_log ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: new tables get default schema-level grants to
-- anon/authenticated in this project (jf. 2026-07-02-revoke-ability-caps-
-- client-select.sql-topologien) — RLS-with-no-policies already blocks every
-- row for those roles, but an explicit REVOKE documents intent and matches
-- the hardening pattern used across this repo.
REVOKE ALL ON public.discord_race_digest_log FROM anon, authenticated;
GRANT ALL ON public.discord_race_digest_log TO service_role;

COMMENT ON TABLE public.discord_race_digest_log IS
  '#3400: dedupe log for the daily race/stage-result Discord DM digest — UNIQUE (user_id, digest_date) caps delivery at 1 DM per manager per Copenhagen calendar day, surviving cron overlap and process restarts (mirrors email_log''s dedupe_key pattern). service-role only — no anon/authenticated policies.';
