-- Signup-kohorte-retention RPC (#1168 / TdF-validerings-roadmap §5).
-- Data-fundament til go/no-go-beslutningen i Tourens 1. uge (~4.–11/7): "kom de der
-- joinede *under Touren* tilbage?". Den eksisterende D7 i get_sprint_metrics er et
-- rullende aggregat (% af ALLE 7-dages-gamle users aktive sidste 7 dage) — den
-- isolerer IKKE en bestemt signup-kohorte. Denne RPC giver en signup-kohorte-kurve:
-- kohorte = signup-uge, retur målt på +1d / +3d / +7d.
--
-- Retention-definition (ROLLING / unbounded):
--   For en user i kohorte C tæller "returnerede på +Nd" = brugerens seneste aktivitet
--   (GREATEST(last_seen, max(player_events.created_at))) ligger >= signup + N dage.
--   Dvs. "var brugeren stadig aktiv mindst N dage efter signup". Valgt frem for
--   "aktiv PRÆCIS på dag N" (bounded), fordi beta-populationen er lille og daglig
--   aktivitet sparsom — bounded ville give nul-støj. Rolling er det robuste
--   stickiness-signal til go/no-go.
--
-- Eligibility: en user tæller kun i d{N}_eligible hvis signup + N dage <= now()
--   (nok tid er gået til at +Nd overhovedet kan måles). Kohorter yngre end N dage
--   bidrager 0 til d{N}_eligible → pct = NULL ("—" i UI), ikke 0%.
--
-- Aktivitets-kilde: UNION-ækvivalent af public.users.last_seen (ikke consent-gated,
--   sættes via /api/presence) + player_events. Matcher get_sprint_metrics så tallene
--   er konsistente på tværs af dashboardet selv for users uden analytics-consent.
--
-- Vindue (p_weeks): antal seneste signup-uger der returneres (default 8). Uger
--   trunkeres i DB-session-tz (UTC på Supabase) via date_trunc('week', ...) =
--   mandag 00:00 UTC. Konsistent med get_sprint_metrics' UTC-vinduer.
--
-- RLS-gate: is_admin()-JWT ELLER service_role (sidstnævnte for evt. GHA-snapshot,
--   konsistent med 2026-05-18-sprint-metrics-service-role-bypass.sql). SECURITY
--   DEFINER nødvendig for at læse auth.users uden RLS-grants til authenticated.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_cohort_retention(int);

CREATE OR REPLACE FUNCTION public.get_cohort_retention(p_weeks int DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now     timestamptz := now();
  v_cutoff  timestamptz;
  v_cohorts jsonb;
BEGIN
  -- Gate: admin-JWT ELLER service_role (konsistent med get_sprint_metrics, #476).
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Clamp p_weeks til [1, 52] så en absurd værdi ikke scanner hele tabellen.
  p_weeks := LEAST(GREATEST(COALESCE(p_weeks, 8), 1), 52);
  -- Start på den ældste kohorte-uge der skal med (mandag 00:00 i denne uges start
  -- minus p_weeks-1 uger → præcis p_weeks uge-buckets inkl. indeværende uge).
  v_cutoff := date_trunc('week', v_now) - make_interval(weeks => p_weeks - 1);

  WITH user_activity AS (
    SELECT
      au.id,
      au.created_at AS signup_at,
      GREATEST(
        COALESCE(pu.last_seen, au.created_at),
        COALESCE((SELECT max(pe.created_at) FROM public.player_events pe WHERE pe.user_id = au.id), au.created_at)
      ) AS last_activity
    FROM auth.users au
    LEFT JOIN public.users pu ON pu.id = au.id
    WHERE au.created_at >= v_cutoff
  ),
  cohorts AS (
    SELECT
      date_trunc('week', signup_at) AS cohort_week,
      count(*)::int AS cohort_size,
      count(*) FILTER (WHERE signup_at + interval '1 day'  <= v_now)::int AS d1_eligible,
      count(*) FILTER (WHERE signup_at + interval '1 day'  <= v_now AND last_activity >= signup_at + interval '1 day')::int  AS d1_returned,
      count(*) FILTER (WHERE signup_at + interval '3 days' <= v_now)::int AS d3_eligible,
      count(*) FILTER (WHERE signup_at + interval '3 days' <= v_now AND last_activity >= signup_at + interval '3 days')::int AS d3_returned,
      count(*) FILTER (WHERE signup_at + interval '7 days' <= v_now)::int AS d7_eligible,
      count(*) FILTER (WHERE signup_at + interval '7 days' <= v_now AND last_activity >= signup_at + interval '7 days')::int AS d7_returned
    FROM user_activity
    GROUP BY date_trunc('week', signup_at)
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'cohort_week',  to_char(cohort_week, 'YYYY-MM-DD'),
      'cohort_size',  cohort_size,
      'd1_eligible',  d1_eligible,
      'd1_returned',  d1_returned,
      'd1_pct',       CASE WHEN d1_eligible > 0 THEN ROUND(100.0 * d1_returned / d1_eligible, 1) ELSE NULL END,
      'd3_eligible',  d3_eligible,
      'd3_returned',  d3_returned,
      'd3_pct',       CASE WHEN d3_eligible > 0 THEN ROUND(100.0 * d3_returned / d3_eligible, 1) ELSE NULL END,
      'd7_eligible',  d7_eligible,
      'd7_returned',  d7_returned,
      'd7_pct',       CASE WHEN d7_eligible > 0 THEN ROUND(100.0 * d7_returned / d7_eligible, 1) ELSE NULL END
    ) ORDER BY cohort_week DESC
  ), '[]'::jsonb) INTO v_cohorts
  FROM cohorts;

  RETURN jsonb_build_object(
    'weeks',        p_weeks,
    'generated_at', v_now,
    'cohorts',      v_cohorts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cohort_retention(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cohort_retention(int) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_cohort_retention(int) IS
  'Admin-only signup-kohorte-retention for /admin/sprint-metrics (#1168). Kohorte = signup-uge; rolling retention (last_activity >= signup + Nd) på D1/D3/D7 med eligibility-gate (signup + Nd <= now). Aktivitet = last_seen UNION player_events. Gate: is_admin() ELLER service_role. Raiser forbidden (42501) ved ikke-admin.';
