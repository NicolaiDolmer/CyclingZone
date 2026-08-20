-- 2026-08-20 · #4010 — dækkende index til balanceDriftWatch's 14-dages-vindue
-- plus autovacuum-tuning på race_results/race_entries.
--
-- ── Hvorfor indekset ────────────────────────────────────────────────────────
-- balanceDriftWatch henter stage-resultater for de seneste 14 dage. Den kørte før
-- offset-pagineret; målt plan for ÉN side af 1000 rækker (20/8, prod):
--
--   Limit (actual time=397.745..427.371 rows=1000)
--     Buffers: shared hit=376260
--     ->  Parallel Index Scan using idx_race_results_rider_id
--           Rows Removed by Filter: 172555
--
-- 65 sider × dét = 594 s DB-tid og 3,3 TB buffer-trafik i døgnet (11,4 % af al
-- eksekveringstid på databasen). Koden er lagt om til keyset-paginering på `id`,
-- hvilket alene bringer én side ned på 16.669 buffere / 39,6 ms via
-- race_results_pkey — men den plan går stadig gennem ALLE 1,05 mio. rækker over
-- en fuld kørsel, fordi pkey ikke kender result_type/imported_at.
--
-- Dette partielle, dækkende index indeholder kun de 223.003 stage-rækker og
-- bærer selv de tre kolonner queryen læser. Verificeret med hypopg mod prod:
--
--   ->  Index Only Scan using "<hypo>btree_race_results_id_imported_at_rider_id_rank"
--         Index Cond: (id > $1)
--         Filter: ((imported_at < now()) AND (imported_at >= now() - '14 days'))
--
-- Skrive-omkostning: race_results tager 39.431 inserts + 35.524 updates i døgnet.
-- Et 13 MB-index oveni er forsvindende mod de 3,3 TB læsning det fjerner.
--
-- ── Hvorfor autovacuum-tuningen hører med ───────────────────────────────────
-- Et Index Only Scan springer kun heapen over for sider markeret all-visible i
-- visibility map'et, og VM'et sættes kun af VACUUM. race_results er ALDRIG blevet
-- vacuum'et (pg_stat_user_tables: last_vacuum og last_autovacuum begge NULL,
-- autovacuum_count = 0), hvilket er målbart:
--
--   ->  Index Only Scan using race_results_pkey ... Heap Fetches: 500001
--
-- Årsagen er tærsklerne, ikke en fejl: insert-vacuum udløses ved
-- 1000 + 0,2 × 1.050.177 ≈ 211.000 inserts (~5 døgn ved nuværende tempo), og
-- dead-tuple-vacuum ved ~210.000 døde rækker (~6 døgn). Tabellen når aldrig
-- derop før den er vokset igen. Uden VM'et bliver det nye index kun halvt så
-- effektivt, så tærsklerne sættes ned pr. tabel her.
--
-- race_entries får samme behandling: 18.959 døde rækker, autovacuum_count = 0.
--
-- OBS: CREATE INDEX CONCURRENTLY og VACUUM må IKKE køre i en transaktion — filen
-- har derfor bevidst ingen BEGIN/COMMIT (auto-migrate kører den via psql -f i
-- autocommit). CONCURRENTLY valgt så resultatimport ikke blokeres undervejs.

-- Selvhelbredende guard: et afbrudt CONCURRENTLY-forsøg efterlader et INVALID
-- index, som IF NOT EXISTS ellers ville springe over ved re-run. Drop det først.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_race_results_stage_window'
      AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.idx_race_results_stage_window';
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_results_stage_window
  ON public.race_results USING btree (id)
  INCLUDE (imported_at, rider_id, rank)
  WHERE result_type = 'stage';

-- Idempotent: ALTER TABLE ... SET (…) overskriver samme nøgler ved re-run.
ALTER TABLE public.race_results SET (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor        = 0.05,
  autovacuum_analyze_scale_factor       = 0.02
);

ALTER TABLE public.race_entries SET (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_scale_factor        = 0.05,
  autovacuum_analyze_scale_factor       = 0.02
);

-- Første VACUUM sætter visibility map'et med det samme i stedet for at vente på
-- at de nye tærskler bliver nået. ANALYZE giver samtidig planlæggeren friske
-- statistikker for det nye index.
VACUUM (ANALYZE) public.race_results;
VACUUM (ANALYZE) public.race_entries;

-- Post-verify (manuelt efter apply):
--
--   -- 1) indexet findes og er gyldigt
--   SELECT c.relname, i.indisvalid, pg_size_pretty(pg_relation_size(c.oid)) AS size
--   FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE c.relname = 'idx_race_results_stage_window';
--   -- forventet: 1 række, indisvalid = true
--
--   -- 2) autovacuum-tuningen sidder
--   SELECT relname, reloptions FROM pg_class
--   WHERE relname IN ('race_results','race_entries');
--   -- forventet: reloptions indeholder de tre autovacuum_*-nøgler
--
--   -- 3) VACUUM er kørt, så visibility map'et er sat
--   SELECT relname, last_vacuum, n_ins_since_vacuum FROM pg_stat_user_tables
--   WHERE relname IN ('race_results','race_entries');
--   -- forventet: last_vacuum er sat, n_ins_since_vacuum nulstillet
--
--   -- 4) queryen bruger indexet (indsæt et vilkårligt eksisterende id som anker)
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id, rider_id, rank FROM public.race_results
--   WHERE result_type = 'stage'
--     AND imported_at >= now() - interval '14 days' AND imported_at < now()
--     AND id > (SELECT min(id) FROM public.race_results)
--   ORDER BY id ASC LIMIT 1000;
--   -- forventet: Index Only Scan using idx_race_results_stage_window,
--   --            og markant færre buffers end de 16.669 pkey-planen brugte
