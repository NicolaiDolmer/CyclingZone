-- ============================================================
-- Global rank: rangliste på tværs af alle managers (#2453)
-- ============================================================
--
-- EJER-ØNSKE (#2453): "global rank" — én rangliste alle managers er på, over en
-- rullende periode, der overlever op-/nedrykning og giver en grund til at blive
-- ved efter sæsonen er afgjort.
--
-- BESLUTNING (anbefaling fra issuet, EJER GODKENDER/JUSTERER VED MERGE):
--   * Periode: de seneste 2 sæsoner (nuværende + forrige). recency_rank 1 = mest
--     aktuelle sæson (uanset status active/completed), recency_rank 2 = forrige.
--     SEASON_WEIGHT: nuværende sæson = 1.0, forrige = 0.5 (nuværende tæller mest,
--     ældre falder helt af efter 2 sæsoner).
--   * Point-kilde: season_standings.total_points (samme UCI-lignende resultat-
--     point som allerede driver /standings), vægtet pr. DIVISION historisk (den
--     tier holdet faktisk stod i DEN sæson — season_standings.division, ikke
--     teams.division) så en gammel Div-4-sejr ikke tæller som en Div-1-sejr.
--     DIVISION_WEIGHT: Div 1=4, Div 2=3, Div 3=2, Div 4=1 (lineær, dokumenteret
--     konstant — mirror i backend/lib/globalRankFormula.js for testbarhed).
--   * Nye managere: global_score = vægtet_sum / sæsoner_deltaget (GENNEMSNIT pr.
--     sæson, IKKE rå sum). En ny manager med 1 stærk sæson sammenlignes på sit
--     per-sæson-snit mod en veterans per-sæson-snit over 2 sæsoner — ranglisten
--     måler dermed præstation, ikke bare anciennitet.
--
-- PERF (#2196/#2204/#2206 har bidt os på rangliste-perf før): matview +
-- freshness-heartbeat-mønster fra rider_rankings_mv (2026-07-04-ranking-
-- matviews.sql), IKKE live-beregning. Refresh foldes ind i den EKSISTERENDE
-- refresh_ranking_matviews()-RPC (samme heartbeat-gruppe 'ranking'), så den
-- allerede virksomme kalder-kæde (race-finalization + 10-min cron-fallback,
-- se raceRunner.js + cron.js) dækker global rank uden nye call-sites.
--
-- BEVÆGELSE (op/ned siden sidst): global_rank_snapshot gemmer rangen FØR hver
-- refresh (kopi af de gamle global_rank_mv-rækker), så UI kan vise
-- "siden sidst" = siden forrige refresh-cyklus (ikke siden brugerens seneste
-- besøg — det er den bevidste afgrænsning, dokumenteret i PR-body).
--
-- FILTER (matcher StandingsPage-mønsteret): ekskluderer is_test_account,
-- is_frozen, is_bank — ikke ægte konkurrenter. AI-hold INKLUDERES (matcher
-- /standings, markeres diskret i UI), da global rank er en spejling af den
-- eksisterende ranglisteflade.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE). EJEREN MERGER — matview
-- populeres ved CREATE (ikke WITH NO DATA) → aktuel straks efter auto-migrate.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.global_rank_snapshot;
--   DROP MATERIALIZED VIEW IF EXISTS public.global_rank_mv;
--   -- + gendan refresh_ranking_matviews()-krop fra 2026-07-04-rankings-heartbeat.sql

-- ─── global_rank_snapshot: forrige refresh-cyklus' rang pr. hold ────────────────
CREATE TABLE IF NOT EXISTS public.global_rank_snapshot (
  team_id      UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  global_rank  INTEGER NOT NULL,
  global_score NUMERIC NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: offentlig rangliste-metadata (ingen PII, spejler season_standings' åbne
-- read-policy). RLS enabled + eksplicit public-read policy.
ALTER TABLE public.global_rank_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read global_rank_snapshot" ON public.global_rank_snapshot;
CREATE POLICY "Public read global_rank_snapshot" ON public.global_rank_snapshot FOR SELECT USING (true);
GRANT SELECT ON public.global_rank_snapshot TO anon, authenticated;

-- ─── global_rank_mv: pr. team_id, vægtet point-snit over de seneste 2 sæsoner ───
CREATE MATERIALIZED VIEW IF NOT EXISTS public.global_rank_mv AS
WITH recent_seasons AS (
  SELECT
    id AS season_id,
    number,
    ROW_NUMBER() OVER (ORDER BY number DESC) AS recency_rank
  FROM public.seasons
  WHERE status IN ('active', 'completed')
),
weighted AS (
  SELECT
    ss.team_id,
    rs.season_id,
    -- DIVISION_WEIGHT (konstant, mirror i globalRankFormula.js DIVISION_WEIGHTS)
    ss.total_points
      * (CASE ss.division WHEN 1 THEN 4 WHEN 2 THEN 3 WHEN 3 THEN 2 WHEN 4 THEN 1 ELSE 1 END)
      -- SEASON_WEIGHT (konstant, mirror i globalRankFormula.js SEASON_WEIGHTS)
      * (CASE rs.recency_rank WHEN 1 THEN 1.0 WHEN 2 THEN 0.5 ELSE 0 END)
      AS weighted_points
  FROM public.season_standings ss
  JOIN recent_seasons rs ON rs.season_id = ss.season_id
  WHERE rs.recency_rank <= 2
),
agg AS (
  SELECT
    team_id,
    SUM(weighted_points)        AS weighted_points_sum,
    COUNT(DISTINCT season_id)   AS seasons_played
  FROM weighted
  GROUP BY team_id
)
SELECT
  t.id                                                       AS team_id,
  t.name,
  t.division,
  t.is_ai,
  COALESCE(a.weighted_points_sum, 0)                         AS weighted_points_sum,
  COALESCE(a.seasons_played, 0)                              AS seasons_played,
  -- global_score = per-sæson-snit (nye managere måles ikke ned af anciennitet).
  CASE WHEN COALESCE(a.seasons_played, 0) > 0
    THEN ROUND(a.weighted_points_sum / a.seasons_played, 2)
    ELSE 0
  END                                                         AS global_score,
  RANK() OVER (
    ORDER BY (CASE WHEN COALESCE(a.seasons_played, 0) > 0
                THEN a.weighted_points_sum / a.seasons_played
                ELSE 0
              END) DESC
  )                                                           AS global_rank
FROM public.teams t
LEFT JOIN agg a ON a.team_id = t.id
WHERE t.is_test_account = false AND t.is_frozen = false AND t.is_bank = false;

CREATE UNIQUE INDEX IF NOT EXISTS global_rank_mv_pk    ON public.global_rank_mv (team_id);
CREATE INDEX        IF NOT EXISTS global_rank_mv_score ON public.global_rank_mv (global_score DESC);
GRANT SELECT ON public.global_rank_mv TO anon, authenticated;

-- ─── Udvid den eksisterende refresh-RPC med global rank + bevægelses-snapshot ───
-- Fuld krop gentaget (CREATE OR REPLACE erstatter definitionen fra rankings-
-- heartbeat-migrationen). Snapshot tages FØR REFRESH (kopierer de rækker der
-- lige NU findes i global_rank_mv — dvs. resultatet af FORRIGE refresh) så
-- UI'et kan vise bevægelse "siden sidst" = siden forrige refresh-cyklus.
CREATE OR REPLACE FUNCTION public.refresh_ranking_matviews()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Snapshot af global_rank_mv's NUVÆRENDE (pre-refresh) rækker → bevægelses-basis.
  INSERT INTO public.global_rank_snapshot (team_id, global_rank, global_score, captured_at)
  SELECT team_id, global_rank, global_score, now() FROM public.global_rank_mv
  ON CONFLICT (team_id) DO UPDATE SET
    global_rank  = EXCLUDED.global_rank,
    global_score = EXCLUDED.global_score,
    captured_at  = EXCLUDED.captured_at;

  REFRESH MATERIALIZED VIEW public.rider_rankings_mv;
  REFRESH MATERIALIZED VIEW public.team_standings_ext_mv;
  REFRESH MATERIALIZED VIEW public.team_race_points_mv;
  REFRESH MATERIALIZED VIEW public.global_rank_mv;

  INSERT INTO public.matview_refresh_heartbeat (matview_group, refreshed_at)
  VALUES ('ranking', now())
  ON CONFLICT (matview_group) DO UPDATE SET refreshed_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_ranking_matviews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_ranking_matviews() TO service_role;

-- pgrst schema-reload (billigt; matcher de tidligere ranking-migrationer).
NOTIFY pgrst, 'reload schema';
