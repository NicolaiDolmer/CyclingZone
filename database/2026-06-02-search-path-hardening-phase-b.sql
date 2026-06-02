-- Security hardening phase B (Refs #927, #525 follow-up).
--
-- Baggrund:
-- Supabase advisor flagger igen mutable search_path (lint 0011) på to functions:
--   - public.increment_balance_with_audit(uuid, bigint, jsonb)
--   - public.regenerate_race_points()
--
-- increment_balance_with_audit blev allerede hærdet i
-- 2026-05-21-security-hardening-phase-a.sql:52-53, men et senere
-- CREATE OR REPLACE i 2026-05-26-backend-message-codes.sql (metadata-kolonne)
-- nulstillede per-funktion-config (Postgres rydder SET search_path når en
-- CREATE OR REPLACE ikke gen-specificerer den) → fixet blev vasket væk.
-- regenerate_race_points er ny fra 2026-06-01-race-point-model.sql og fik
-- aldrig search_path sat.
--
-- Denne migration gør to ting:
--   1. ALTER (her) — gen-hærder begge functions på live DB. Minimal blast-radius,
--      rører ikke funktions-body. Samme mønster + værdi som phase-a
--      (`public, pg_catalog`, konsistent med de 8 eksisterende hærdede functions).
--   2. Forward-guard (i samme PR) — `SET search_path = public, pg_catalog` er nu
--      bagt ind i source-migrationerne (2026-05-09-balance-rpc.sql,
--      2026-05-26-backend-message-codes.sql, 2026-06-01-race-point-model.sql),
--      så et fremtidigt re-run af dem ikke regrederer fixet en 3. gang.
--
-- Begge functions er SECURITY INVOKER og kun service-role/backend-kaldt
-- (increment_balance_with_audit REVOKE'd fra anon i phase-a; regenerate_race_points
-- kun backend) — praktisk risiko er lav, men advisor-WARN består indtil search_path
-- er sat.
--
-- Idempotent: ALTER ... SET search_path kan køres flere gange uden effekt-forskel.
--
-- Rollback:
--   ALTER FUNCTION public.increment_balance_with_audit(uuid, bigint, jsonb) RESET search_path;
--   ALTER FUNCTION public.regenerate_race_points() RESET search_path;

BEGIN;

ALTER FUNCTION public.increment_balance_with_audit(uuid, bigint, jsonb)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.regenerate_race_points()
  SET search_path = public, pg_catalog;

-- Sanity: bekræft at begge functions nu har search_path sat før commit.
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('increment_balance_with_audit', 'regenerate_race_points')
    AND p.proconfig IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS cfg
      WHERE cfg LIKE 'search_path=%'
    );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Forventede 2 functions med search_path sat, fandt %', v_count;
  END IF;
END $$;

COMMIT;

-- Registrer migration i auto-migrate state-table.
INSERT INTO schema_migrations (filename, applied_at) VALUES
  ('database/2026-06-02-search-path-hardening-phase-b.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
