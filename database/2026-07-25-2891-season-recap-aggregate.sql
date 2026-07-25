-- #2891 — Sæson-recappen læste HELE race_results til klienten.
--
-- PROBLEMET (målt mod prod 25/7):
--   SeasonEndPage.jsx:138-142 hentede alle rækker for sæsonens løb via
--   fetchAllRows() → OFFSET-paginering i sider à 1000. race_results har
--   459.347 rækker, dvs. 459 round-trips hvor hver side er dyrere end den
--   forrige (OFFSET skal scanne alt foran sig).
--     · side 1   =    12,7 ms
--     · side 451 = 3.662,0 ms   (288x værre)
--     · sum      = ~9,5 MINUTTERS databasetid pr. sidevisning
--   Dybeste observerede kald i pg_stat_statements: 7.154 ms mod et
--   statement_timeout på 8 s. Rammes loftet, kaster supabasePagination.js:20,
--   så HELE recappen fejler i stedet for at degradere.
--
--   Kritisk timing: seasonTransition.js emitSeasonEndedNotifications sender ved
--   sæson-slut en notifikation til alle menneske-managers, og
--   NotificationsPage.jsx:60 deep-linker season_ended → /seasons → denne side.
--   Ved cutover 27/7 rammer ~150 managers den samtidig, mens databasen også
--   kører finalization, payroll og op-/nedrykning. Koden har aldrig kørt i prod.
--
-- LØSNINGEN:
--   Klienten brugte de 459k rækker til præcis TRE aggregeringer:
--     1. kumulativ præmiesum pr. hold pr. løb  (pointudviklings-grafen)
--     2. præmie-leder                          (= sum af 1 pr. hold)
--     3. etapesejre pr. rytter                 (stage-king-kortet)
--   Ingen af dem har brug for rå rækker. Denne funktion laver aggregeringen
--   server-side og returnerer ~4.756 rækker i stedet for 459.347 (97x mindre).
--
--   Målt EXPLAIN (ANALYZE) mod prod, sæson 1:
--     · team_race_prize : 342 ms, 4.756 grupper
--     · stage_kings     : 168 ms
--     · i alt           : ~510 ms i ÉT kald (mod ~9,5 min i 459 kald)
--
--   FORMEN på team_race_prize er nested — { race_id: { team_id: prize } } — og
--   ikke en flad liste af objekter. To grunde:
--     1. Payload: 265.210 bytes mod 630.982 (58 % mindre). En flad liste ville
--        gentage nøglestrengene "race_id"/"team_id"/"prize" 4.756 gange og
--        dublere hvert race_id på tværs af holdene.
--     2. Klienten byggede alligevel præcis dette opslag selv for at slå prize op
--        pr. (løb, hold) — nu kommer det færdigt, så løkken forsvinder.
--   Løb uden resultater for menneskehold optræder slet ikke som nøgle (321 af
--   423 løb i sæson 1 har data); klienten falder tilbage til {} og tegner en
--   flad kurve for det løb, præcis som den gamle kode gjorde.
--
-- SEMANTIK BEVARET 1:1 med den JS den erstatter:
--   · team_race_prize summerer på riders.team_id (rytterens NUVÆRENDE hold),
--     præcis som `racePoints[r.rider.team_id]` gjorde. Ryttere uden hold
--     falder ud af joinet, som `if (r.rider?.team_id)` også gjorde.
--   · is_ai=false-filteret er en ren optimering: JS'en aggregerede alle hold,
--     men brugte kun menneskehold (prog[] initialiseres fra `standings`, som
--     allerede er filtreret, og prizeByTeam gates af humanTeamIds).
--   · stage_kings filtrerer BEVIDST IKKE på is_ai — den gamle kode gjorde det
--     heller ikke, så en AI-rytter kan stadig være stage-king. Ændres ikke her;
--     det ville være en gameplay-ændring forklædt som en perf-rettelse.
--
-- SECURITY INVOKER (default) er valgt bevidst: alle fem tabeller har simple
-- "Public read"-policies (verificeret i pg_policy 25/7), så funktionen kan køre
-- med kalderens egne rettigheder. Ingen ny SECURITY DEFINER-flade at forsvare
-- — jf. advisor 0028/0029 og #2858.
--
-- IDEMPOTENT: CREATE OR REPLACE + DROP ... IF EXISTS på grants.
-- Rollback: DROP FUNCTION public.get_season_recap(uuid);

CREATE OR REPLACE FUNCTION public.get_season_recap(p_season_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH team_race_prize AS (
    SELECT rr.race_id,
           ri.team_id,
           SUM(rr.prize_money)::bigint AS prize
    FROM race_results rr
    JOIN riders ri ON ri.id = rr.rider_id
    JOIN races  r  ON r.id  = rr.race_id
    JOIN teams  t  ON t.id  = ri.team_id
    WHERE r.season_id = p_season_id
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
$$;

COMMENT ON FUNCTION public.get_season_recap(uuid) IS
  '#2891 · Server-side aggregering til sæson-recappen. Erstatter en klient-side '
  'fetchAllRows over hele race_results (459k rækker / ~9,5 min DB-tid pr. visning) '
  'med ét kald på ~510 ms. Returnerer team_race_prize som { race_id: { team_id: prize } } '
  '(kun menneskehold) og stage_kings (top 5 etapesejre, bevidst uden is_ai-filter).';

-- Kun læse-rollerne behøver den; service_role arver via superuser-lignende grants.
REVOKE ALL ON FUNCTION public.get_season_recap(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_season_recap(uuid) TO anon, authenticated, service_role;

-- =============================================================================
-- Post-verify (kør manuelt efter apply)
-- =============================================================================
--
-- 1) Funktionen findes og er SECURITY INVOKER (prosecdef = false):
--    SELECT proname, prosecdef, provolatile
--    FROM pg_proc WHERE proname = 'get_season_recap';
--    → forventet: get_season_recap | false | s
--
-- 2) Returnerer data for sæson 1 (jsonb med to nøgler):
--    SELECT jsonb_object_keys(public.get_season_recap(
--      (SELECT id FROM seasons WHERE number = 1)));
--    → forventet: team_race_prize, stage_kings
--
-- 3) Paritet mod den gamle JS-aggregering — samlet præmiesum skal være identisk
--    med SUM(prize_money) over menneskehold. Kørt mod prod 25/7 FØR apply
--    (samme SQL ad hoc): begge sider gav 19.344.450.
--    WITH j AS (SELECT public.get_season_recap(
--                 (SELECT id FROM seasons WHERE number=1)) AS v)
--    SELECT
--      (SELECT SUM(kv.value::bigint)
--         FROM j, jsonb_each(j.v->'team_race_prize') e,
--              LATERAL jsonb_each_text(e.value) kv) AS via_rpc,
--      (SELECT SUM(rr.prize_money)::bigint
--       FROM race_results rr
--       JOIN riders ri ON ri.id = rr.rider_id
--       JOIN races r ON r.id = rr.race_id
--       JOIN teams t ON t.id = ri.team_id
--       WHERE r.season_id = (SELECT id FROM seasons WHERE number=1)
--         AND t.is_ai = false) AS via_raw;
--    → forventet: de to tal er ens (19.344.450 for sæson 1)
