-- =============================================================================
-- 2026-09-25 — #5535 (spor S1): senior-resultat-aggregaterne tæller kun seniorløb
-- =============================================================================
-- Applies af auto-migrate.yml ved merge (#2642). Claude post-verificerer
-- (kommandoer nederst). EJER-PORT: filen kører DDL mod prod (DROP + CREATE af
-- tre matviews), så PR'en merges kun på ejer-go og uden for løbsafvikling.
--
-- ── PROBLEMET ───────────────────────────────────────────────────────────────
-- A2 (#5517) gav `races` kolonnen `squad` ('senior' | 'u23' | 'junior'). Men
-- alle senior-aggregaterne summerer stadig `race_results` for HELE sæsonen uden
-- at kende truppen. Det første afgjorte U23-/juniorløb ville derfor lægge
-- ungdomspoint ind i seniorstillingen og videre i op/nedrykning,
-- divisionsbonus, bestyrelse, sponsorbase, Global Rank og senior-
-- rytterranglisten (plan §1.4 + §6 risiko 2).
--
-- ── LØSNINGEN ───────────────────────────────────────────────────────────────
-- Ét prædikat `squad = 'senior'` på `races`-joinet i:
--   Funktioner (CREATE OR REPLACE — ACL og ejer bevares af Postgres):
--     recompute_season_standings, dashboard_rider_ranking,
--     dashboard_my_team_season_races, get_season_recap,
--     get_season_documentary_facts
--   Matviews (DROP + CREATE — et matview-query kan ikke ændres in place):
--     rider_rankings_mv, team_standings_ext_mv, team_race_points_mv
--
-- Udgangspunktet for hver funktionskrop er PRODS `pg_get_functiondef` (hentet
-- read-only 24/9), IKKE repo-filerne: flere af dem er ændret siden deres
-- oprindelige migration. Hver tilføjet linje er mærket `#5535`; fjernes de
-- linjer, er kroppen byte-identisk med prods (md5 af prosrc, målt 24/9).
-- Matview-definitionerne er prods `pg_matviews.definition` + filteret, med
-- samme kolonner i samme rækkefølge og samme to/én indekser pr. view. De
-- unikke indekser er bevaret, så `REFRESH ... CONCURRENTLY` stadig er muligt.
--
-- BEVIDST URØRT: `get_rider_race_days` — en løbsdag er en løbsdag uanset trup
-- (bruges til træthed/løbsdage, ikke til point). `global_rank_mv` læser
-- `season_standings`, som bliver senior-ren via recompute_season_standings.
--
-- ── BIT-IDENTISK I DAG ──────────────────────────────────────────────────────
-- Alle løb i prod er 'senior' (kolonnen er NOT NULL DEFAULT 'senior' med en
-- CHECK på de tre trupper), så prædikatet er sandt for hver eneste række.
-- Read-only EXCEPT-tjek mod prod (ny definition EXCEPT gammel og omvendt,
-- for alle tre matviews) er noteret i PR-bodyen.
--
-- ── ANALYZE public.races ────────────────────────────────────────────────────
-- A2 tilføjede `races.squad` med en fast default, som ikke omskriver rækker,
-- så autovacuum har aldrig analyseret kolonnen (pg_stats havde 0 rækker for
-- races.squad 24/9). Uden statistik gætter planneren at `squad = 'senior'`
-- rammer en brøkdel af løbene og vælger nested loop over race_results: målt
-- read-only i prod 24/9 til ca. 6 gange langsommere end dagens hash join for
-- rider_rankings_mv-queryet. ANALYZE retter estimatet, før de tre views
-- bygges. Det tager en SHARE UPDATE EXCLUSIVE-lås, som ikke blokerer læsere
-- eller skrivere, og kan køre i en transaktion.
--
-- ── LÅSE ────────────────────────────────────────────────────────────────────
-- DROP MATERIALIZED VIEW tager ACCESS EXCLUSIVE til COMMIT. Matviews bygges
-- derfor SIDST i transaktionen, så låsevinduet kun er selve byggetiden.
-- `lock_timeout` gør at migrationen fejler hurtigt (og ruller HELT tilbage)
-- i stedet for at stå i kø bag en igangværende refresh og samtidig blokere
-- alle læsere bag sig. Fejler den på låsen: kør auto-migrate igen.
--
-- ── GRANTS (#5088/#5176) ────────────────────────────────────────────────────
-- DROP + CREATE giver Supabase' default privileges igen (anon/authenticated
-- får SELECT). REVOKE ALL gentages derfor eksplicit, og service_role får
-- SELECT re-asserteret (backend/routes/rankings.ts læser med service_role).
-- De tre SECURITY DEFINER-funktioner får samme REVOKE/GRANT som i dag
-- (kun service_role), så en gen-kørsel på en frisk database også er lukket.
-- get_season_recap og get_season_documentary_facts er SECURITY INVOKER og får
-- ingen GRANT/REVOKE her: CREATE OR REPLACE bevarer deres nuværende ACL.
--
-- ── IDEMPOTENS ─────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION, DROP ... IF EXISTS + CREATE, CREATE INDEX IF NOT
-- EXISTS, REVOKE/GRANT og ANALYZE er alle sikre at køre igen. Alt ligger i ÉN
-- transaktion: fejler et trin, står prod præcis som før.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Kør de samme statements uden linjerne mærket `#5535` (funktionerne) og uden
-- `AND ra.squad = 'senior'` (matviews), efterfulgt af samme REVOKE/GRANT.

BEGIN;

SET LOCAL lock_timeout = '10s';

ANALYZE public.races;

-- ── 1. recompute_season_standings ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_season_standings(p_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH attributed AS (
    SELECT coalesce(rr.team_id, ri.team_id) AS team_id,
           rr.race_id, rr.result_type, rr.rank, rr.points_earned
    FROM public.race_results rr
    JOIN public.races r ON r.id = rr.race_id AND r.season_id = p_season_id
                       AND r.squad = 'senior'  -- #5535: kun seniorløb i seniorstillingen
    LEFT JOIN public.riders ri ON ri.id = rr.rider_id
  ),
  agg AS (
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
             PARTITION BY CASE WHEN agg.league_division_id IS NOT NULL
                               THEN 'pool:' || agg.league_division_id
                               ELSE 'tier:' || agg.division END
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
$function$;

REVOKE ALL ON FUNCTION public.recompute_season_standings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_season_standings(uuid) TO service_role;

-- ── 2. dashboard_rider_ranking ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dashboard_rider_ranking(p_season_id uuid, p_league_division_id integer)
 RETURNS TABLE(rider_id uuid, firstname text, lastname text, nationality_code text, team_name text, is_ai boolean, points bigint, stage_wins bigint, gc_wins bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ri.id,
    ri.firstname,
    ri.lastname,
    ri.nationality_code,
    te.name,
    COALESCE(te.is_ai, false),
    SUM(COALESCE(rr.points_earned, 0))::bigint,
    COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'stage'),
    COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'gc')
  FROM public.race_results rr
  JOIN public.races ra
    ON ra.id = rr.race_id
   AND ra.season_id = p_season_id
   AND ra.squad = 'senior'  -- #5535: kun seniorløb i dashboardets rytterrangliste
   AND (p_league_division_id IS NULL OR ra.league_division_id = p_league_division_id)
  JOIN public.riders ri
    ON ri.id = rr.rider_id
   AND ri.is_retired IS NOT TRUE
  LEFT JOIN public.teams te
    ON te.id = ri.team_id
  WHERE rr.rider_id IS NOT NULL
  GROUP BY ri.id, ri.firstname, ri.lastname, ri.nationality_code, te.name, te.is_ai
  ORDER BY SUM(COALESCE(rr.points_earned, 0)) DESC, MIN(rr.id::text) ASC
  LIMIT 5;
END;
$function$;

REVOKE ALL ON FUNCTION public.dashboard_rider_ranking(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_rider_ranking(uuid, integer) TO service_role;

-- ── 3. dashboard_my_team_season_races ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dashboard_my_team_season_races(p_team_id uuid, p_season_id uuid, p_league_division_id integer, p_limit integer)
 RETURNS TABLE(race_id uuid, race_name text, race_type text, stages integer, best_rank integer, points bigint, prize_money bigint, last_import timestamp with time zone, season_points bigint, season_prize_money bigint, season_races bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

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
     AND ra.squad = 'senior'  -- #5535: kun seniorløb i dashboardets sæsonløb og -totaler
     AND (p_league_division_id IS NULL OR ra.league_division_id = p_league_division_id)
    WHERE rr.team_id = p_team_id
    GROUP BY rr.race_id
  ),
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
$function$;

REVOKE ALL ON FUNCTION public.dashboard_my_team_season_races(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_my_team_season_races(uuid, uuid, integer, integer) TO service_role;

-- ── 4. get_season_recap (SECURITY INVOKER — ACL bevares af CREATE OR REPLACE) ─
CREATE OR REPLACE FUNCTION public.get_season_recap(p_season_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH team_race_prize AS (
    SELECT rr.race_id,
           ri.team_id,
           SUM(rr.prize_money)::bigint AS prize
    FROM race_results rr
    JOIN riders ri ON ri.id = rr.rider_id
    JOIN races  r  ON r.id  = rr.race_id
    JOIN teams  t  ON t.id  = ri.team_id
    WHERE r.season_id = p_season_id
      AND r.squad = 'senior'  -- #5535: kun seniorløb i sæson-recap
      AND t.is_ai = false
    GROUP BY rr.race_id, ri.team_id
  ),
  stage_kings AS (
    SELECT rr.rider_id,
           ri.firstname,
           ri.lastname,
           COUNT(*)::int AS wins
    FROM race_results rr
    JOIN races  r  ON r.id  = rr.race_id
    JOIN riders ri ON ri.id = rr.rider_id
    WHERE r.season_id = p_season_id
      AND r.squad = 'senior'  -- #5535: kun seniorløb i sæson-recap
      AND rr.result_type = 'stage'
      AND rr.rank = 1
    GROUP BY rr.rider_id, ri.firstname, ri.lastname
    ORDER BY wins DESC, ri.lastname ASC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'team_race_prize', COALESCE((
      SELECT jsonb_object_agg(race_id::text, per_team)
      FROM (
        SELECT race_id, jsonb_object_agg(team_id::text, prize) AS per_team
        FROM team_race_prize
        GROUP BY race_id
      ) grouped
    ), '{}'::jsonb),
    'stage_kings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rider_id', rider_id, 'firstname', firstname,
        'lastname', lastname, 'wins', wins
      )) FROM stage_kings
    ), '[]'::jsonb)
  );
$function$;

-- ── 5. get_season_documentary_facts (SECURITY INVOKER — ACL bevares) ────────
CREATE OR REPLACE FUNCTION public.get_season_documentary_facts(p_season_id uuid, p_team_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH my_signings AS (
    SELECT ft.amount, ft.metadata, ft.related_entity_type, ft.created_at
    FROM finance_transactions ft
    WHERE ft.season_id = p_season_id
      AND ft.team_id = p_team_id
      AND ft.type = 'transfer_out'
      AND ft.related_entity_type IN ('auction', 'transfer')
    ORDER BY ft.amount ASC  -- mest negative først = størst spend
    LIMIT 3
  ),
  team_results AS (
    SELECT rr.*, r.name AS race_name, r.race_class, r.race_type
    FROM race_results rr
    JOIN races r ON r.id = rr.race_id
    WHERE r.season_id = p_season_id
      AND r.squad = 'senior'  -- #5535: kun seniorløb i sæson-krøniken
      AND rr.team_id = p_team_id
      AND rr.result_type IN ('stage', 'gc', 'points', 'mountain', 'young', 'team')
      AND rr.rank IS NOT NULL
  ),
  scored AS (
    SELECT *,
      (CASE result_type
        WHEN 'gc' THEN 500 WHEN 'points' THEN 300 WHEN 'mountain' THEN 300
        WHEN 'young' THEN 300 WHEN 'team' THEN 150 WHEN 'stage' THEN 200
        ELSE 0 END)
      + (CASE WHEN rank = 1 THEN 1000 ELSE GREATEST(0, 50 - rank) END)
      + COALESCE(points_earned, 0) AS score
    FROM team_results
  ),
  biggest_result AS (
    SELECT * FROM scored ORDER BY score DESC, race_name ASC LIMIT 1
  ),
  race_day_totals AS (
    SELECT race_id, race_name,
           SUM(points_earned)::bigint AS total_points,
           COUNT(DISTINCT rider_id)::int AS riders_scoring
    FROM team_results
    GROUP BY race_id, race_name
  ),
  best_race_day AS (
    SELECT * FROM race_day_totals ORDER BY total_points DESC, race_name ASC LIMIT 1
  ),
  my_standing AS (
    SELECT * FROM season_standings
    WHERE season_id = p_season_id AND team_id = p_team_id
  ),
  rival AS (
    SELECT ss.team_id, t.name AS team_name, ss.total_points, ss.rank_in_division,
           ABS(ss.total_points - (SELECT total_points FROM my_standing)) AS gap
    FROM season_standings ss
    JOIN teams t ON t.id = ss.team_id
    WHERE ss.season_id = p_season_id
      AND ss.division = (SELECT division FROM my_standing)
      AND ss.team_id <> p_team_id
      AND t.is_ai = false
      AND t.is_bank IS NOT TRUE
      AND t.is_test_account IS NOT TRUE
    ORDER BY gap ASC, ss.rank_in_division ASC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'signings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'amount', ABS(amount),
        'riderName', metadata -> 'params' ->> 'riderName',
        'source', related_entity_type
      ) ORDER BY amount ASC)  -- #3402: eksplicit ORDER BY i aggregatet — jsonb_agg
                               -- garanterer IKKE CTE-scan-rækkefølge uden den (samme
                               -- læring som get_season_honours' egne jsonb_agg-kald).
      FROM my_signings
    ), '[]'::jsonb),
    'biggestResult', (SELECT to_jsonb(biggest_result) FROM biggest_result),
    'bestRaceDay', (SELECT to_jsonb(best_race_day) FROM best_race_day),
    'rival', (SELECT to_jsonb(rival) FROM rival),
    'myStanding', (SELECT to_jsonb(my_standing) FROM my_standing)
  );
