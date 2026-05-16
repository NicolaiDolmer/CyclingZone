-- Sprint-metrics dashboard backend (#365 / SPRINT_DASHBOARD.md Appendix #7).
-- Eksponerer admin-only RPC der returnerer DAU/WAU/MAU/D7-retention/avg-session/top-features
-- + trend-deltas (sammenlignet med forrige periode af samme størrelse).
--
-- Definitioner (matcher SPRINT_DASHBOARD.md "Game-metrics"-kolonne "Note"):
--   * DAU/WAU/MAU = distinct users med last_seen ELLER player_events-aktivitet inden for vinduet.
--     Union sikrer at brugere uden analytics-consent (kun last_seen via /api/presence) tæller med.
--   * D7-retention = % af users registreret for 7+ dage siden som har aktivitet (last_seen eller event)
--     inden for sidste 7 dage.
--   * Avg session length = gennemsnit pr. user-day af (max(created_at) - min(created_at)) i player_events
--     når brugeren har 2+ events samme UTC-dag (single-event-dage tæller ikke som "session").
--   * Top features = LIKE 'feature_%' events grupperet på event_name. Konvention fra logEvent.js.
--
-- Vindue (p_window):
--   * '24h' / '7d' / '30d' = rullende vinduer relativt til now()
--   * 'sprint' = 2026-05-18 → now() (Monetization Validation Sprint per BUSINESS_STRATEGY.md §6)
--
-- Caching: ingen DB-side cache. Frontend opfriskber max hver 5 min (per #365 AC).
-- Perf: player_events indexes på (event_name, created_at) + (team_id, created_at) findes allerede;
-- tilføjer (user_id, created_at) for retention-queries der filtrerer per user.
--
-- RLS-gate: RPC bruger public.is_admin() (eksisterer fra 2026-05-15-founder-supporter-waitlist.sql);
-- raiser 'forbidden' (42501) hvis ikke-admin kalder. SECURITY DEFINER nødvendig så den kan læse
-- auth.users count uden RLS-grants til authenticated.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_sprint_metrics(text);
--   DROP INDEX IF EXISTS player_events_user_id_created_at_idx;

CREATE INDEX IF NOT EXISTS player_events_user_id_created_at_idx
  ON public.player_events (user_id, created_at DESC);

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
  IF NOT public.is_admin() THEN
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

  -- Total registreret (auth.users er kilde-til-sandhed; public.users mangler indtil signup-bootstrap kører).
  SELECT count(*) INTO v_total_users FROM auth.users;

  -- DAU / WAU / MAU — kanoniske vinduer uafhængigt af p_window.
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

  -- Trend (7 dage før): samme vindue forskudt med dets størrelse.
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

  -- D7-retention: brugere registreret for 7+ dage siden, % der har aktivitet i sidste 7 dage.
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

  -- D7-trend: samme kohorte 7 dage tidligere (registreret for 14+ dage siden, aktiv mellem 7-14 dage siden).
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

  -- Avg session length (sekunder). Per-user-per-UTC-day; kræver 2+ events for at tælle.
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

  -- Aktive i valgt vindue (p_window) — reagerer på tids-vælger.
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

  -- Top 5 feature-events i valgt vindue.
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

REVOKE ALL ON FUNCTION public.get_sprint_metrics(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sprint_metrics(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sprint_metrics(text) IS
  'Admin-only sprint-metrics aggregator for /admin/sprint-metrics dashboard (#365). Returnerer DAU/WAU/MAU/D7/avg-session/top-features + trend-deltas i én jsonb-payload. Raiser forbidden (42501) hvis caller ikke er admin per is_admin().';
