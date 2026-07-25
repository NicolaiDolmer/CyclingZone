-- "Sådan gik det for dit hold" over tid: sæson-historik-RPC (#2886)
-- ============================================================================
--
-- BAGGRUND: Dashboard-modulet "How your team did" (#2466) viser kun holdets
-- SENESTE finaliserede løb. En spiller bad på Discord (#feedback-and-ideas,
-- 24/7) om at se flere løb end det seneste, med point og præmiepenge pr. løb.
-- Denne funktion leverer datagrundlaget: én række pr. løb holdet har kørt i
-- sæsonen (bedste placering, point, præmiepenge) PLUS sæson-akkumulerede
-- totaler beregnet over ALLE holdets løb (ikke kun de returnerede rækker).
--
-- HVORFOR EN RPC (ikke Node-aggregering): et etableret hold har 1.400-4.300
-- race_results-rækker i sæsonen. At hente dem alle via fetchAllRows' SEKVENTIELLE
-- side-for-side-paginering og gruppere pr. løb i Node er præcis det mønster der
-- gav ~8s "Consecutive HTTP" i Sentry for rider-ranking (#2692, CYCLINGZONE-36).
-- Aggregeringen hører hjemme i Postgres. Ingen OFFSET-paginering, ingen N+1 pr.
-- løb: ét kald, ét resultatsæt.
--
-- SEMANTIK (spejler backend/lib/myTeamLatestResult.js' summarizeTeamRace):
--   points/prize_money = SUM over ALLE holdets rækker i løbet (etaper, gc,
--     trøjer, holdklassement) — det er hvad løbet reelt indbragte, og det er
--     samme totaler som kortet allerede viser for det seneste løb.
--   best_rank = MIN(rank) over holdets RYTTER-rækker i klassement/etape
--     ('gc'/'stage'). Trøje-/holdklassement-rækker tælles ikke som "bedste
--     placering" — de er en anden konkurrence, og holdklassementet har slet
--     ingen rytter.
--   Løbspuljen = races.season_id + status='completed' + managerens egen
--     division (samme filter som /api/dashboard/my-latest-result og
--     /api/dashboard/recent-results, #2288 G). p_league_division_id = NULL →
--     alle divisioner (samme fallback som route-laget).
--   Rækkefølge = MAX(imported_at) DESC. date_text er en in-game-streng (ikke
--     kronologisk sorterbar), så import-batchens timestamp er recency-signalet
--     — samme konvention som pickLatestTeamRace().
--
-- PERF: verificeret read-only mod prod 2026-07-25 for tre ægte hold med
-- 1.400-1.478 resultatrækker (div 4/5/7, 44 gennemførte løb hver):
-- EXPLAIN (ANALYZE, BUFFERS) → Execution Time 8,8 ms, 1.040 shared buffer hits,
-- ingen seq scans. Planen bruger idx_races_season_pool (season_id,
-- league_division_id) + BitmapAnd(idx_race_results_team_id, idx_race_results).
-- INGEN nye indexes: et composite (team_id, race_id) ville kun spare BitmapAnd'en
-- (~ms-niveau) og koste write-amplification på en tabel der bulk-inserter ved
-- hver løbsfinalisering. Ikke en god byttehandel ved dette responstidsniveau.
--
-- SIKKERHED: route-laget kalder Supabase med SUPABASE_SERVICE_KEY (service_role).
-- GRANT gives derfor KUN til service_role. SECURITY DEFINER så funktionen kan
-- læse race_results/races uafhængigt af RLS; intern gate afviser alt der ikke er
-- service_role (defense-in-depth hvis grants nogensinde udvides). Uden gaten
-- ville en authenticated bruger kunne læse et VILKÅRLIGT holds sæsonøkonomi ved
-- at gætte p_team_id. SET search_path pinned (samme mønster som
-- dashboard_rider_ranking).
--
-- Idempotent (CREATE OR REPLACE + eksplicit REVOKE/GRANT).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.dashboard_my_team_season_races(uuid, uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.dashboard_my_team_season_races(
  p_team_id uuid,
  p_season_id uuid,
  p_league_division_id integer,
  p_limit integer
)
RETURNS TABLE (
  race_id            uuid,
  race_name          text,
  race_type          text,
  stages             integer,
  best_rank          integer,
  points             bigint,
  prize_money        bigint,
  last_import        timestamptz,
  season_points      bigint,
  season_prize_money bigint,
  season_races       bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- CTE-kolonnerne bærer r_-præfiks med vilje: plpgsql opløser ukvalificerede
  -- navne mod RETURNS TABLE's OUT-parametre først, så en CTE-kolonne ved navn
  -- "points" ville give "column reference is ambiguous" i totals-aggregatet.
  RETURN QUERY
  WITH per_race AS (
    SELECT
      rr.race_id AS r_race_id,
      MIN(rr.rank) FILTER (
        WHERE rr.rider_id IS NOT NULL
          AND rr.rank IS NOT NULL
          AND rr.result_type IN ('gc', 'stage')
      ) AS r_best_rank,
      SUM(COALESCE(rr.points_earned, 0))::bigint AS r_points,
      SUM(COALESCE(rr.prize_money, 0))::bigint   AS r_prize_money,
      MAX(rr.imported_at) AS r_last_import
    FROM public.race_results rr
    JOIN public.races ra
      ON ra.id = rr.race_id
     AND ra.season_id = p_season_id
     AND ra.status = 'completed'
     AND (p_league_division_id IS NULL OR ra.league_division_id = p_league_division_id)
    WHERE rr.team_id = p_team_id
    GROUP BY rr.race_id
  ),
  -- Sæson-totalerne beregnes over HELE per_race (før LIMIT), så "sæson til dato"
  -- forbliver sand uanset hvor mange løbsrækker klienten får udleveret.
  season_totals AS (
    SELECT
      COALESCE(SUM(pr2.r_points), 0)::bigint      AS t_points,
      COALESCE(SUM(pr2.r_prize_money), 0)::bigint AS t_prize_money,
      COUNT(*)::bigint                            AS t_races
    FROM per_race pr2
  )
  SELECT
    pr.r_race_id,
    ra.name,
    ra.race_type,
    ra.stages,
    pr.r_best_rank,
    pr.r_points,
    pr.r_prize_money,
    pr.r_last_import,
    st.t_points,
    st.t_prize_money,
    st.t_races
  FROM per_race pr
  JOIN public.races ra ON ra.id = pr.r_race_id
  CROSS JOIN season_totals st
  ORDER BY pr.r_last_import DESC NULLS LAST
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 20), 60), 1);
END;
$$;

-- Supabase' ALTER DEFAULT PRIVILEGES gen-granter EXECUTE til anon+authenticated
-- ved funktions-oprettelse, og `REVOKE ... FROM PUBLIC` fjerner IKKE de eksplicitte
-- role-grants (samme klasse som #2676/#2671/#2692). Revoke derfor eksplicit fra
-- anon + authenticated, ellers er den nye SECURITY DEFINER-funktion anon-EXECUTE-bar
-- (advisor 0028) trods den interne service_role-gate.
REVOKE ALL ON FUNCTION public.dashboard_my_team_season_races(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_my_team_season_races(uuid, uuid, integer, integer) TO service_role;

COMMENT ON FUNCTION public.dashboard_my_team_season_races(uuid, uuid, integer, integer) IS
  'Sæson-historik pr. løb (bedste placering, point, præmiepenge) + sæson-akkumulerede totaler for ét hold, til dashboard-modulet "How your team did" over tid (#2886). Totaler dækker HELE sæsonen, ikke kun de LIMIT-returnerede rækker. Gate: service_role (route kalder med SUPABASE_SERVICE_KEY).';

-- PostgREST schema-cache reload så RPC'en er kaldbar umiddelbart efter migrate.
NOTIFY pgrst, 'reload schema';