$function$;

-- ── 6. Matviews: DROP + CREATE med senior-filteret (bygges sidst: kort låsevindue) ─
-- pg_depend i prod (read-only 24/9): ingen views, matviews eller andre
-- relationer afhænger af de tre views — kun deres egne indekser, rewrite-
-- regel og rækketype. Funktionerne der læser dem (refresh_*-RPC'erne og
-- get_season_honours) binder på navn ved kørsel og overlever DROP + CREATE.
DROP MATERIALIZED VIEW IF EXISTS public.rider_rankings_mv;
DROP MATERIALIZED VIEW IF EXISTS public.team_standings_ext_mv;
DROP MATERIALIZED VIEW IF EXISTS public.team_race_points_mv;

CREATE MATERIALIZED VIEW public.rider_rankings_mv AS
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
  AND ra.squad = 'senior'
GROUP BY ra.season_id, rr.rider_id;

CREATE UNIQUE INDEX IF NOT EXISTS rider_rankings_mv_pk     ON public.rider_rankings_mv (season_id, rider_id);
CREATE INDEX        IF NOT EXISTS rider_rankings_mv_season ON public.rider_rankings_mv (season_id, points DESC);

CREATE MATERIALIZED VIEW public.team_standings_ext_mv AS
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
  AND ra.squad = 'senior'
