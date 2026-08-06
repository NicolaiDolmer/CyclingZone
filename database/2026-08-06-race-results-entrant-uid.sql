-- 2026-08-06 — entrant_uid: stabil deltager-identitet hen over FK-nulstilling (#3416)
-- =============================================================================
--
-- ROD-ÅRSAG (#3416, verificeret mod prod 6/8): #3022's entrant_key falder tilbage
-- til et NAVNE-snapshot når rider_id/team_id er NULL. Men FK'erne er ON DELETE
-- SET NULL — så ved rytter-sletning SKIFTER nøglen fra id-baseret til navnebaseret
-- midt i selve slette-statementet. To ryttere med SAMME navn på SAMME hold (21 hold
-- har sådanne dubletter pga. generator-buggen fikset i samme PR) i samme løbsgruppe
-- kollapser da til én nøgle → unique violation → hele delete rulles tilbage.
-- Konsekvens i prod: aiTeamTrimHealSweep har siden 5/8 ramt fejlen hvert 5. minut
-- på holdet "AI Aero Devo" (127665be, to × "Minjun Han") — ~288 Postgres-fejl/døgn.
--
-- FIX: entrant_uid — et identitets-snapshot (den oprindelige FK-uuid som text) som
-- de eksisterende BEFORE DELETE-navne-snapshot-triggers (#2481) skriver FØR FK'en
-- nulstilles. entrant_key re-defineres til COALESCE(fk_id, entrant_uid, navne-
-- fallback). Nøglen ÆNDRER SIG DERMED ALDRIG ved sletning: før delete = fk-uuid,
-- efter delete = samme uuid fra entrant_uid. Navne-kollisioner kan aldrig mere
-- vælte en delete.
--
-- INGEN BACKFILL: levende rækker (FK sat) bruger FK-grenen; allerede-forældreløse
-- rækker (225.947 pr. 5/8) beholder navne-fallbacken — de var kollisionsfri ved
-- #3022-apply (pre-flight talte 0) og constrainten har håndhævet det siden.
-- Fremtidige sletninger skriver uid og rammer aldrig navne-grenen.
--
-- JS-spejl (SKAL følge 1:1): backend/lib/raceResultEntrantKey.js (computeEntrantKey).
-- Bevist enige af backend/lib/testdb/raceResultsEntrantUnique.integration.test.js,
-- der kører DENNE fil mod PGlite.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE på trigger-funktionerne;
-- entrant_key-genopbygningen springes over hvis genererings-udtrykket allerede
-- refererer entrant_uid (DO-blok-guard) — re-run er et no-op uden table-rewrite.
--
-- ROLLBACK:
--   ALTER TABLE public.race_results DROP CONSTRAINT IF EXISTS race_results_entrant_unique;
--   ALTER TABLE public.race_results DROP COLUMN IF EXISTS entrant_key;
--   ALTER TABLE public.race_results DROP COLUMN IF EXISTS entrant_uid;
--   (+ gen-applicér database/proposals/2026-08-05-race-results-entrant-key-unique-
--   constraint.sql og database/2026-07-16-race-results-orphan-guard.sql for at
--   genskabe #3022-nøglen og de oprindelige trigger-funktioner.)
--
-- VERIFIKATION (efter apply, kør mod prod):
--   1) SELECT pg_get_constraintdef(oid) FROM pg_constraint
--        WHERE conname = 'race_results_entrant_unique';
--      → UNIQUE (race_id, stage_number, result_type, entrant_key)
--   2) Genererings-udtrykket refererer entrant_uid:
--      SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef d
--        JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
--        WHERE d.adrelid = 'public.race_results'::regclass AND a.attname = 'entrant_key';
--   3) Det fastlåste hold heales af næste aiTeamTrimHealSweep-tick (<= 5 min):
--      SELECT count(*) FROM teams WHERE pending_removal_at IS NOT NULL;  → 0
--      og Postgres-loggen viser ikke flere race_results_entrant_unique-fejl.

BEGIN;

-- ── 1) entrant_uid — identitets-snapshot der overlever FK-nulstilling ─────────
ALTER TABLE public.race_results
  ADD COLUMN IF NOT EXISTS entrant_uid text;

