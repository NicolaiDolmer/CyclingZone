-- 2026-07-03 — Forward-guard (DB-lag): blokér HARD DELETE af en rytter der stadig har
-- race_entries i et IGANGVÆRENDE løb (#2074). Ejer-applied — se PR-body.
--
-- ROD-ÅRSAG (#2074, verificeret read-only mod prod 2/7)
--   Et 7-etapers div-1-løb (La Corsa dei Due Mari) mistede HELE sit startfelt
--   (race_entries=0) efter etape 2, mens dets 344 race_results overlevede. Mekanikken er
--   en FK-asymmetri:
--     • race_entries.rider_id → riders  =  ON DELETE CASCADE   (entries HARD-slettes)
--     • race_results.rider_id → riders  =  ON DELETE SET NULL  (results bevares)
--   En HARD DELETE af en rytter-række (fx purge-migrationen 2026-06-27
--   "DELETE FROM riders WHERE ... is_retired = true", eller en anden rytter-sletning) hvor
--   rytteren stadig havde entries i et igangværende løb, cascade-slettede derfor entries men
--   bevarede results → etape-scheduleren fejlede hvert tick med "No start list".
--   Purge-migrationens "0 rækker i race_entries"-tjek var et punkt-i-tid-read der ikke
--   fangede en rytter der blev mid-race-relevant senere.
--
-- HVAD DENNE GUARD GØR
--   En BEFORE DELETE-trigger på riders der KASTER hvis rytteren har mindst én race_entry i
--   et løb hvis felt er LÅST (status <> 'completed' AND stages_completed > 0). Så en
--   fremtidig purge/sletning FEJLER LOUD i stedet for tavst at nulstille et aktivt startfelt.
--   Historik (completed-løb) og endnu-ikke-startede løb (stages_completed=0) blokerer IKKE
--   — man må frit slette en rytter hvis entries kun rører åbne eller afsluttede felter.
--
-- HVORFOR TRIGGER OG IKKE FK → RESTRICT
--   At ændre FK'en til RESTRICT ville blokere ALLE rytter-sletninger med entries (også åbne
--   felter), hvilket ville brække legitime purges. En BEFORE DELETE-trigger kan være
--   PRÆCIS: den blokerer kun det farlige tilfælde (igangværende løb) og lader åbne/afsluttede
--   felters cascade køre uændret.
--
-- ⚠️ IKKE-DESTRUKTIV, men den KAN få en fremtidig rytter-purge til at fejle (bevidst —
--    det er guardens formål). Auto-applies i prod ved merge → EJEREN merger PR'en og
--    beslutter om den ønskes. Koden i backend/lib/raceActiveGuard.js lukker allerede
--    app-laget uden denne migration; denne lukker DB-/direkte-SQL-laget.
--
-- IDEMPOTENT: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Re-run = no-op.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_block_rider_delete_inflight ON public.riders;
--   DROP FUNCTION IF EXISTS public.block_rider_delete_with_inflight_entries();

CREATE OR REPLACE FUNCTION public.block_rider_delete_with_inflight_entries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_race_count integer;
BEGIN
  SELECT count(DISTINCT re.race_id) INTO v_race_count
  FROM race_entries re
  JOIN races r ON r.id = re.race_id
  WHERE re.rider_id = OLD.id
    AND r.status <> 'completed'
    AND r.stages_completed > 0;

  IF v_race_count > 0 THEN
    RAISE EXCEPTION
      'block_rider_delete_with_inflight_entries: rytter % kan ikke slettes — har entries i % igangværende løb (låst felt, #2074). Fjern rytteren fra de aktive løb eller vent til de er completed.',
      OLD.id, v_race_count
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_rider_delete_inflight ON public.riders;
CREATE TRIGGER trg_block_rider_delete_inflight
  BEFORE DELETE ON public.riders
  FOR EACH ROW
  EXECUTE FUNCTION public.block_rider_delete_with_inflight_entries();
