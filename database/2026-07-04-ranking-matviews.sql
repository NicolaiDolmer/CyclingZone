-- ============================================================
-- Perf: rangliste + rytter-rangliste via materialized views (#2175 Del 1)
-- ============================================================
--
-- ROD-ÅRSAG: /rider-rankings og /standings hentede ALLE ~38k race_results
-- (pagineret i ~37 round-trips) + alle riders til browseren og aggregerede
-- client-side. Én fejlet batch = uendelig spinner. Fixet flytter den tunge
-- race_results-aggregering til Postgres; frontend laver lette queries mod
-- færdigberegnet resultat.
--
-- Projektets FØRSTE materialized views. Alle tre er ren race_results-aggregering
-- og spejler den nuværende client-agg 1:1 (paritet verificeret mod prod-data
-- 2026-07-04: rider points/wins/top3, team comp/podier/præmie, progression —
-- alle bit-identiske med den gamle JS-logik).
--
-- ATTRIBUTION (bevar præcis parity med frontend):
--   * rider_rankings_mv  — pr. race_results.rider_id.
--   * team_standings_ext_mv — team_key = COALESCE(rr.team_id, ri.team_id).
--       comp_*/prize keyer de facto på rr.team_id (team-rækker har rider_id NULL →
--       ri.team_id NULL → COALESCE falder til rr.team_id; prize filtrerer
--       team_id NOT NULL). podiums matcher countTeamPodiums (standingsPodiums.js):
--       team_id-snapshot foretrækkes, rytterens hold som fallback.
--   * team_race_points_mv — pr. riders.team_id (rytterens NUVÆRENDE hold), spejler
--       progressions-grafens `r.rider?.team_id`-attribution i StandingsPage.
--
-- REFRESH: non-concurrent via public.refresh_ranking_matviews() (SECURITY DEFINER).
--   REFRESH ... CONCURRENTLY kan IKKE køre inde i en plpgsql-funktion
--   (transaktions-blok), og backend har ingen rå pg-klient (kun supabase-js). Data
--   er lille (aggregat af 38k → få tusinde rækker) → refresh er sub-sekund og den
--   korte lock er acceptabel. UNIQUE-index oprettes alligevel (query-perf + åbner
--   for CONCURRENTLY via pg_cron senere hvis read-blocking bliver et problem).
--   Kaldes fra race-finalization (raceRunner.js) + cron-fallback (cron.js).
--
-- RLS: materialized views understøtter IKKE RLS. Rangliste-data er offentligt
--   (alle kilde-tabeller har public read USING (true)) → eksponeres via GRANT
--   SELECT TO anon, authenticated. Ingen følsomme felter i aggregaterne.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE). CREATE MATERIALIZED VIEW
-- populerer med det samme (ikke WITH NO DATA) → aktuel straks efter auto-migrate.
-- Anvendes automatisk ved deploy (Supabase auto-migrate af database/*.sql).
-- EJEREN MERGER (migration auto-applies i prod).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.refresh_ranking_matviews();
--   DROP MATERIALIZED VIEW IF EXISTS public.team_race_points_mv;
--   DROP MATERIALIZED VIEW IF EXISTS public.team_standings_ext_mv;
--   DROP MATERIALIZED VIEW IF EXISTS public.rider_rankings_mv;

-- ─── rider_rankings_mv: pr. (season_id, rider_id) ───────────────────────────────
-- Spejler RiderRankingsPage.jsx agg-loopet 1:1. race_type-joinet skiller gc_wins
-- (etapeløb-samlet) fra classic_wins (klassiker) og dags-/trøje-typerne.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.rider_rankings_mv AS
SELECT
  ra.season_id,
  rr.rider_id,
  SUM(rr.points_earned)                                                              AS points,
  SUM(rr.prize_money)                                                                AS prize_earned,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'stage')                   AS stage_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'gc' AND ra.race_type = 'stage_race') AS gc_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'gc' AND ra.race_type = 'single')     AS classic_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'points')                  AS pts_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'mountain')                AS mtn_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'young')                   AS young_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'leader')                  AS yellow_days,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'points_day')              AS green_days,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'mountain_day')            AS polka_days,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'young_day')               AS white_days,
  COUNT(*) FILTER (WHERE rr.result_type IN ('stage','gc') AND rr.rank BETWEEN 1 AND 3)  AS top3,
  COUNT(*) FILTER (WHERE rr.result_type IN ('stage','gc') AND rr.rank BETWEEN 1 AND 10) AS top10
FROM public.race_results rr
JOIN public.races ra ON ra.id = rr.race_id
WHERE rr.rider_id IS NOT NULL
GROUP BY ra.season_id, rr.rider_id;

-- UNIQUE kræves af REFRESH ... CONCURRENTLY (fremtids-mulighed) + hurtige lookups.
CREATE UNIQUE INDEX IF NOT EXISTS rider_rankings_mv_pk       ON public.rider_rankings_mv (season_id, rider_id);
CREATE INDEX        IF NOT EXISTS rider_rankings_mv_season   ON public.rider_rankings_mv (season_id, points DESC);
GRANT SELECT ON public.rider_rankings_mv TO anon, authenticated;

-- ─── team_standings_ext_mv: pr. (season_id, team_id) ────────────────────────────
-- Skalar-kolonnerne StandingsPage i dag udleder client-side fra race_results
-- (holdkonkurrence, podier, præmie). season_standings dækker points/stage_wins/
-- gc_wins (uændret, backend-vedligeholdt) — dette matview er KUN de afledte.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.team_standings_ext_mv AS
SELECT
  ra.season_id,
  COALESCE(rr.team_id, ri.team_id)                                                     AS team_id,
  COUNT(*) FILTER (WHERE rr.result_type = 'team' AND rr.rank = 1)                       AS comp_wins,
  COUNT(*) FILTER (WHERE rr.result_type = 'team' AND rr.rank BETWEEN 1 AND 3)           AS comp_podiums,
  COUNT(*) FILTER (WHERE rr.result_type IN ('stage','gc') AND rr.rank BETWEEN 1 AND 3)  AS podiums,
  COALESCE(SUM(rr.prize_money) FILTER (WHERE rr.team_id IS NOT NULL), 0)                AS prize_earned
FROM public.race_results rr
JOIN public.races ra ON ra.id = rr.race_id
LEFT JOIN public.riders ri ON ri.id = rr.rider_id
WHERE COALESCE(rr.team_id, ri.team_id) IS NOT NULL
GROUP BY ra.season_id, COALESCE(rr.team_id, ri.team_id);

CREATE UNIQUE INDEX IF NOT EXISTS team_standings_ext_mv_pk ON public.team_standings_ext_mv (season_id, team_id);
GRANT SELECT ON public.team_standings_ext_mv TO anon, authenticated;

-- ─── team_race_points_mv: pr. (season_id, team_id, race_id) ─────────────────────
-- Kildedata til progressions-grafen. Frontend cumulerer client-side over disse
-- SMÅ pr-løb-rækker (ingen 38k-fetch). Attribution = rytterens nuværende hold
-- (INNER JOIN riders + team_id NOT NULL), præcis som `r.rider?.team_id` i dag.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.team_race_points_mv AS
SELECT
  ra.season_id,
  ri.team_id,
  rr.race_id,
  ra.name              AS race_name,
  SUM(rr.prize_money)  AS race_points
FROM public.race_results rr
JOIN public.races ra ON ra.id = rr.race_id
JOIN public.riders ri ON ri.id = rr.rider_id
WHERE ri.team_id IS NOT NULL
GROUP BY ra.season_id, ri.team_id, rr.race_id, ra.name;

CREATE UNIQUE INDEX IF NOT EXISTS team_race_points_mv_pk     ON public.team_race_points_mv (season_id, team_id, race_id);
CREATE INDEX        IF NOT EXISTS team_race_points_mv_season ON public.team_race_points_mv (season_id, team_id);
GRANT SELECT ON public.team_race_points_mv TO anon, authenticated;

-- ─── Refresh-RPC (kaldes fra backend: race-finalization + cron-fallback) ────────
-- Non-concurrent (kan køre inde i funktionen). SECURITY DEFINER så backendens
-- service_role kan refreshe matviews den ikke selv ejer.
CREATE OR REPLACE FUNCTION public.refresh_ranking_matviews()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.rider_rankings_mv;
  REFRESH MATERIALIZED VIEW public.team_standings_ext_mv;
  REFRESH MATERIALIZED VIEW public.team_race_points_mv;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_ranking_matviews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_ranking_matviews() TO service_role;

-- pgrst_ddl_watch reloader normalt ved DDL/GRANT; eksplicit NOTIFY koster intet.
NOTIFY pgrst, 'reload schema';
