-- EPIC #2000 slice 1: GRANT SELECT på rider_derived_abilities.ability_progress
-- til anon + authenticated.
--
-- Baggrund: kolonne-privilegie-migrationen (2026-06-10-riders-potentiale-
-- column-privilege.sql) REVOKE'ede SELECT på hele rider_derived_abilities og
-- GRANT'ede så kun de kolonner der fandtes PÅ DET TIDSPUNKT (alt undtagen
-- hidden_potential). `ability_progress` blev tilføjet SENERE
-- (2026-06-12-daily-training.sql) og arvede derfor IKKE et kolonne-SELECT-grant
-- — præcis det fail-closed-scenarie som 2026-06-10-migrationens header advarer
-- om ("⚠️ FAIL-CLOSED for fremtidige kolonner").
--
-- Konsekvens: en frontend-select der inkluderer ability_progress afvises af
-- PostgREST (kolonne-privilegium nægtet) og brækker HELE rider_derived_abilities-
-- kaldet. Ryttersidens evne-visning (#2000) viser progress-bjælker mod næste +1
-- for ALLE ryttere, drevet af netop ability_progress — så feltet skal kunne læses
-- af klienten.
--
-- ability_progress lækker ingen skjult information: det er bare en 0..1-fraktion
-- pr. evne mod næste +1 (samme synligheds-niveau som de 15 evne-kolonner, der
-- allerede er klient-læsbare). hidden_potential forbliver urørt og uden grant.
--
-- Idempotent: GRANT kan genkøres frit.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rider_derived_abilities'
      AND column_name = 'ability_progress'
  ) THEN
    EXECUTE 'GRANT SELECT (ability_progress) ON public.rider_derived_abilities TO anon, authenticated';
  END IF;
END $$;

-- PostgREST schema-cache reload (GRANT trigges normalt af pgrst_ddl_watch,
-- men eksplicit NOTIFY koster intet og fjerner al tvivl).
NOTIFY pgrst, 'reload schema';
