-- =============================================================================
-- 2026-08-29 · #4204 - aggreger race_results-dublet-invarianten i Postgres
-- =============================================================================
-- PROBLEM (målt 24/8, workflow-run 32745895242 + lokalt):
-- `backend/scripts/verify-invariants.js` tog 20 min 12 s. Hovedparten gik til de
-- to race_results-checks (`no_duplicate_race_results` + `no_duplicate_race_result_
-- ranks`): scriptet hentede ALLE 1.128.609 rækker over PostgREST i sider a 1000,
-- altså ~1.130 HTTP-kald, for at bygge to Map's og tælle nøgler der optræder mere
-- end én gang. Postgres kan svare på præcis det spørgsmål med to GROUP BY.
--
-- Efter #4159 kører vagten hver nat plus på enhver PR der rører kalender-libs, så
-- 20 min pr. kørsel er den slags der får en vagt slået fra. Denne RPC erstatter de
-- ~1.130 kald med ÉT.
--
-- SCOPE: kun læsning. Funktionen muterer intet og rører ingen rækker.
--
-- ── Hvorfor en RPC og ikke bare et smartere REST-kald ────────────────────────
-- verify-invariants.js er bevidst dependency-frit ("Zero external dependencies -
-- bruger kun Node built-ins og Supabase REST API"), så en pg-klient er udelukket.
-- PostgREST kan ikke selv lave GROUP BY ... HAVING count(*) > 1. En funktion kaldt
-- via POST /rest/v1/rpc/<navn> holder scriptet på REST og flytter aggregeringen
-- derhen hvor dataene ligger.
--
-- ── Nøjagtig samme svar som den gamle vej ────────────────────────────────────
-- Semantikken er 1:1 med den in-memory-optælling der lå i scriptet (og som stadig
-- findes som reference/fallback i backend/lib/raceResultDuplicateInvariant.js):
--
--   * Dublet-nøgle: (race_id, stage_number, result_type, rider_id), KUN rækker med
--     rider_id IS NOT NULL. Hold-klassementerne (`team`, `team_day`) og historiske
--     PCM-importer efterlader rytterløse rækker; tælles de med, samles alle
--     NULL-rytter-rækker i ét løb i ÉN nøgle (både i SQL og i den gamle Map) og
--     rapporterer 2.336 falske "dubletter" på 410 løb (målt 26/7).
--   * Rang-nøgle: (race_id, stage_number, result_type, rank), KUN rank IS NOT NULL.
--     Ikke-scorende rækker bærer rank=null i massevis og er ikke dubletter.
--   * GROUP BY grupperer NULL med NULL (stage_number og race_id er nullable),
--     præcis som den gamle Map-nøgle gjorde.
--   * `duplicate_race_count` tælles via SELECT DISTINCT (ikke count(DISTINCT ...)),
--     så et NULL race_id tæller som ét løb - samme som `new Set([...])` gjorde.
--   * `order by min(id::text)` gengiver den gamle rapporterings-rækkefølge: rækkerne blev
--     hentet med order=id.asc, så Map'ens indsættelses-rækkefølge var stigende efter
--     gruppens laveste id. Det afgør HVILKE brud der havner i de første p_limit
--     stk. når der er flere. `::text` er ikke pynt: min()/max() for uuid kom først
--     i PostgreSQL 18, og hverken prod (PG 15) eller PGlite-harnessen har dem, så
--     `min(id)` fejler med 42883 "function min(uuid) does not exist". Postgres
--     render ALTID en uuid som lowercase hex med bindestreger på faste pladser, så
--     tekst-formen sorterer identisk med uuid-formen: samme rækkefølge som
--     PostgREST's order=id.asc gav den gamle vej.
--
-- Ækvivalensen er bevist mod en ægte Postgres-motor, ikke påstået: denne fils SQL
-- køres mod PGlite i backend/lib/testdb/raceResultDuplicateRpc.integration.test.js
-- side om side med JS-referencen over de samme rækker, og de to resultater
-- sammenlignes med deepStrictEqual (inkl. rækkefølge og nøgle-orden).
--
-- ── Omkostning ──────────────────────────────────────────────────────────────
-- Tre seq scans af race_results (rider-grupperingen, rang-grupperingen, count(*)).
-- Ingen af dem kan bruge et index meningsfuldt - hele tabellen SKAL læses for at
-- garantere "ingen dubletter nogen steder". Til gengæld er det tre scans af en
-- ~1,1 mio. rækkers tabel i databasen selv, mod 1.130 HTTP-round trips før.
-- (Et enkelt scan via GROUPING SETS er muligt, men gør SQL'en markant sværere at
-- læse for en invariant-vagt hvor korrekthed vejer tungere end det sidste sekund.)
--
-- BEMÆRK: dette issue har en anden halvdel som denne fil IKKE lukker. Ejeren
-- noterede 25/8 (Sentry CYCLINGZONE-4Q) at stall-watchdog'ens `max()` over samme
-- tabel ramte statement timeout. Det er en anden query med et andet fix (index
-- eller omskrivning) og kræver plan-målinger mod prod. Ikke rørt her.
--
-- IDEMPOTENT: CREATE OR REPLACE + REVOKE/GRANT. Ingen data muteres, intet skema
-- ændres. Kan køres igen uden effekt. Ejeren/orkestratoren applier post-merge
-- under #2642-rammerne (idempotent + post-verify, ikke-destruktiv). APPLY IKKE
-- under implementering.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.verify_race_result_duplicates(integer);
--   (verify-invariants.js falder automatisk tilbage til det fulde træk igen)
--
-- Refs #4204 #4159 #2974 #2898 #2642
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.verify_race_result_duplicates(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH rider_keys AS (
    SELECT race_id,
           stage_number,
           result_type,
           rider_id,
           count(*)::int AS row_count,
           min(id::text)  AS first_id
    FROM public.race_results
    WHERE rider_id IS NOT NULL
    GROUP BY race_id, stage_number, result_type, rider_id
  ),
  duplicate_rider_keys AS (
    SELECT * FROM rider_keys WHERE row_count > 1
  ),
  rank_keys AS (
    SELECT race_id,
           stage_number,
           result_type,
           rank,
           count(*)::int AS row_count,
           min(id::text)  AS first_id
    FROM public.race_results
    WHERE rank IS NOT NULL
    GROUP BY race_id, stage_number, result_type, rank
  ),
  duplicate_rank_keys AS (
    SELECT * FROM rank_keys WHERE row_count > 1
  ),
  capped_rider AS (
    SELECT * FROM duplicate_rider_keys
    ORDER BY first_id
    LIMIT greatest(coalesce(p_limit, 50), 0)
  ),
  capped_rank AS (
    SELECT * FROM duplicate_rank_keys
    ORDER BY first_id
    LIMIT greatest(coalesce(p_limit, 50), 0)
  )
  SELECT jsonb_build_object(
    'total_rows',           (SELECT count(*) FROM public.race_results),
    'rider_key_count',      (SELECT count(*) FROM rider_keys),
    'duplicate_key_count',  (SELECT count(*) FROM duplicate_rider_keys),
    -- SELECT DISTINCT (ikke count(DISTINCT ...)): et NULL race_id skal tælle som
    -- ét løb, ligesom `new Set([...])` gjorde i den gamle JS-vej.
    'duplicate_race_count', (SELECT count(*) FROM (SELECT DISTINCT race_id FROM duplicate_rider_keys) d),
    'duplicate_keys',       coalesce((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'race_id',      c.race_id,
                 'stage_number', c.stage_number,
                 'result_type',  c.result_type,
                 'rider_id',     c.rider_id,
                 'rows',         c.row_count
               )
               ORDER BY c.first_id
             )
      FROM capped_rider c
    ), '[]'::jsonb),
    'duplicate_rank_count', (SELECT count(*) FROM duplicate_rank_keys),
    'duplicate_ranks',      coalesce((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'race_id',      c.race_id,
                 'stage_number', c.stage_number,
                 'result_type',  c.result_type,
                 'rank',         c.rank,
                 'rows',         c.row_count
               )
               ORDER BY c.first_id
             )
      FROM capped_rank c
    ), '[]'::jsonb)
  );
