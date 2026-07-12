-- Retention-scorecard v2 (#2360, afløser lukket meta-issue #135). Data-fundament
-- til #1279's GO/NO-GO for betalt marketing under Touren — tallene skal være
-- korrekte, ikke flotte.
--
-- Adskilt fra #1168's get_cohort_retention (D1/D3/D7, UFILTRERET population —
-- inkluderer permanente QA-testkonti og frosne hold): DENNE RPC filtrerer til
-- RIGTIGE managere med samme diskriminator som economy-overview/board/academy
-- (grep'et fra backend/routes/api.js linje ~9258 + backend/lib/academyIntake.js):
--   teams.is_ai = false AND is_bank = false AND is_frozen = false
--   AND is_test_account = false
-- AI/bank-hold har intet auth-login og optræder derfor aldrig i public.users under
-- dette filter; frosne/test-hold ville forvrænge et marketing-beslutningstal.
--
-- Retention-definition (ROLLING/unbounded — samme model som #1168, se
-- database/2026-06-09-cohort-retention-rpc.sql for fuld begrundelse): en manager
-- tæller "returnerede på +Nd" hvis last_activity >= signup + N dage, hvor
-- last_activity = GREATEST(users.last_seen, MAX(player_events.created_at)).
--
-- Denne RPC returnerer RÅ aktivitets-rows (ét pr. rigtig manager i vinduet) —
-- ikke færdig-aggregerede kohorter. Cohort-bucketing + D1/D7/D30-eligibility
-- beregnes i Node (backend/lib/retentionScorecard.js, unit-testet uden DB) via
-- GET /api/admin/retention. Grunden til at MAX(player_events.created_at) pr.
-- user beregnes HER og ikke client-side: player_events er allerede 90k+ rows
-- for blot 8 ugers rigtige managere, og Supabase-projektets PostgREST har
-- aggregate-funktioner deaktiveret (db-aggregates-enabled=false, verificeret
-- 2026-07-11) — en naiv .select("user_id,created_at") ville stille trunkeres
-- til PostgREST's 1000-rows-standardgrænse og give forkerte (for gamle)
-- last_activity-tal for aktive brugere. En correlated MAX-subquery pr. bruger
-- i SQL (samme mønster som #1168) undgår det helt.
--
-- Ydelse: player_events har ingen index på user_id alene (kun (event_name,
-- created_at) og (team_id, created_at), database/2026-05-11-player-events.sql).
-- Tilføjer targeted index så MAX-subqueryen er en index-scan, ikke en seq-scan
-- pr. bruger — gavner også #1168's tilsvarende subquery-mønster.
--
-- RLS-gate: is_admin()-JWT ELLER service_role (matcher #1168 + #476-mønster).
-- SECURITY DEFINER nødvendig for at læse public.users/teams uden RLS-grants til
-- authenticated. Route-laget (GET /api/admin/retention) kalder altid med
-- service_role, men gaten er defense-in-depth hvis grants nogensinde udvides.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_retention_scorecard_activity(int);
--   DROP INDEX IF EXISTS public.player_events_user_id_created_at_idx;

CREATE INDEX IF NOT EXISTS player_events_user_id_created_at_idx
  ON public.player_events (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_retention_scorecard_activity(p_weeks int DEFAULT 8)
RETURNS TABLE (
  user_id       uuid,
  signup_at     timestamptz,
  last_activity timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH real_managers AS (
    -- Samme diskriminator som UI'et/andre admin-flader bruger for "rigtige hold".
    SELECT DISTINCT t.user_id
    FROM public.teams t
    WHERE t.is_ai = false AND t.is_bank = false AND t.is_frozen = false AND t.is_test_account = false
      AND t.user_id IS NOT NULL
  )
  SELECT
    pu.id,
    pu.created_at,
    GREATEST(
      COALESCE(pu.last_seen, pu.created_at),
      COALESCE((SELECT max(pe.created_at) FROM public.player_events pe WHERE pe.user_id = pu.id), pu.created_at)
    ) AS last_activity
  FROM public.users pu
  JOIN real_managers rm ON rm.user_id = pu.id
  WHERE pu.created_at >= date_trunc('week', now())
    - make_interval(weeks => LEAST(GREATEST(COALESCE(p_weeks, 8), 1), 52) - 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_retention_scorecard_activity(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_retention_scorecard_activity(int) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_retention_scorecard_activity(int) IS
  'Rå pr.-manager aktivitets-rows (signup_at, last_activity) for RIGTIGE managere (#2360, afløser #135) — filtrerer AI/bank/frosne/test-hold via teams (samme diskriminator som economy-overview/board). Cohort-bucketing + D1/D7/D30 beregnes i Node (backend/lib/retentionScorecard.js). Gate: is_admin() ELLER service_role.';
