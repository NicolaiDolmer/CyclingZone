-- =============================================================================
-- 2026-08-31 · #4507 - fix statement-timeout på verify_race_result_duplicates
-- =============================================================================
-- SYMPTOM (#4507): natlig kalender-invariant-audit dør hver nat på
-- `rpc verify_race_result_duplicates: HTTP 500 - 57014 canceling statement due
-- to statement timeout` (job 99330723336, 30/8 22:20 UTC, ~9 s ind i kaldet).
-- #4204 flyttede dublet-optællingen fra ~1.130 PostgREST-kald til ét RPC-kald,
-- men RPC'en selv er nu blevet for tung til prods effektive statement_timeout.
--
-- ── Rodårsag 1: rollens statement_timeout, ikke funktionens ─────────────────
-- verify-invariants.js kalder RPC'en med SERVICE-nøglen. PostgREST logger ind
-- som `authenticator` og skifter først bagefter rolle til `service_role` inde i
-- transaktionen. Postgres' rolle-GUC'er (ALTER ROLE ... SET) evalueres ved LOGIN,
-- ikke ved SET ROLE - så den effektive statement_timeout er `authenticator`s
-- egen (8 s), IKKE `service_role`s (som ikke har noget rolconfig sat overhovedet):
--
--   SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN
--     ('anon','authenticated','authenticator','service_role');
--   -- authenticator: statement_timeout=8s  (denne binder RPC-kaldet)
--   -- service_role:  rolconfig IS NULL     (arver authenticator's session-GUC)
--
-- ── Rodårsag 2: funktionen er reelt for tæt på/over de 8 s ───────────────────
-- Målt mod prod 31/8 (1.211.578 rækker, op fra 1.128.609 ved #4204s måling 24/8 -
-- tabellen vokser ~83k rækker/uge og presser derfor queryen langsommere over
-- tid uanset dagens tal):
--
--   EXPLAIN (ANALYZE, BUFFERS) SELECT public.verify_race_result_duplicates(50);
--   -- Execution Time: ~5.3-7.1 s på tværs af gentagne kørsler (varierer med
--   --   cache-tilstand og concurrent load - godt indenfor "flaky" afstand af 8 s)
--
-- To selvstændige problemer bidrager:
--
--   a) rang-dublet-grupperingen (race_id, stage_number, result_type, rank) har
--      INTET matchende index. Planen falder til Parallel Seq Scan + Parallel
--      HashAggregate, og fordi næsten hver (løb, etape, klassement, rang)-
--      kombination er unik, bliver hash-tabellen næsten lige så stor som
--      inputtet - work_mem slår til og aggregeringen spiller ud på disk:
--
--        Finalize HashAggregate (actual time=3313.688..3313.736 rows=0)
--          Planned Partitions: 4  Batches: 69  Disk Usage: 126648kB
--        -> Parallel Seq Scan on race_results ... Filter: (rank IS NOT NULL)
--
--      Rytter-grupperingen har derimod idx_race_results_rider_id og løser
--      samme opgave 2x hurtigere UDEN disk-spild via Incremental Sort:
--
--        Finalize GroupAggregate (actual time=10.257..1422.644 rows=558518)
--        -> Parallel Index Scan using idx_race_results_rider_id
--
--   b) `rider_keys`-CTE'en blev refereret 3 gange i #4204s SQL (rider_key_count,
--      duplicate_key_count via duplicate_rider_keys, duplicate_race_count via
--      samme). Postgres materialiserer CTE'en i et work_mem-bundet tuplestore,
--      og med 558.518 rækker overskrider den default work_mem og spiller ud på
--      disk - hver ekstra reference bliver derfor en dyr disk-genlæsning, ikke
--      et billigt genbesøg af data der allerede lå i hukommelsen:
--
--        InitPlan 5 (rider_key_count): Aggregate (actual time=1790.742..1790.743)
--          -> CTE Scan on rider_keys rider_keys_1
--          Buffers: shared hit=206486, temp written=6603
--
-- ── Fix ────────────────────────────────────────────────────────────────────
-- 1) Nyt, dækkende, partielt index på rang-nøglen - samme mønster som
--    idx_race_results_rider_id, bare fuld dækning af alle fire grupperings-
--    kolonner plus id, så planlæggeren kan bruge en Index Scan (allerede
--    sorteret efter gruppe-nøglen) og en streaming GroupAggregate i stedet for
--    Parallel Seq Scan + disk-spildt HashAggregate. Kræver ingen sortering
--    overhovedet (til forskel fra rytter-vejens Incremental Sort), fordi
--    indekset dækker alle fire GROUP BY-kolonner i rækkefølge.
-- 2) Funktionen får sin egen work_mem (64 MB) og statement_timeout (25 s) via
--    CREATE FUNCTION ... SET-klausuler - IKKE `SET LOCAL` i funktionskroppen
--    (kræver plpgsql/flere statements), men den indbyggede, veldokumenterede
--    mekanik hvor en funktion kører med sin egen GUC-værdi for kaldets varighed
--    og automatisk gendanner den bagefter. Kun DENNE funktion påvirkes - alle
--    andre RPC/API-kald beholder authenticator's 8 s uændret. 25 s er rigeligt
--    hovedrum over de nu forventede <2-3 s (indekset fjerner disk-spildet), og
--    vagten kører i et lavtrafik-nat-vindue (03:50 UTC) plus lejlighedsvis på PR.
-- 3) `rider_keys`-CTE'en refereres nu kun 2 gange i stedet for op til 3-4: alle
--    tre rytter-tal (rider_key_count, duplicate_key_count, duplicate_race_count)
--    beregnes i ÉT scan via aggregate FILTER (rider_stats), og kun
--    top-p_limit-udtrækket (capped_rider) laver et andet scan. Samme mønster
--    for rang-siden. Eksplicit MATERIALIZED på begge base-CTE'er, så adfærden
--    ikke driver med fremtidige planlægger-heuristik-ændringer.
--
-- SCOPE: kun læsning + funktions-definition + index. Ingen data muteres, intet
-- skema (kolonner/constraints) ændres. Semantikken er UÆNDRET - se ækvivalens-
-- beviset i backend/lib/testdb/raceResultDuplicateRpc.integration.test.js, som
-- kører DENNE fils SQL mod PGlite og sammenligner byte-for-byte med
-- referenceimplementationen. jsonb_build_object-nøglerne og deres rækkefølge er
-- identiske med #4204s version - kun HVORDAN tallene beregnes internt er ændret.
--
-- IKKE rørt her (bevidst - se #4507's tråd): punkt 4 i issuet ("skal
-- verify-invariants kunne fortsætte forbi ÉN død invariant") er en
-- designbeslutning om fail-open/fail-closed-semantik, ikke en performance-fix,
-- og ejeren skal tage den bevidst - risikoen for at gen-introducere #4463s
-- "grøn uden at måle"-fejlklasse er reel hvis den implementeres skødesløst.
--
-- IDEMPOTENT: CREATE INDEX CONCURRENTLY IF NOT EXISTS + selvhelbredende guard
-- (samme mønster som #4010) + CREATE OR REPLACE FUNCTION + REVOKE/GRANT. Kan
-- køres igen uden effekt. CONCURRENTLY kører UDEN for transaktion (må ikke
-- være i BEGIN/COMMIT) - auto-migrate kører filen via psql -f i autocommit.
--
-- ROLLBACK:
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_race_results_rank_dupe_check;
--   -- og gendan #4204s funktions-version (database/2026-08-29-4204-*.sql,
--   -- CREATE OR REPLACE er idempotent og kan køres igen for at rulle tilbage)
--
-- Refs #4507 #4204 #4159 #2974 #2898 #2642 #4463
-- =============================================================================

-- Selvhelbredende guard (som #4010): et afbrudt CONCURRENTLY-forsøg efterlader
-- et INVALID index, som IF NOT EXISTS ellers ville springe over ved re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_race_results_rank_dupe_check'
      AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.idx_race_results_rank_dupe_check';
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_results_rank_dupe_check
  ON public.race_results USING btree (race_id, stage_number, result_type, rank)
  INCLUDE (id)
  WHERE rank IS NOT NULL;

BEGIN;

CREATE OR REPLACE FUNCTION public.verify_race_result_duplicates(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
SET work_mem TO '64MB'
SET statement_timeout TO '25s'
AS $function$
  WITH rider_keys AS MATERIALIZED (
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
  rider_stats AS (
    SELECT
      count(*)::int AS rider_key_count,
      count(*) FILTER (WHERE row_count > 1)::int AS duplicate_key_count,
      -- BEVIDST count(*) FROM (SELECT DISTINCT ...), IKKE count(DISTINCT race_id)
      -- FILTER (...): count(DISTINCT ...) springer NULL over, men et NULL race_id
      -- (historiske importer uden løbs-reference) SKAL tælle som ét løb, ligesom
      -- `new Set([...])` gjorde i den gamle JS-vej og #4204s SELECT DISTINCT
      -- gjorde. Fanget af PGlite-ækvivalenstesten ("NULL stage_number og NULL
      -- race_id grupperes ens i SQL og JS") under udvikling af denne fil - uden
      -- den test havde denne regression sluppet igennem.
      (SELECT count(*)::int FROM (SELECT DISTINCT race_id FROM rider_keys WHERE row_count > 1) d) AS duplicate_race_count
    FROM rider_keys
  ),
  capped_rider AS (
    SELECT * FROM rider_keys
    WHERE row_count > 1
    ORDER BY first_id
    LIMIT greatest(coalesce(p_limit, 50), 0)
  ),
  rank_keys AS MATERIALIZED (
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
  rank_stats AS (
    SELECT count(*) FILTER (WHERE row_count > 1)::int AS duplicate_rank_count
    FROM rank_keys
  ),
  capped_rank AS (
    SELECT * FROM rank_keys
    WHERE row_count > 1
    ORDER BY first_id
    LIMIT greatest(coalesce(p_limit, 50), 0)
  )
  SELECT jsonb_build_object(
    'total_rows',           (SELECT count(*) FROM public.race_results),
    'rider_key_count',      (SELECT rider_key_count FROM rider_stats),
    'duplicate_key_count',  (SELECT duplicate_key_count FROM rider_stats),
    'duplicate_race_count', (SELECT duplicate_race_count FROM rider_stats),
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
    'duplicate_rank_count', (SELECT duplicate_rank_count FROM rank_stats),
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
  '#4507 (perf-fix af #4204): aggregeret dublet-check på race_results til
  backend/scripts/verify-invariants.js. Egen work_mem (64MB) + statement_timeout
  (25s) via funktions-SET, så authenticator-rollens 8s ikke fælder kaldet.
  Rang-siden bruger idx_race_results_rank_dupe_check (undgår disk-spildt
  HashAggregate). Semantik uændret fra #4204 - se
  backend/lib/testdb/raceResultDuplicateRpc.integration.test.js for
  ækvivalens-beviset. Read-only, muterer intet.';

-- Supabase' ALTER DEFAULT PRIVILEGES gen-granter EXECUTE til anon+authenticated
-- ved funktions-oprettelse (samme klasse som #2676/#2671). Uændret fra #4204.
REVOKE ALL ON FUNCTION public.verify_race_result_duplicates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_race_result_duplicates(integer) TO service_role;

COMMIT;

-- PostgREST schema-cache reload, så den opdaterede funktion er aktiv med det
-- samme (indekset kræver ingen reload - kun funktions-signaturer cache'es).
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Post-verify (kør efter apply)
-- =============================================================================
-- 1) Indekset findes og er gyldigt:
--
--   SELECT c.relname, i.indisvalid, pg_size_pretty(pg_relation_size(c.oid)) AS size
--   FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE c.relname = 'idx_race_results_rank_dupe_check';
--   -- forventet: 1 række, indisvalid = true
--
-- 2) Rang-grupperingen bruger nu indekset, ikke Parallel Seq Scan:
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT race_id, stage_number, result_type, rank, count(*)
--   FROM public.race_results
--   WHERE rank IS NOT NULL
--   GROUP BY race_id, stage_number, result_type, rank
--   HAVING count(*) > 1;
--   -- forventet: Index Scan/Index Only Scan using idx_race_results_rank_dupe_check,
--   --            GroupAggregate (ikke HashAggregate), 0 "Disk Usage"
--
-- 3) Funktionens SET-klausuler sidder:
--
--   SELECT p.proname, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'verify_race_result_duplicates';
--   -- forventet: proconfig indeholder search_path=..., work_mem=64MB,
--   --            statement_timeout=25s
--
-- 4) Svaret matcher #4204s facit (samme tal som før optimeringen):
--
--   SELECT public.verify_race_result_duplicates(50);
--   -- forventet: duplicate_key_count = 0, duplicate_rank_count = 0,
--   -- total_rows/rider_key_count uændrede fra dagens tal
--
-- 5) Kaldet er nu markant hurtigere og under statement_timeout:
--
--   \timing on
--   SELECT public.verify_race_result_duplicates(50);
--   -- forventet: < 3 s (mod ~5,3-7,1 s før denne fil, med disk-spild)
--
-- 6) Scriptet kører grønt mod prod:
--
--   cd backend && time node scripts/verify-invariants.js --json | head -40
--   -- forventet: ingen "canceling statement due to statement timeout",
--   --            no_duplicate_race_results + no_duplicate_race_result_ranks
--   --            uændrede, samlet køretid markant under 8 s for RPC-kaldet
-- =============================================================================
