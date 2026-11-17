-- =============================================================================
-- 2026-11-17 · #8361: sæson-dokumentarens rival vælges i holdets egen pulje
-- =============================================================================
-- Applies af auto-migrate.yml ved merge (#2642). Claude post-verificerer
-- (kommandoer nederst). Kun CREATE OR REPLACE af én SECURITY INVOKER-funktion:
-- ingen data ændres, ingen gemte dokumentarer omskrives.
--
-- ── PROBLEMET ───────────────────────────────────────────────────────────────
-- `rival`-CTE'en filtrerede på `division`, ikke på pulje (`league_division_id`).
-- En division har flere puljer, og hver pulje har sin egen stilling
-- (`rank_in_division` er rangen i puljen). Rivalen kunne derfor være et hold fra
-- en anden pulje, og teksten påstod en tæt kamp, spilleren aldrig har set.
-- Hold uden pulje (league_division_id NULL) fik også en rival på tværs.
--
-- ── LØSNINGEN ───────────────────────────────────────────────────────────────
-- Rivalen er kun en reel nabo: samme sæson, samme pulje, og rangen lige over
-- eller under holdet. Er naboen et AI-, bank- eller testhold, eller har holdet
-- ingen pulje, findes der ingen rival, og grammatikken udelader sætningen
-- (backend/lib/seasonDocumentaryGrammar.js tjekker det samme igen, så facts fra
-- før denne migration heller ikke giver en forkert sætning).
-- Rivalen får `league_division_id` og `penalty_points` med i outputtet, så
-- grammatikken kan kontrollere puljen og regne afstanden som stillingen gør
-- (point minus strafpoint, samme rangering som recompute_season_standings).
--
-- Udgangspunktet er PRODS `pg_get_functiondef` (hentet read-only 17/11; md5 af
-- prosrc var lig repoets 2026-09-25-5535-version). Kun `rival`-CTE'en er ændret;
-- hver ændret linje er mærket `#8361`.
--
-- ── IDEMPOTENS ─────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION er sikker at køre igen og bevarer ACL og ejer.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Kør funktionen fra 2026-09-25-5535-senior-only-result-aggregates.sql (afsnit 5).

BEGIN;

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
           ss.league_division_id, ss.penalty_points,  -- #8361: pulje og strafpoint med i outputtet
           ABS((ss.total_points - COALESCE(ss.penalty_points, 0)) - (SELECT total_points - COALESCE(penalty_points, 0) FROM my_standing)) AS gap  -- #8361: afstand som i stillingen (efter strafpoint)
    FROM season_standings ss
    JOIN teams t ON t.id = ss.team_id
    WHERE ss.season_id = p_season_id
      AND ss.league_division_id = (SELECT league_division_id FROM my_standing)  -- #8361: samme pulje, ikke kun division
      AND ABS(ss.rank_in_division - (SELECT rank_in_division FROM my_standing)) = 1  -- #8361: reel nabo i stillingen
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

COMMIT;

-- ── Post-merge verifikation (read-only, køres af Claude efter auto-migrate) ──
-- V1. Ny krop er i prod (forvent true, true):
--   SELECT prosrc ~ 'league_division_id = \(SELECT league_division_id FROM my_standing\)',
--          prosrc ~ 'squad = ''senior'''
--   FROM pg_proc WHERE proname = 'get_season_documentary_facts'
--     AND pronamespace = 'public'::regnamespace;
-- V2. Ingen rival på tværs af puljer for indeværende sæson (forvent 0):
--   SELECT count(*) FROM season_standings me
--   CROSS JOIN LATERAL (SELECT public.get_season_documentary_facts(me.season_id, me.team_id) -> 'rival' AS r) x
--   JOIN season_standings rv ON rv.season_id = me.season_id AND rv.team_id = (x.r ->> 'team_id')::uuid
--   WHERE me.season_id = (SELECT id FROM seasons WHERE status = 'active')
--     AND (rv.league_division_id IS DISTINCT FROM me.league_division_id
--          OR abs(rv.rank_in_division - me.rank_in_division) <> 1);