-- ── 2) Udvid delete-snapshot-triggerne (#2481) til også at snappe identiteten ─
-- Rytter-sletning: rider-scoped rækker får uid = rytterens uuid. Navne-snapshottet
-- bevarer sin IS NULL-semantik (aldrig overskrivning) via COALESCE.
CREATE OR REPLACE FUNCTION public.snapshot_race_result_rider_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  UPDATE race_results
  SET rider_name = COALESCE(rider_name,
        NULLIF(TRIM(COALESCE(OLD.firstname, '') || ' ' || COALESCE(OLD.lastname, '')), '')),
      entrant_uid = COALESCE(entrant_uid, OLD.id::text)
  WHERE rider_id = OLD.id;
  RETURN OLD;
END;
$$;

-- Hold-sletning: KUN team-scoped rækker (team/team_day) har holdet som identitet —
-- rider-scoped rækker på holdet ejes identitetsmæssigt af rytteren (deres uid
-- sættes af rytter-triggeren når/hvis rytteren slettes).
CREATE OR REPLACE FUNCTION public.snapshot_race_result_team_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  UPDATE race_results
  SET team_name = COALESCE(team_name, OLD.name),
      entrant_uid = CASE
        WHEN result_type IN ('team', 'team_day')
          THEN COALESCE(entrant_uid, OLD.id::text)
        ELSE entrant_uid
      END
  WHERE team_id = OLD.id;
  RETURN OLD;
END;
$$;

-- (Triggerne selv — trg_snapshot_result_names_on_rider_delete/_team_delete —
-- eksisterer allerede og peger på funktionerne; CREATE OR REPLACE er nok.
-- Defensivt: opret dem hvis de mangler, fx i en frisk test-DB.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_snapshot_result_names_on_rider_delete') THEN
    CREATE TRIGGER trg_snapshot_result_names_on_rider_delete
      BEFORE DELETE ON public.riders
      FOR EACH ROW EXECUTE FUNCTION public.snapshot_race_result_rider_name();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_snapshot_result_names_on_team_delete') THEN
    CREATE TRIGGER trg_snapshot_result_names_on_team_delete
      BEFORE DELETE ON public.teams
      FOR EACH ROW EXECUTE FUNCTION public.snapshot_race_result_team_name();
  END IF;
END $$;

-- ── 3) Re-definér entrant_key med entrant_uid-fallback ────────────────────────
-- Genereret kolonne kan ikke ALTER'es in-place → drop + re-add (drop tager
-- unique-constrainten med). Guard: spring HELE genopbygningen over hvis udtrykket
-- allerede refererer entrant_uid (idempotent re-run uden 710k-rækkers rewrite).
DO $$
DECLARE
  v_expr text;
  v_collisions integer;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_expr
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'public.race_results'::regclass
    AND a.attname = 'entrant_key';

  IF v_expr IS NOT NULL AND v_expr LIKE '%entrant_uid%' THEN
    RETURN; -- allerede migreret
  END IF;

  ALTER TABLE public.race_results DROP CONSTRAINT IF EXISTS race_results_entrant_unique;
  ALTER TABLE public.race_results DROP COLUMN IF EXISTS entrant_key;

  ALTER TABLE public.race_results
    ADD COLUMN entrant_key text GENERATED ALWAYS AS (
      CASE
        WHEN result_type IN ('team', 'team_day') THEN
          COALESCE(team_id::text, entrant_uid,
            'team-name:' || lower(btrim(coalesce(team_name, ''))))
        ELSE
          COALESCE(rider_id::text, entrant_uid,
            'rider-name:' || lower(btrim(coalesce(rider_name, ''))) || '::' || lower(btrim(coalesce(team_name, ''))))
      END
    ) STORED;

  -- Pre-flight (samme sikkerhedsnet som #3022): RAISER hvis den nye nøgle
  -- alligevel kolliderer et sted — hele transaktionen rulles da tilbage.
  SELECT count(*) INTO v_collisions FROM (
    SELECT race_id, stage_number, result_type, entrant_key
    FROM public.race_results
    GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
  ) g;
  IF v_collisions > 0 THEN
    RAISE EXCEPTION
      'entrant_uid pre-flight FAILED: % kolliderende gruppe(r) for den nye nøgle — STOP, undersøg FØR constrainten gen-tilføjes (#3416)',
      v_collisions;
  END IF;

  ALTER TABLE public.race_results
    ADD CONSTRAINT race_results_entrant_unique
    UNIQUE (race_id, stage_number, result_type, entrant_key);
END $$;

COMMIT;