GROUP BY ra.season_id, COALESCE(rr.team_id, ri.team_id);

CREATE UNIQUE INDEX IF NOT EXISTS team_standings_ext_mv_pk ON public.team_standings_ext_mv (season_id, team_id);

CREATE MATERIALIZED VIEW public.team_race_points_mv AS
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
  AND ra.squad = 'senior'
GROUP BY ra.season_id, ri.team_id, rr.race_id, ra.name;

CREATE UNIQUE INDEX IF NOT EXISTS team_race_points_mv_pk     ON public.team_race_points_mv (season_id, team_id, race_id);
CREATE INDEX        IF NOT EXISTS team_race_points_mv_season ON public.team_race_points_mv (season_id, team_id);

-- #5088/#5176: DROP + CREATE gav default privileges igen — luk dem eksplicit.
REVOKE ALL ON TABLE
  public.rider_rankings_mv,
  public.team_standings_ext_mv,
  public.team_race_points_mv
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.rider_rankings_mv,
  public.team_standings_ext_mv,
  public.team_race_points_mv
TO service_role;

COMMIT;

-- ── Post-merge verifikation (read-only, køres af Claude efter auto-migrate) ──
-- V1. Filteret står i alle otte objekter (forvent 8 rækker, alle true):
--   SELECT p.proname AS obj, p.prosrc ~ 'squad = ''senior''' AS filtered
--   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--     AND p.proname IN ('recompute_season_standings', 'dashboard_rider_ranking',
--       'dashboard_my_team_season_races', 'get_season_recap',
--       'get_season_documentary_facts')
--   UNION ALL
--   SELECT matviewname, definition ~ 'squad = ''senior''' FROM pg_matviews
--   WHERE schemaname = 'public' AND matviewname IN ('rider_rankings_mv',
--     'team_standings_ext_mv', 'team_race_points_mv');
--
-- V2. Grants på matviews (forvent INGEN 'anon=' og INGEN 'authenticated='):
--   SELECT c.relname, array_to_string(c.relacl, '|') AS acl FROM pg_class c
--   WHERE c.relkind = 'm' AND c.relnamespace = 'public'::regnamespace
--   ORDER BY c.relname;
--
-- V3. Funktions-ACL uændret: de tre SECURITY DEFINER-funktioner kun
--     postgres + service_role; recap/documentary som før merge.
--
-- V4. Indekser (forvent 5: rider_rankings_mv_pk, rider_rankings_mv_season,
--     team_standings_ext_mv_pk, team_race_points_mv_pk,
--     team_race_points_mv_season; de tre *_pk UNIQUE):
--   SELECT indexrelid::regclass, indisunique FROM pg_index
--   WHERE indrelid IN ('public.rider_rankings_mv'::regclass,
--     'public.team_standings_ext_mv'::regclass,
--     'public.team_race_points_mv'::regclass);
--
-- V5. De fire refresh-RPC'er kører: refresh_ranking_matviews(),
--     refresh_rider_rankings_mv(), refresh_team_standings_ext_mv(),
--     refresh_team_race_points_mv() (som service_role / via backend-cron).
--
-- V6. Rækkeantal pr. view er det samme som før merge (alle løb er senior).
--
-- V7. get_advisors(type: 'security'): 0016 = 0. De dokumenterede 0029-fund
--     i docs/SUPABASE_SECURITY_ADVISORS.md er uændrede; rapportér aldrig "0 WARN".
