-- Set-baseret sæson-standings-recompute (#2391). ERSTATTER den Node-side fuld-
-- re-derivation i backend/lib/economyEngine.js:updateStandings, som hentede HELE
-- sæsonens race_results (166k+ rækker sæson 1) over PostgREST — chunket + pagineret
-- (~166 round-trips) + en nested rider-join — og derefter aggregerede i JS. Det tog
-- 40-120 s pr. kald, og updateStandings kaldes efter HVER etape af HVERT løb i
-- stage-scheduleren → et enkelt tick med ~20 forfaldne etaper tog >35 min, hvorefter
-- overlap-guarden (#2090) sprang næste tick over og en voksende backlog forsinkede
-- etaper i timevis (Sentry CYCLINGZONE-24 stall-watchdog, #2389-analysen).
--
-- Rod-årsag: aggregeringen skete i applikationslaget ved at streame 166k rækker,
-- ikke i databasen. Den samme fulde aggregering kører på ~190 ms som ét set-baseret
-- Postgres-statement (EXPLAIN ANALYZE 12/7, hele sæson 1). updateStandings kalder nu
-- denne RPC og falder KUN tilbage til Node-stien hvis funktionen ikke findes endnu
-- (PGRST202 i vinduet mellem code-deploy og migration-apply — migrationer anvendes
-- separat af ejeren, #2081-policy).
--
-- SEMANTIK — beviseligt ækvivalent med Node-implementeringen (verificeret read-only
-- mod prod 12/7): total_points/stage_wins/gc_wins/races_completed = BIT-IDENTISK for
-- alle 368 hold (0 diff). rank_in_division = identisk fraset rækkefølgen INDEN FOR
-- lige-point-grupper (Node's tie-break var usorteret insertion-order → i praksis
-- ustabil pr. kald). Denne RPC tilføjer en DETERMINISTISK tie-break (team_id) så
-- ranks er STABILE på tværs af kald — en forbedring: eliminerer rank-flapping og
-- deraf spurious board_satisfaction_events. Alle 90 rank-forskelle var lige-point-
-- ties (0 ægte rangfejl).
--
-- Attribution matcher Node 1:1: coalesce(race_results.team_id, rytterens NUVÆRENDE
-- team_id) — sidstnævnte er rider-fallbacken (result.rider?.team_id). Kun hold der
-- findes i teams-tabellen upsertes (agg starter FROM teams) → lukker samtidig #2389's
-- FK-vindue (season_standings_team_id_fkey): læsning + upsert er nu ÉN transaktion,
-- så et hold slettet af AI-trim-sweepen kan ikke længere vælte upsert'et midt i.
--
-- penalty_points RØRES IKKE (ikke i INSERT/UPDATE-kolonnesættet) — bevares på
-- eksisterende rækker, defaulter til 0 for nye. Effektive point (total - penalty)
-- bruges KUN til rangering, præcis som Node (S-03 trupstørrelse-fradrag).
--
-- Gate: KUN service_role (backend'en kalder altid med service-nøglen; RPC'en er
-- ikke bruger-vendt). SECURITY DEFINER for at skrive season_standings uafhængigt af
-- RLS, med pinned search_path.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.recompute_season_standings(uuid);
--   (updateStandings falder automatisk tilbage til Node-stien når funktionen mangler.)

CREATE OR REPLACE FUNCTION public.recompute_season_standings(p_season_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- IS DISTINCT FROM er null-sikker: en null-rolle (fx en direkte superuser-session)
  -- afvises også. Backend'en kalder altid via service-nøglen → auth.role()='service_role'.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH attributed AS (
    -- coalesce(team_id, rytterens nuværende team) = Node's result.team_id || result.rider?.team_id
    SELECT coalesce(rr.team_id, ri.team_id) AS team_id,
           rr.race_id, rr.result_type, rr.rank, rr.points_earned
    FROM public.race_results rr
    JOIN public.races r ON r.id = rr.race_id AND r.season_id = p_season_id
    LEFT JOIN public.riders ri ON ri.id = rr.rider_id
  ),
  agg AS (
    -- FROM teams: hvert hold i tabellen får en række (også 0-point-hold), og kun
    -- levende hold upsertes — matcher Node's teamStats-init + #2389 live-filter.
    SELECT t.id AS team_id,
           coalesce(t.division, 3) AS division,
           t.league_division_id,
           coalesce(sum(a.points_earned), 0)::int AS total_points,
           count(*) FILTER (WHERE a.result_type = 'stage' AND a.rank = 1)::int AS stage_wins,
           count(*) FILTER (WHERE a.result_type = 'gc' AND a.rank = 1)::int AS gc_wins,
           count(DISTINCT a.race_id)::int AS races_completed
    FROM public.teams t
    LEFT JOIN attributed a ON a.team_id = t.id
    GROUP BY t.id, coalesce(t.division, 3), t.league_division_id
  ),
  ranked AS (
    SELECT agg.team_id, agg.division, agg.league_division_id,
           agg.total_points, agg.stage_wins, agg.gc_wins, agg.races_completed,
           row_number() OVER (
             -- Rang INDEN FOR puljen (#1608): pool:<league_division_id>, ellers
             -- tier:<division> for pre-pulje-hold (league_division_id NULL).
             PARTITION BY CASE WHEN agg.league_division_id IS NOT NULL
                               THEN 'pool:' || agg.league_division_id
                               ELSE 'tier:' || agg.division END
             -- Effektive point desc (total - penalty), deterministisk tie-break på team_id.
             ORDER BY (agg.total_points - coalesce(ss.penalty_points, 0)) DESC, agg.team_id ASC
           ) AS rank_in_division
    FROM agg
    LEFT JOIN public.season_standings ss
      ON ss.team_id = agg.team_id AND ss.season_id = p_season_id
  ),
  upserted AS (
    INSERT INTO public.season_standings AS tgt
      (season_id, team_id, division, league_division_id,
       total_points, stage_wins, gc_wins, races_completed, rank_in_division, updated_at)
    SELECT p_season_id, r.team_id, r.division, r.league_division_id,
           r.total_points, r.stage_wins, r.gc_wins, r.races_completed, r.rank_in_division, now()
    FROM ranked r
    ON CONFLICT (season_id, team_id) DO UPDATE SET
      division           = EXCLUDED.division,
      league_division_id = EXCLUDED.league_division_id,
      total_points       = EXCLUDED.total_points,
      stage_wins         = EXCLUDED.stage_wins,
      gc_wins            = EXCLUDED.gc_wins,
      races_completed    = EXCLUDED.races_completed,
      rank_in_division   = EXCLUDED.rank_in_division,
      updated_at         = EXCLUDED.updated_at
    -- penalty_points UDELADES bevidst → bevares (default 0 for nye rækker).
    RETURNING tgt.total_points
  )
  SELECT jsonb_build_object(
           'rows_updated', count(*),
           'teams_with_points', count(*) FILTER (WHERE total_points > 0)
         )
  INTO v_result
  FROM upserted;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_season_standings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_season_standings(uuid) TO service_role;

COMMENT ON FUNCTION public.recompute_season_standings(uuid) IS
  'Set-baseret sæson-standings-recompute (#2391) — erstatter Node-side 166k-row streaming i updateStandings (~190 ms vs 40-120 s). Beviseligt ækvivalent (points/wins bit-identisk; ranks stabile med deterministisk team_id tie-break). Gate: service_role. updateStandings falder tilbage til Node-stien hvis funktionen mangler.';
