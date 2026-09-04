-- Feature-liveness audit: robust mod lock-blokerede tabeller (#4754).
--
-- Problem (4/9, PR #4754's audit-run):
--   feature_liveness_table_counts() fejlede med
--   "canceling statement due to statement timeout" (statement_timeout=2min,
--   arvet af service_role — ingen rolconfig-override).
--
-- Rod-årsag: funktionen kører ÉT sekventielt exact COUNT(*) pr. public-tabel
-- (257 tabeller pr. 2026-09-04, ~254k rows i alt) som del af SAMME statement.
-- Normal-case er hurtigt (~1 s målt live), MEN et enkelt COUNT(*) kan blokere
-- hvis en anden session holder et exclusive lock på lige netop den tabel —
-- fx en "_mv"-tabel der refreshes via TRUNCATE+INSERT (samme mønster som
-- #3013's REFRESH-uden-CONCURRENTLY-problem, blot på en almindelig tabel).
-- Uden et per-tabel lock_timeout venter loopet til HELE funktionens
-- statement_timeout (2 min) rammer, og hele auditten fejler i stedet for at
-- levere ét mindre præcist tal.
--
-- Løsning (mindst invasiv, se PR-body for trade-off-analyse):
--   - SET LOCAL lock_timeout = '3s' inde i funktionen, så ét låst bord maks
--     koster 3 sekunder i stedet for at æde hele budgettet.
--   - Ved lock_not_available/query_canceled: fald tilbage til
--     pg_class.reltuples (planlægger-estimat) for DEN tabel og markér rækken
--     estimated=true, i stedet for at kaste hele RPC'et.
--   - Detector A (write-but-no-data) i audit-feature-liveness.js skal IKKE
--     stole på et estimeret 0-tal (reltuples kan være stale/0 lige efter
--     første insert før autovacuum-analyze) — se JS-ændringen i samme PR,
--     som springer estimerede nul-rækker over i stedet for at flage dem.
--
-- Idempotent: CREATE OR REPLACE. Bagudkompatibel: ny `estimated`-kolonne er
-- tilføjet sidst, eksisterende callers der læser table_name/row_count/
-- rls_enabled positionelt fortsætter uændret (audit-scriptet bruger named
-- destructuring, se backend/scripts/audit-feature-liveness.js).

CREATE OR REPLACE FUNCTION public.feature_liveness_table_counts()
RETURNS TABLE (
  table_name text,
  row_count bigint,
  rls_enabled boolean,
  estimated boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  rec record;
  cnt bigint;
BEGIN
  -- Session-scoped til denne transaktion (SET LOCAL i en SECURITY DEFINER-
  -- funktion er trygt: den ryger ud igen når funktionskaldets transaktion
  -- slutter, og påvirker ikke andre sessions).
  SET LOCAL lock_timeout = '3s';

  FOR rec IN
    SELECT
      c.relname::text AS tbl,
      c.relrowsecurity AS rls,
      c.reltuples AS est_rows
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT LIKE 'pg\_%'
    ORDER BY c.relname
  LOOP
    BEGIN
      EXECUTE format('SELECT COUNT(*) FROM public.%I', rec.tbl) INTO cnt;
      table_name := rec.tbl;
      row_count := cnt;
      rls_enabled := rec.rls;
      estimated := false;
    EXCEPTION
      WHEN lock_not_available OR query_canceled THEN
        table_name := rec.tbl;
        row_count := GREATEST(COALESCE(rec.est_rows, 0)::bigint, 0);
        rls_enabled := rec.rls;
        estimated := true;
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.feature_liveness_table_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_liveness_table_counts() TO service_role;
