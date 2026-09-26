-- #5390 — Sæson-slut-overblikket viser etapesejre og samlede sejre, men ingen
-- klassikersejre (endagsløb; monumenter er en delmængde af klassikere, ikke
-- omvendt). En spiller efterlyste det 18/9 i den danske Discord-kanal.
--
-- BYGGER PÅ #5535 (2026-09-25-5535-senior-only-result-aggregates.sql), den
-- nuværende prod-krop af get_season_recap: samme `r.squad = 'senior'`-filter
-- som team_race_prize/stage_kings allerede bruger, af samme grund — et
-- ungdomsløbs endagssejr skal ikke tælle med i et menneskeholds sæson-recap.
--
-- HVAD DENNE MIGRATION TILFØJER (tre nye nøgler i den returnerede jsonb):
--   1. classic_kings — TOP 5 ryttere efter antal klassikersejre denne sæson,
--      nøjagtig samme facon som stage_kings (rider_id/firstname/lastname/wins,
--      sorteret faldende på wins, alfabetisk på efternavn ved lighed). Bruges
--      til sæsonens "Classic wins"-rytterkort (samme sted etapesejre allerede
--      vises i winners-rækken).
--   2. team_classic_wins — { team_id: antal } for menneskehold, samme facon
--      og samme is_ai=false-filter som team_race_prize allerede bruger til at
--      finde MIT holds tal til recap-heroens statistik-række.
--   3. team_classic_king — { team_id: {rider_id,firstname,lastname,wins} } for
--      menneskehold: HVILKEN rytter der stod for holdets klassikersejre denne
--      sæson. Beregnes SERVER-SIDE med samme hold-tilskrivning som
--      team_classic_wins (se punkt "SAMME TILSKRIVNING" nedenfor) — klienten
--      matcher IKKE selv en rytter til et hold via riders.team_id (se
--      CodeRabbit-fund, 26/9: det ville vise "3 sejre" på et hold rytteren er
--      solgt TIL, mens team_classic_wins (retmæssigt) viser 0 for det hold).
--
-- HVAD ER EN "KLASSIKERSEJR"? Et endagsløb (race_type <> 'stage_race', i
-- praksis 'single') vundet af rytteren med rank 1. Motoren skriver ALDRIG en
-- 'stage'-række for et endagsløb — kun 'gc' på stage_number 1, jf.
-- frontend/src/lib/raceWinnerResultType.ts (#5601), som allerede dokumenterer
-- nøjagtig denne regel (751 rank-1 'gc'-rækker / 0 'stage'-rækker for
-- endagsløb, målt i prod 24/9). Filteret her (r.race_type <> 'stage_race' AND
-- rr.result_type = 'gc' AND rr.rank = 1) er derfor IKKE en ny antagelse — det
-- er samme kilde-sandhed som allerede styrer dashboardets "Today's stages" og
-- Race Centre, genbrugt her i SQL i stedet for at duplikere en tredje variant.
-- "GC" for et ETAPELØB (samlet klassement) er bevidst UDELUKKET af
-- `r.race_type <> 'stage_race'` — det er løbets sammenlagte vinder, ikke en
-- klassikersejr.
--
-- SEMANTIK, SAMME MØNSTER SOM STAGE_KINGS/TEAM_RACE_PRIZE (#2891/#5535):
--   · classic_kings filtrerer BEVIDST IKKE på is_ai — en AI-rytter kan godt
--     være sæsonens klassiker-konge, præcis som med stage_kings.
--   · team_classic_wins filtrerer PÅ is_ai=false — samme begrundelse som
--     team_race_prize: kun menneskehold har brug for tallet på deres egen
--     recap-række.
--   · SAMME TILSKRIVNING: team_classic_wins OG team_classic_king bruger begge
--     COALESCE(rr.team_id, ri.team_id) — PRÆCIS samme hold-tilskrivning som
--     recompute_season_standings bruger til stage_wins/gc_wins (#5535, linje
--     ~451): resultattidspunktets hold, med fallback til rytterens nuværende
--     hold for de (få, historiske) rækker uden eget team_id. Dette AFVIGER
--     bevidst fra team_race_prize, som joiner alene via riders.team_id (og
--     derfor flytter prisen til rytterens nuværende hold ved et sæson-midt-
--     salg) — men de to klassiker-nøgler sidder ved siden af
--     season_standings.stage_wins i UI'en (samme recap-række/highlight), så de
--     SKAL tilskrives hold på nøjagtig samme måde. De to nøgler er DERFOR
--     også indbyrdes konsistente: team_classic_king peger ALDRIG på et hold
--     hvis team_classic_wins er 0/mangler for det hold (begge er afledt af
--     samme classic_wins-CTE, samme team_id-udtryk).
--
-- VISES KUN NÅR TALLET ER > 0 (TASTE P11, docs/design/TASTE.md): klienten
-- (SeasonEndPage.jsx/SeasonRecapHero.jsx) skjuler både rytterkortet og
-- recap-heroens statistik-felt når der ikke er en klassikersejr at vise, i
-- stedet for at vise et "0". Denne migration ændrer ikke på det — den leverer
-- blot tallet.
--
-- IDEMPOTENT: CREATE OR REPLACE. Ingen nye grants — CREATE OR REPLACE bevarer
-- funktionens nuværende ACL (samme begrundelse som #5535: SECURITY INVOKER,
-- ingen ny GRANT/REVOKE nødvendig).
-- Rollback: kør #5535's CREATE OR REPLACE FUNCTION public.get_season_recap
-- igen (fjerner classic_kings/team_classic_wins, resten uændret).

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
  ),
  classic_wins AS (
    -- #5390: endagsløb (aldrig 'stage_race') vundet af rank 1. Motoren skriver
    -- kun 'gc' på stage_number 1 for endagsløb, aldrig 'stage' — se
    -- frontend/src/lib/raceWinnerResultType.ts (#5601) for kilde-reglen.
    -- team_id er COALESCE(rr.team_id, ri.team_id) — samme hold-tilskrivning
    -- som recompute_season_standings' stage_wins/gc_wins (#5535).
    SELECT rr.rider_id,
           COALESCE(rr.team_id, ri.team_id) AS team_id,
           ri.firstname,
           ri.lastname
    FROM race_results rr
    JOIN races  r  ON r.id  = rr.race_id
    JOIN riders ri ON ri.id = rr.rider_id
    WHERE r.season_id = p_season_id
      AND r.squad = 'senior'
      AND r.race_type <> 'stage_race'
      AND rr.result_type = 'gc'
      AND rr.rank = 1
  ),
  classic_kings AS (
    SELECT rider_id, firstname, lastname, COUNT(*)::int AS wins
    FROM classic_wins
    GROUP BY rider_id, firstname, lastname
    ORDER BY wins DESC, lastname ASC
    LIMIT 5
  ),
  team_rider_classic_wins AS (
    -- Pr. (hold, rytter): hvor mange klassikersejre stod DEN rytter for på
    -- DET hold. Grundlaget for både team_classic_wins (sum pr. hold) og
    -- team_classic_king (holdets EGEN bedste rytter) herunder.
    SELECT cw.team_id, cw.rider_id, cw.firstname, cw.lastname, COUNT(*)::int AS wins
    FROM classic_wins cw
    GROUP BY cw.team_id, cw.rider_id, cw.firstname, cw.lastname
  ),
  team_classic_wins AS (
    SELECT trcw.team_id, SUM(trcw.wins)::int AS wins
    FROM team_rider_classic_wins trcw
    JOIN teams t ON t.id = trcw.team_id
    WHERE t.is_ai = false
    GROUP BY trcw.team_id
  ),
  team_classic_king AS (
    -- #5390 (CodeRabbit-fund 26/9): holdets EGEN bedste klassiker-vinder,
    -- attribueret PRÆCIS som team_classic_wins ovenfor (rr.team_id, ikke
    -- rytterens nuværende team_id) — DISTINCT ON garanterer nøjagtig ét hold
    -- pr. team_id, med samme wins-DESC/lastname-ASC-tiebreak som stage_kings/
    -- classic_kings.
    SELECT DISTINCT ON (trcw.team_id)
           trcw.team_id, trcw.rider_id, trcw.firstname, trcw.lastname, trcw.wins
    FROM team_rider_classic_wins trcw
    JOIN teams t ON t.id = trcw.team_id
    WHERE t.is_ai = false
    ORDER BY trcw.team_id, trcw.wins DESC, trcw.lastname ASC
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
      ) ORDER BY wins DESC, lastname ASC) FROM stage_kings
    ), '[]'::jsonb),
    'classic_kings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rider_id', rider_id, 'firstname', firstname,
        'lastname', lastname, 'wins', wins
      ) ORDER BY wins DESC, lastname ASC) FROM classic_kings
    ), '[]'::jsonb),
    'team_classic_wins', COALESCE((
      SELECT jsonb_object_agg(team_id::text, wins) FROM team_classic_wins
    ), '{}'::jsonb),
    'team_classic_king', COALESCE((
      SELECT jsonb_object_agg(team_id::text, jsonb_build_object(
        'rider_id', rider_id, 'firstname', firstname,
        'lastname', lastname, 'wins', wins
      ))
      FROM team_classic_king
    ), '{}'::jsonb)
  );
