-- Sprint-metrics RPC: tillad service_role at kalde uden is_admin()-gate (#476).
--
-- Baggrund:
-- `get_sprint_metrics()` blev oprettet i 2026-05-17-sprint-metrics-rpc.sql med en
-- hård `IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'`-gate. Det giver
-- mening for frontend-callers (authenticated JWT), men blokerer GitHub Actions-
-- snapshot-workflowet (`sprint-metrics-snapshot.yml`) der bruger service_role-key
-- og dermed har `auth.uid() = NULL` → `is_admin() = false` → 403.
--
-- Fix: udvid gate-betingelsen til at acceptere `auth.role() = 'service_role'`. Det
-- er konsistent med Supabase's konvention om at service_role har admin-equivalent
-- adgang (samme niveau som direct DB-superuser). Service_role-keyen er allerede
-- begrænset til server-side miljøer (GHA secrets, backend) per repo-konvention.
--
-- Backward compat: alle eksisterende callers (admin via auth JWT) virker uændret —
-- is_admin()-grenen evalueres først og bevarer det tidligere flow.
--
-- Rollback:
--   Re-applicér 2026-05-17-sprint-metrics-rpc.sql (overskriver med CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.get_sprint_metrics(p_window text DEFAULT '7d')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now              timestamptz := now();
  v_window_start     timestamptz;
  v_window_size      interval;
  v_prev_start       timestamptz;
  v_total_users      int;
  v_dau              int;
  v_wau              int;
  v_mau              int;
  v_dau_prev         int;
  v_wau_prev         int;
  v_mau_prev         int;
  v_d7_eligible      int;
  v_d7_returning     int;
  v_d7_prev_eligible int;
  v_d7_prev_return   int;
  v_avg_session      numeric;
  v_avg_session_prev numeric;
  v_active_window      int;
  v_active_window_prev int;
  v_top_features     jsonb;
BEGIN
  -- Gate: admin-JWT ELLER service_role (sidstnævnte for GHA snapshot, #476).
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_window_start := CASE p_window
    WHEN '24h'    THEN v_now - interval '1 day'
    WHEN '7d'     THEN v_now - interval '7 days'
    WHEN '30d'    THEN v_now - interval '30 days'
    WHEN 'sprint' THEN timestamptz '2026-05-18 00:00:00+00'
    ELSE               v_now - interval '7 days'
  END;
  v_window_size := v_now - v_window_start;
  v_prev_start  := v_window_start - v_window_size;

  SELECT count(*) INTO v_total_users FROM auth.users;

  WITH active_1d AS (
    SELECT id AS user_id FROM public.users WHERE last_seen >= v_now - interval '1 day'
    UNION
    SELECT user_id FROM public.player_events WHERE created_at >= v_now - interval '1 day'
  )
  SELECT count(*) INTO v_dau FROM active_1d;

  WITH active_7d AS (
    SELECT id AS user_id FROM public.users WHERE last_seen >= v_now - interval '7 days'
    UNION
    SELECT user_id FROM public.player_events WHERE created_at >= v_now - interval '7 days'
  )
  SELECT count(*) INTO v_wau FROM active_7d;

  WITH active_30d AS (
    SELECT id AS user_id FROM public.users WHERE last_seen >= v_now - interval '30 days'
    UNION
    SELECT user_id FROM public.player_events WHERE created_at >= v_now - interval '30 days'
  )
  SELECT count(*) INTO v_mau FROM active_30d;

  WITH active_1d_prev AS (
    SELECT id AS user_id FROM public.users WHERE last_seen >= v_now - interval '8 days' AND last_seen < v_now - interval '7 days'
    UNION
    SELECT user_id FROM public.player_events WHERE created_at >= v_now - interval '8 days' AND created_at < v_now - interval '7 days'
  )
  SELECT count(*) INTO v_dau_prev FROM active_1d_prev;

  WITH active_7d_prev AS (
    SELECT id AS user_id FROM public.users WHERE last_seen >= v_now - interval '14 days' AND last_seen < v_now - interval '7 days'
    UNION
    SELECT user_id FROM public.player_events WHERE created_at >= v_now - interval '14 days' AND created_at < v_now - interval '7 days'
  )
  SELECT count(*) INTO v_wau_prev FROM active_7d_prev;

  WITH active_30d_prev AS (
    SELECT id AS user_id FROM public.users WHERE last_seen >= v_now - interval '60 days' AND last_seen < v_now - interval '30 days'
    UNION
    SELECT user_id FROM public.player_events WHERE created_at >= v_now - interval '60 days' AND created_at < v_now - interval '30 days'
  )
  SELECT count(*) INTO v_mau_prev FROM active_30d_prev;

  SELECT count(*) INTO v_d7_eligible
  FROM auth.users
  WHERE created_at <= v_now - interval '7 days';

  SELECT count(*) INTO v_d7_returning
  FROM auth.users au
  WHERE au.created_at <= v_now - interval '7 days'
    AND (
      EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = au.id AND pu.last_seen >= v_now - interval '7 days')
      OR EXISTS (SELECT 1 FROM public.player_events pe WHERE pe.user_id = au.id AND pe.created_at >= v_now - interval '7 days')
    );

  SELECT count(*) INTO v_d7_prev_eligible
  FROM auth.users
  WHERE created_at <= v_now - interval '14 days';

  SELECT count(*) INTO v_d7_prev_return
  FROM auth.users au
  WHERE au.created_at <= v_now - interval '14 days'
    AND (
      EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = au.id AND pu.last_seen >= v_now - interval '14 days' AND pu.last_seen < v_now - interval '7 days')
      OR EXISTS (SELECT 1 FROM public.player_events pe WHERE pe.user_id = au.id AND pe.created_at >= v_now - interval '14 days' AND pe.created_at < v_now - interval '7 days')
    );

  SELECT COALESCE(AVG(secs), 0) INTO v_avg_session
  FROM (
    SELECT EXTRACT(epoch FROM (max(created_at) - min(created_at))) AS secs
    FROM public.player_events
    WHERE created_at >= v_now - interval '7 days'
    GROUP BY user_id, date_trunc('day', created_at)
    HAVING count(*) >= 2
  ) s;

  SELECT COALESCE(AVG(secs), 0) INTO v_avg_session_prev
  FROM (
    SELECT EXTRACT(epoch FROM (max(created_at) - min(created_at))) AS secs
    FROM public.player_events
    WHERE created_at >= v_now - interval '14 days' AND created_at < v_now - interval '7 days'
    GROUP BY user_id, date_trunc('day', created_at)
    HAVING count(*) >= 2
  ) s;

  WITH active_window AS (
    SELECT id AS user_id FROM public.users WHERE last_seen >= v_window_start
    UNION
    SELECT user_id FROM public.player_events WHERE created_at >= v_window_start
  )
  SELECT count(*) INTO v_active_window FROM active_window;

  WITH active_window_prev AS (
    SELECT id AS user_id FROM public.users WHERE last_seen >= v_prev_start AND last_seen < v_window_start
    UNION
    SELECT user_id FROM public.player_events WHERE created_at >= v_prev_start AND created_at < v_window_start
  )
  SELECT count(*) INTO v_active_window_prev FROM active_window_prev;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.count DESC), '[]'::jsonb) INTO v_top_features
  FROM (
    SELECT event_name AS name, count(*)::int AS count
    FROM public.player_events
    WHERE created_at >= v_window_start
      AND event_name LIKE 'feature_%'
    GROUP BY event_name
    ORDER BY count(*) DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'window',                 p_window,
    'window_start',           v_window_start,
    'window_end',             v_now,
    'total_registered',       v_total_users,
    'dau',                    v_dau,
    'wau',                    v_wau,
    'mau',                    v_mau,
    'dau_prev',               v_dau_prev,
    'wau_prev',               v_wau_prev,
    'mau_prev',               v_mau_prev,
    'd7_eligible',            v_d7_eligible,
    'd7_returning',           v_d7_returning,
    'd7_retention_pct',       CASE WHEN v_d7_eligible > 0 THEN ROUND(100.0 * v_d7_returning / v_d7_eligible, 1) ELSE NULL END,
    'd7_retention_prev_pct',  CASE WHEN v_d7_prev_eligible > 0 THEN ROUND(100.0 * v_d7_prev_return / v_d7_prev_eligible, 1) ELSE NULL END,
    'avg_session_secs',       ROUND(v_avg_session)::int,
    'avg_session_secs_prev',  ROUND(v_avg_session_prev)::int,
    'active_in_window',       v_active_window,
    'active_in_window_prev',  v_active_window_prev,
    'top_features',           v_top_features,
    'generated_at',           v_now
  );
END;
$$;

COMMENT ON FUNCTION public.get_sprint_metrics(text) IS
  'Sprint-metrics aggregator for /admin/sprint-metrics dashboard (#365) + GHA snapshot (#476). Gate accepterer is_admin()-JWT ELLER service_role. Returnerer DAU/WAU/MAU/D7/avg-session/top-features + trend-deltas i én jsonb-payload.';
