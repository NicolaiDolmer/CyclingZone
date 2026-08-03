-- #3190 — Mit Hold: "Stats"-fane pr. rytter (løbsdage, sejre, point, præmiepenge).
--
-- BAGGRUND
--   Discord #feedback-and-ideas 1/8 (@thelamba): "'My Team' - tab for
--   points/stages/wins/stats". Ejer-ja i tråden 1/8. Se GitHub-issue #3190.
--
-- GENBRUG FØRST: sejre/point/præmie kommer FRA rider_rankings_mv (#2175) —
--   nøjagtig samme aggregat som /rider-rankings og get_season_honours (#2863)
--   allerede bruger (points, prize_earned, de 6 sejrs-kategorier). Frontend
--   henter det direkte (samme mønster som useRiderRankings.js), filtreret til
--   holdets egne rytter-id'er — INGEN ny migration for de tre tal.
--
--   Denne migration dækker KUN det fjerde tal — "løbsdage" — som ikke findes
--   noget sted i forvejen (hverken på riders-tabellen eller i et matview).
--
-- HVAD ER EN "LØBSDAG"
--   race_results har result_type='stage' for HVER startende rytter på HVER
--   etape i et etapeløb (raceRunner.js: `for (const r of ranked) pushIndiv({
--   result_type: "stage", ... })` — hele det klassificerede felt, ikke kun
--   top-N). Endagsløb har BEVIDST ingen 'stage'-række (raceRunner.js-kommentar:
--   "Ingen 'stage' (= dobbelttælling, jf. PCM)") — der er kun ÉN 'gc'-række pr.
--   rytter. Løbsdage = COUNT('stage'-rækker) + COUNT('gc'-rækker på endagsløb).
--   Samme skelnen (ra.race_type) som rider_rankings_mv allerede bruger til at
--   opdele gc_wins (etapeløb) fra classic_wins (endagsløb).
--
-- SCOPE: parametreret på et EKSPLICIT rytter-id-array (holdets nuværende
--   trup, allerede hentet af TeamPage.jsx's loadAll()) + sæson-id — IKKE en
--   team_id-opslag i funktionen. Frontend har allerede rytter-id'erne i
--   hukommelsen, så en ekstra riders-subquery i SQL er overflødig, og et
--   eksplicit array gør funktionen genanvendelig andre steder (fx en fremtidig
--   rytterprofil-visning) uden at være bundet til "hold".
--
-- YDELSE (EXPLAIN ANALYZE mod prod 3/8, to reelle hold på 37-38 ryttere,
--   read-only via Supabase MCP execute_sql):
--   Execution Time ~4.2-4.3 ms begge gange. Index Scan using
--   idx_race_results_rider_id (rider_id = ANY(...)) → Hash Join mod races
--   (Index Scan using idx_races_season_pool on season_id). Ingen sekventiel
--   scan af race_results (415k+ rækker).
--
-- SECURITY INVOKER (default, ligesom get_season_recap/get_season_honours):
--   race_results og races har begge "Public read ... USING (true))" — ingen ny
--   SECURITY DEFINER-flade at forsvare.
--
-- IDEMPOTENT: CREATE OR REPLACE FUNCTION + REVOKE/GRANT kan køres igen uden effekt.
-- APPLY: Claude kører denne migration READ-ONLY-verificeret og applier den
--   SELV efter merge (#2642-rammer — idempotent, ikke-destruktiv, post-verify
--   nedenfor). Ingen matview at refreshe, ingen data at bagudkompatibilitets-migrere.
-- Rollback: DROP FUNCTION IF EXISTS public.get_rider_race_days(uuid[], uuid);

CREATE OR REPLACE FUNCTION public.get_rider_race_days(p_rider_ids uuid[], p_season_id uuid)
RETURNS TABLE(rider_id uuid, race_days bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT rr.rider_id,
    (COUNT(*) FILTER (WHERE rr.result_type = 'stage')
     + COUNT(*) FILTER (WHERE rr.result_type = 'gc' AND ra.race_type = 'single'))::bigint AS race_days
  FROM public.race_results rr
  JOIN public.races ra ON ra.id = rr.race_id
  WHERE rr.rider_id = ANY(p_rider_ids)
    AND ra.season_id = p_season_id
    AND rr.result_type IN ('stage', 'gc')
  GROUP BY rr.rider_id;
$$;

COMMENT ON FUNCTION public.get_rider_race_days(uuid[], uuid) IS
  '#3190 · Antal løbsdage pr. rytter i en given sæson (stage-rækker + gc-rækker '
  'på endagsløb), scoped til et eksplicit rytter-id-array. Bruges af Mit Holds '
  'Stats-fane; points/sejre/præmie kommer fortsat fra rider_rankings_mv (#2175).';

REVOKE ALL ON FUNCTION public.get_rider_race_days(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rider_race_days(uuid[], uuid) TO anon, authenticated, service_role;

-- PostgREST schema-cache reload, så RPC'en er kaldbar umiddelbart efter apply.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Post-verify (kør manuelt efter apply)
-- =============================================================================
--
-- 1) Funktionen findes og er SECURITY INVOKER (prosecdef = false):
--    SELECT proname, prosecdef, provolatile
--    FROM pg_proc WHERE proname = 'get_rider_race_days';
--    → forventet: get_rider_race_days | false | s
--
-- 2) Paritet mod et rigtigt hold (indsæt et faktisk team_id + aktivt season_id):
--    SELECT * FROM public.get_rider_race_days(
--      ARRAY(SELECT id FROM riders WHERE team_id = '<team-uuid>' AND is_retired = false),
--      (SELECT id FROM seasons WHERE status = 'active')
--    ) ORDER BY race_days DESC LIMIT 5;
--    → ikke-negative heltal, højst season_days_total for sæsonen.
--
-- 3) Krydstjek én rytter manuelt mod race_results:
--    SELECT count(*) FROM race_results rr JOIN races ra ON ra.id = rr.race_id
--    WHERE rr.rider_id = '<rider-uuid>' AND ra.season_id = '<season-uuid>'
--      AND (rr.result_type = 'stage' OR (rr.result_type = 'gc' AND ra.race_type = 'single'));
--    → skal matche get_rider_race_days-resultatet for samme rytter.
