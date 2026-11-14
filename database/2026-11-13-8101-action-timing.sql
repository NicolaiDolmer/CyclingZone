-- 2026-11-13 — #8101: svartids-loft for de ti vigtigste handlinger.
--
-- PROBLEM
--   Ingen måling eller alarm kiggede på svartid. Undersøgelsen 13/11 (#8101)
--   viste fire af de ti vigtigste handlinger over 3 sekunder, uden at nogen
--   alarm så det. Ejeren valgte "mulighed A": serveren måler selv.
--
-- LØSNING
--   backend/lib/actionTimingMonitor8101.js måler hvert kald til de ti handlinger
--   i hukommelsen (ingen databasekald pr. request) og skriver hvert kvarter én
--   række pr. handling her. Percentiler for et helt døgn regnes ud fra
--   histogram-spandene, så rækker fra flere kvarterer (og fra to processer under
--   en deploy) kan lægges sammen.
--
-- LÆS TALLENE (én SELECT, service_role / SQL-editor):
--   select * from public.action_timing_summary(24);   -- seneste døgn
--   select * from public.action_timing_summary(168);  -- seneste uge
--   p50_ms/p95_ms er den øvre grænse af den histogram-spand percentilen ligger i
--   (dog aldrig over det langsomste kald). Kvarterets egne, præcise tal står i
--   action_timing_windows.p50_ms/p95_ms.
--
-- IDEMPOTENT: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS overalt.

-- data-api-access: {"table":"public.action_timing_windows","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","DELETE"]},"sequences":{"public.action_timing_windows_id_seq":{"anon":[],"authenticated":[],"service_role":["USAGE"]}},"reason":"Backend-only drifts-maaling: backenden indsaetter kvarters-raekker og rydder gamle; lederen laeser via action_timing_summary som service_role"}
-- Én transaktion: REVOKE og GRANT skal ske atomisk (lint-migration-locks, #6342).
BEGIN;

CREATE TABLE IF NOT EXISTS public.action_timing_windows (
  id            bigserial PRIMARY KEY,
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  action        text NOT NULL,
  process_id    text NOT NULL,
  calls         integer NOT NULL CHECK (calls >= 0),
  p50_ms        integer,
  p95_ms        integer,
  max_ms        integer,
  over_3s       integer NOT NULL DEFAULT 0 CHECK (over_3s >= 0),
  hung          integer NOT NULL DEFAULT 0 CHECK (hung >= 0),
  buckets       integer[] NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (window_start, action, process_id)
);

CREATE INDEX IF NOT EXISTS action_timing_windows_window_start_idx
  ON public.action_timing_windows (window_start DESC);

COMMENT ON TABLE public.action_timing_windows IS
  '#8101 — svartid for de ti vigtigste handlinger. Én række pr. handling pr. kvarter pr. proces, skrevet af backend/lib/actionTimingMonitor8101.js. Læs med public.action_timing_summary(timer). Ingen spiller- eller hold-id.';

-- RLS: ren drifts-metadata (handlingsnavn + tider, ingen PII). Backend skriver via
-- service_role (bypasser RLS). Deny-all for anon/authenticated, samme mønster som
-- cron_checkins og ops_alert_state.
ALTER TABLE public.action_timing_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.action_timing_windows FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.action_timing_windows TO service_role;
REVOKE ALL ON SEQUENCE public.action_timing_windows_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.action_timing_windows_id_seq TO service_role;

DROP POLICY IF EXISTS "action_timing_windows_no_client_access" ON public.action_timing_windows;
CREATE POLICY "action_timing_windows_no_client_access" ON public.action_timing_windows
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Samlet opgørelse pr. handling over de seneste p_hours timer.
-- Spand-grænserne SKAL matche BUCKET_BOUNDS_MS i backend/lib/actionTimingMonitor8101.js
-- (actionTimingMonitor8101.test.js tjekker det).
CREATE OR REPLACE FUNCTION public.action_timing_summary(p_hours integer DEFAULT 24)
RETURNS TABLE (
  action       text,
  calls        bigint,
  p50_ms       integer,
  p95_ms       integer,
  max_ms       integer,
  over_3s      bigint,
  over_3s_pct  numeric,
  hung         bigint,
  first_window timestamptz,
  last_window  timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT ARRAY[250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 30000, 60000]::integer[] AS ub
  ),
  w AS (
    SELECT atw.*
      FROM public.action_timing_windows atw
     WHERE atw.window_start >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
  ),
  totals AS (
    SELECT w.action AS act,
           SUM(w.calls)::bigint   AS n_calls,
           MAX(w.max_ms)          AS mx,
           SUM(w.over_3s)::bigint AS n_over,
           SUM(w.hung)::bigint    AS n_hung,
           MIN(w.window_start)    AS first_w,
           MAX(w.window_end)      AS last_w
      FROM w
     GROUP BY w.action
  ),
  per_bucket AS (
    SELECT w.action AS act, u.idx::integer AS idx, SUM(u.n)::bigint AS n
      FROM w
      CROSS JOIN LATERAL unnest(w.buckets) WITH ORDINALITY AS u(n, idx)
     GROUP BY w.action, u.idx
  ),
  cum AS (
    SELECT pb.act, pb.idx,
           SUM(pb.n) OVER (PARTITION BY pb.act ORDER BY pb.idx) AS c
      FROM per_bucket pb
  ),
  pct AS (
    SELECT t.act,
           (SELECT MIN(c1.idx) FROM cum c1 WHERE c1.act = t.act AND c1.c >= CEIL(0.50 * t.n_calls)) AS i50,
           (SELECT MIN(c2.idx) FROM cum c2 WHERE c2.act = t.act AND c2.c >= CEIL(0.95 * t.n_calls)) AS i95
      FROM totals t
  )
  SELECT t.act,
         t.n_calls,
         CASE WHEN p.i50 IS NULL THEN NULL
              WHEN p.i50 > array_length(b.ub, 1) THEN t.mx
              ELSE LEAST(b.ub[p.i50], t.mx) END,
         CASE WHEN p.i95 IS NULL THEN NULL
              WHEN p.i95 > array_length(b.ub, 1) THEN t.mx
              ELSE LEAST(b.ub[p.i95], t.mx) END,
         t.mx,
         t.n_over,
         ROUND(100.0 * t.n_over / NULLIF(t.n_calls, 0), 1),
         t.n_hung,
         t.first_w,
         t.last_w
    FROM totals t
    JOIN pct p ON p.act = t.act
   CROSS JOIN bounds b
   ORDER BY t.n_over DESC, t.act;
$$;

COMMENT ON FUNCTION public.action_timing_summary(integer) IS
  '#8101 — antal, median, 95 %, langsomste og antal over 3 s pr. handling over de seneste p_hours timer. Percentiler = øvre grænse af histogram-spanden.';

REVOKE ALL ON FUNCTION public.action_timing_summary(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.action_timing_summary(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.action_timing_summary(integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- POST-VERIFY (kør efter apply):
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'action_timing_windows';
--   -- forventet: t
--   SELECT policyname FROM pg_policies WHERE tablename = 'action_timing_windows';
--   -- forventet: action_timing_windows_no_client_access
--   SELECT * FROM public.action_timing_summary(24);
--   -- forventet: 0 rækker lige efter apply; efter første kvarter med trafik én række pr. handling