$function$;

COMMENT ON FUNCTION public.verify_race_result_duplicates(integer) IS
  '#4204: aggregeret dublet-check på race_results til backend/scripts/verify-invariants.js.
  Erstatter et fuldt træk af ~1,1 mio. rækker over PostgREST (~1.130 kald) med ét RPC-kald.
  Returnerer totaler + de p_limit første brud for BEGGE invarianter: rytter-dubletter
  (race_id, stage_number, result_type, rider_id) med rider_id IS NOT NULL (#2974/#2898) og
  rang-dubletter (race_id, stage_number, result_type, rank) med rank IS NOT NULL (#2898).
  Rækkefølgen er min(id::text) stigende, så de rapporterede brud er de samme som den tidligere
  in-memory-optælling udpegede. Read-only, muterer intet.';

-- Supabase' ALTER DEFAULT PRIVILEGES gen-granter EXECUTE til anon+authenticated ved
-- funktions-oprettelse (samme klasse som #2676/#2671). Denne RPC er en ops-vagt der
-- kun kaldes af verify-invariants.js med service-nøglen - revoke derfor eksplicit.
REVOKE ALL ON FUNCTION public.verify_race_result_duplicates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_race_result_duplicates(integer) TO service_role;

COMMIT;

-- PostgREST schema-cache reload, så RPC'en er kaldbar umiddelbart efter apply.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Post-verify (kør efter apply)
-- =============================================================================
-- 1) Funktionen findes, er STABLE og har search_path sat:
--
--   SELECT p.proname,
--          pg_get_function_identity_arguments(p.oid) AS args,
--          p.provolatile,          -- forventet: 's' (stable)
--          p.proconfig             -- forventet: {search_path=public,pg_catalog}
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'verify_race_result_duplicates';
--   -- forventet: 1 række
--
-- 2) Kun service_role kan EXECUTE:
--
--   SELECT grantee, privilege_type
--   FROM information_schema.routine_privileges
--   WHERE specific_schema = 'public' AND routine_name = 'verify_race_result_duplicates';
--   -- forventet: service_role=EXECUTE (og postgres/ejeren), IKKE anon/authenticated/PUBLIC
--
-- 3) Svaret matcher den gamle vej (kør begge og sammenlign):
--
--   SELECT public.verify_race_result_duplicates(50);
--   -- forventet pr. 24/8-målingen: duplicate_key_count = 0, duplicate_rank_count = 0,
--   -- total_rows ~1,13 mio., rider_key_count ~490.000
--
--   -- Kontrol-query, uafhængig af funktionen:
--   SELECT count(*) AS duplicate_keys FROM (
--     SELECT 1 FROM public.race_results
--     WHERE rider_id IS NOT NULL
--     GROUP BY race_id, stage_number, result_type, rider_id
--     HAVING count(*) > 1
--   ) d;
--   -- forventet: samme tal som duplicate_key_count ovenfor
--
-- 4) Scriptet bruger den (og er blevet hurtigt):
--
--   cd backend && time node scripts/verify-invariants.js --json | head -40
--   -- forventet: ingen "[advarsel] RPC ... findes ikke endnu" på stderr,
--   --            no_duplicate_race_results + no_duplicate_race_result_ranks uændrede,
--   --            samlet køretid markant under de 20 min fra 24/8
-- =============================================================================