$function$;

COMMENT ON FUNCTION public.get_season_recap(uuid) IS
  '#2891/#5535/#5390 · Server-side aggregering til sæson-recappen. Returnerer '
  'team_race_prize ({race_id:{team_id:prize}}, kun menneskehold), stage_kings '
  '(top 5 etapesejre), classic_kings (top 5 klassikersejre — endagsløb, rank 1), '
  'team_classic_wins ({team_id:antal}, kun menneskehold) og team_classic_king '
  '({team_id:{rider_id,firstname,lastname,wins}}, kun menneskehold — samme '
  'hold-tilskrivning som team_classic_wins). Alle filtrerer på '
  'r.squad = ''senior''.';

-- =============================================================================
-- Post-verify (kør manuelt efter apply)
-- =============================================================================
--
-- 1) Funktionen returnerer nu fem nøgler:
--    SELECT jsonb_object_keys(public.get_season_recap(
--      (SELECT id FROM seasons WHERE number = 1)));
--    → forventet: team_race_prize, stage_kings, classic_kings, team_classic_wins,
--      team_classic_king
--
-- 2) Paritet: summen af team_classic_wins skal matche et rå optælling af
--    endagsløbs-rank-1-rækker for menneskehold, samme sæson:
--    WITH j AS (SELECT public.get_season_recap(
--                 (SELECT id FROM seasons WHERE number=1)) AS v)
--    SELECT
--      (SELECT SUM(kv.value::int) FROM j, jsonb_each(j.v->'team_classic_wins') kv) AS via_rpc,
--      (SELECT COUNT(*) FROM race_results rr
--       JOIN races r ON r.id = rr.race_id
--       JOIN riders ri ON ri.id = rr.rider_id
--       JOIN teams t ON t.id = COALESCE(rr.team_id, ri.team_id)
--       WHERE r.season_id = (SELECT id FROM seasons WHERE number=1)
--         AND r.squad = 'senior' AND r.race_type <> 'stage_race'
--         AND rr.result_type = 'gc' AND rr.rank = 1 AND t.is_ai = false) AS via_raw;
--    → forventet: de to tal er ens.
--
-- 3) classic_kings' rider_id'er findes rent faktisk og har mindst ét endagsløb:
--    SELECT * FROM jsonb_to_recordset(
--      (SELECT public.get_season_recap((SELECT id FROM seasons WHERE number=1))->'classic_kings')
--    ) AS x(rider_id uuid, firstname text, lastname text, wins int);
--
-- 4) team_classic_king peger ALDRIG på et hold der mangler i team_classic_wins
--    (samme nøgle-mængde, se "SAMME TILSKRIVNING" i toppen af filen):
--    WITH j AS (SELECT public.get_season_recap(
--                 (SELECT id FROM seasons WHERE number=1)) AS v)
--    SELECT (SELECT array_agg(k) FROM j, jsonb_object_keys(j.v->'team_classic_king') k
--            WHERE NOT (j.v->'team_classic_wins') ? k) AS keys_uden_wins_match;
--    → forventet: {} (tom liste — ingen nøgler kun i team_classic_king).
