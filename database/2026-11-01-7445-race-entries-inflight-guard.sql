-- database/2026-11-01-7445-race-entries-inflight-guard.sql
-- #7445 (ejer-go 1/11): DB-vagt - ingen skrivning i race_entries for et loeb der er i gang.
--
-- HVORFOR: #7389 (Volta Algarvia 30/10) - entry-generatorens per-enheds-fallback skrev
-- forbi line-up-frysningen og udskiftede 102 ryttere midt i et etapeloeb. #7436 genlaeser
-- loebene foer fallbacken, men et lille vindue er tilbage, og kun apply_race_entry_unit_batch
-- haandhaever frysningen i SQL. Denne trigger er bagstoppet for ALLE skrivestier.
--
-- KORTLAEGNING (kommentar paa #7445 1/11): ingen legitim sti skriver bevidst i et loeb der
-- er i gang. Loebsstartens autofyld/prune skriver ved etape 1, mens stages_completed = 0;
-- den rammes derfor ikke af "i gang" herunder.
--
-- REGLEN (raekke for raekke, NEW.race_id ved INSERT/UPDATE, OLD.race_id ved UPDATE/DELETE):
--   * I gang   = coalesce(stages_completed,0) > 0 AND status <> 'completed' -> alt afvises.
--   * Afsluttet = status = 'completed' -> INSERT/UPDATE afvises; DELETE tilladt
--                 (hold-/kalender-oprydning af gamle loeb via kaskade).
--   * Loebet findes ikke (kaskade fra sletning af selve loebet) -> tilladt.
--   * UPDATE der kun aendrer binding_span (binding-resync-triggerne, fx naar raceRunner
--     saetter status='completed') -> altid tilladt.
--   * Sletning af et hold midt i et loeb afvises (som clearAllAiTeams' udskydelse, #4753).
--   * Undtagelse til admin-genopretning: set_config('cz.race_entries_inflight_override','on',true)
--     i samme transaktion -> tilladt (NOTICE). Ingen kode bruger den i dag.
-- Fejltekst starter med 'race_entries_inflight' (raceEntryGenerator.js springer enheden over).
--
-- NAVNET: Postgres fyrer samme-tidspunkts-triggere alfabetisk; "race_entries_a_..." koerer
-- foer de eksisterende guards (spent_day tager advisory locks), saa en afvisning er billig.
--
-- IDEMPOTENT: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Ingen raekker muteres.
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS race_entries_a_inflight_guard ON public.race_entries;
--   DROP FUNCTION IF EXISTS public.guard_race_entries_inflight();

CREATE OR REPLACE FUNCTION public.guard_race_entries_inflight()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_race_ids uuid[];
  v_race record;
BEGIN
  IF coalesce(current_setting('cz.race_entries_inflight_override', true), '') = 'on' THEN
    RAISE NOTICE 'race_entries_inflight: override aktiv (% paa race_entries)', TG_OP;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Binding-resync (trg_races_status_resync_binding, race_stage_schedule_ og
  -- race_withdrawals_resync_binding, #3934/#4173) skriver KUN binding_span - ogsaa naar et
  -- loeb saettes til 'completed' eller genaabnes. Det er afledt data, ikke en ny udtagelse,
  -- og maa aldrig blokeres (ellers ruller hver loebsafslutning tilbage).
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'binding_span') = (to_jsonb(OLD) - 'binding_span') THEN
    RETURN NEW;
  END IF;

  v_race_ids := CASE TG_OP
    WHEN 'INSERT' THEN ARRAY[NEW.race_id]
    WHEN 'DELETE' THEN ARRAY[OLD.race_id]
    ELSE ARRAY[OLD.race_id, NEW.race_id]
  END;

  -- FOR SHARE (Codex P1): et almindeligt SELECT kunne laese stages_completed = 0, mens
  -- apply_stage_result er ved at committe etape 1, og lade skrivningen committe bagefter.
  -- Delt raekkelaas venter paa en igangvaerende etape-UPDATE og blokerer en ny, til
  -- entry-transaktionen er faerdig. Delte laase er indbyrdes forenelige (sweepet skriver
  -- mange raekker for samme loeb); ORDER BY id giver fast laaserakkefoelge mod deadlock.
  FOR v_race IN
    SELECT id, status, coalesce(stages_completed, 0) AS done
      FROM public.races WHERE id = ANY(v_race_ids)
      ORDER BY id FOR SHARE
  LOOP
    IF v_race.done > 0 AND v_race.status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'race_entries_inflight: race % is in progress (% blocked)', v_race.id, TG_OP
        USING ERRCODE = 'P0001';
    END IF;
    IF v_race.status = 'completed' AND TG_OP <> 'DELETE' THEN
      RAISE EXCEPTION 'race_entries_inflight: race % is completed (% blocked)', v_race.id, TG_OP
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_race_entries_inflight() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_race_entries_inflight() TO service_role;

DROP TRIGGER IF EXISTS race_entries_a_inflight_guard ON public.race_entries;
CREATE TRIGGER race_entries_a_inflight_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.race_entries FOR EACH ROW EXECUTE FUNCTION public.guard_race_entries_inflight();
