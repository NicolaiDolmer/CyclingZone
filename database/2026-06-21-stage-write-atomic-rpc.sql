-- Per-stage atomic result-write (counter + race_results) via SECURITY DEFINER RPC (#1598)
-- =============================================================================
--
-- Baggrund (#1598, follow-up fra Fase-3-hærdning #1574):
--   simulateStageByIndex() i backend/lib/raceRunner.js skriver en etape i 3 trin:
--     1. Optimistisk lås: UPDATE races SET stages_completed = stageNumber
--        WHERE id = race AND stages_completed = stageIndex  (vinder/taber-race)
--     2. Idempotent: DELETE race_results for (race_id, stage_number)
--     3. INSERT de nybyggede race_results-rækker for etapen
--   (standings-recompute + fatigue + finalization kører EFTER og er hver for sig
--    idempotente self-healing re-derivations — de er ikke en del af desync-risikoen).
--
--   Residual-risiko (#1598): et HÅRDT proces-kill PRÆCIS mellem trin 1 (counter-bump)
--   og trin 3 (result-write) på en MELLEM-etape kan efterlade stages_completed FORAN
--   tomme race_results for etapen. JS-stien ruller counteren tilbage ved in-process-fejl,
--   men et OS-/container-kill mellem to round-trips er uden for JS' rækkevidde. Det er
--   et SMALT vindue (nu kun ét enkelt skriv væk), men ikke nul.
--
-- Løsning:
--   Saml de tre trin der MÅ være konsistente med hinanden — counter-bump + race_results
--   delete + race_results insert — i ÉN Postgres-funktion, dvs. ÉN DB-transaktion. Et
--   crash mellem trinene ruller HELE skrivningen tilbage (counter uændret, ingen
--   partial race_results). Den optimistiske lås bevares 1:1 (samme WHERE-prædikat),
--   så konkurrence-semantikken (dobbelt-klik / admin + scheduler) er uændret: taberen
--   ser p_lock_won=false og afbryder FØR side-effekter — præcis som i dag.
--
--   Balance-NEUTRAL: funktionen ændrer INTET ved race-resultater, point, standings-
--   matematik eller motor-output. Den ændrer KUN ATOMICITETEN af hvordan de eksisterende
--   skrivninger persisteres. Standings-recompute (updateStandings) er bevidst HOLDT
--   UDENFOR — den er en fuld re-derivation fra race_results, inhærent idempotent og
--   self-healing, og var aldrig en del af counter↔results-desync'en.
--
-- Idempotens (samme delete-then-insert-semantik som i dag):
--   Ved p_lock_won=true sletter funktionen først etapens race_results og inserter så
--   de medsendte rækker — en gen-afvikling af samme stageIndex re-deleter+re-inserter
--   sikkert. CREATE OR REPLACE FUNCTION gør selve migrationen re-runnable (#401).
--
-- SECURITY DEFINER: backend kalder med service_role (SUPABASE_SERVICE_KEY, både cron-
--   scheduler og admin-stien). service_role bypasser RLS uanset; DEFINER + pinned
--   search_path følger samme hærdnings-konvention som de øvrige write-RPC'er (advisor
--   0011 — undgå at et re-run nulstiller search_path).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.apply_stage_result(uuid, integer, integer, integer, jsonb);

CREATE OR REPLACE FUNCTION public.apply_stage_result(
  p_race_id         uuid,
  p_stage_index     integer,  -- 0-indekseret forventet nuværende stages_completed (lås-prædikat)
  p_stage_number    integer,  -- 1-indekseret etape der skrives (counter sættes hertil)
  p_total_stages    integer,  -- antal etaper i løbet (input-validering)
  p_result_rows     jsonb     -- array af race_results-rækker for PRÆCIS denne etape
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Forward-guard (#927): hold search_path pinned så et re-run ikke nulstiller
-- hærdningen (advisor 0011).
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_locked_id uuid;
  v_row_count integer;
  v_inserted  integer := 0;
BEGIN
  -- Input-validering (defense-in-depth — JS-laget validerer også).
  IF p_race_id IS NULL THEN
    RAISE EXCEPTION 'race_id required';
  END IF;
  IF p_stage_index IS NULL OR p_stage_index < 0 THEN
    RAISE EXCEPTION 'stage_index must be a non-negative integer';
  END IF;
  IF p_stage_number IS NULL OR p_stage_number < 1 THEN
    RAISE EXCEPTION 'stage_number must be a positive integer';
  END IF;
  -- p_total_stages er valgfri (NULL = spring over); når sat skal etapen ligge inden for løbet.
  IF p_total_stages IS NOT NULL AND p_stage_number > p_total_stages THEN
    RAISE EXCEPTION 'stage_number % exceeds total_stages %', p_stage_number, p_total_stages;
  END IF;
  IF p_result_rows IS NULL OR jsonb_typeof(p_result_rows) <> 'array' THEN
    RAISE EXCEPTION 'result_rows must be a JSON array';
  END IF;

  v_row_count := jsonb_array_length(p_result_rows);
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'At least one result row required';
  END IF;
  -- Loft som submit_race_results (#518): én etape kan ikke realistisk overstige dette.
  IF v_row_count > 2000 THEN
    RAISE EXCEPTION 'Too many result rows (max 2000)';
  END IF;

  -- ── Trin 1: optimistisk lås (uændret prædikat fra JS FIX 5) ────────────────
  -- Bumper stages_completed fra p_stage_index → p_stage_number. Kun den FØRSTE
  -- samtidige afvikling for samme løb vinder WHERE stages_completed = p_stage_index.
  -- status sættes IKKE her (FIX 1: status flippes sidst, efter finalization, i JS).
  UPDATE public.races
    SET stages_completed = p_stage_number
    WHERE id = p_race_id
      AND stages_completed = p_stage_index
    RETURNING id INTO v_locked_id;

  IF v_locked_id IS NULL THEN
    -- Konkurrent vandt (eller counteren er allerede forbi denne etape). INGEN
    -- side-effekter kørt → returnér lock_won=false. JS afbryder uden dobbelt-
    -- anvendelse, præcis som i dag.
    RETURN jsonb_build_object('lock_won', false, 'rows_imported', 0);
  END IF;

  -- ── Trin 2: idempotent delete af PRÆCIS denne etapes race_results ──────────
  -- En gen-afvikling af samme stageIndex re-deleter+re-inserter sikkert.
  DELETE FROM public.race_results
    WHERE race_id = p_race_id
      AND stage_number = p_stage_number;

  -- ── Trin 3: insert de nybyggede rækker for etapen ─────────────────────────
  -- Kolonne-mapping spejler raceResultsEngine.applyRaceResults' normalizedRows 1:1
  -- (inkl. #1499's deskriptive udbruds-flag in_breakaway/breakaway_caught, så
  -- RPC-stien persisterer dem på linje med den ikke-atomære full-race-sti).
  INSERT INTO public.race_results (
    race_id, rider_id, rider_name, team_id, team_name,
    result_type, rank, stage_number, finish_time,
    prize_money, points_earned, in_breakaway, breakaway_caught
  )
  SELECT
    p_race_id,
    NULLIF(r->>'rider_id', '')::uuid,
    r->>'rider_name',
    NULLIF(r->>'team_id', '')::uuid,
    r->>'team_name',
    r->>'result_type',
    (r->>'rank')::integer,
    COALESCE((r->>'stage_number')::integer, p_stage_number),
    r->>'finish_time',
    COALESCE((r->>'prize_money')::bigint, 0),
    COALESCE((r->>'points_earned')::integer, 0),
    COALESCE((r->>'in_breakaway')::boolean, false),
    COALESCE((r->>'breakaway_caught')::boolean, false)
  FROM jsonb_array_elements(p_result_rows) AS r;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Alle tre trin er nu commitet sammen (samme transaktion). Et crash mellem
  -- trinene ville have rullet HELE skrivningen tilbage → counter↔results kan
  -- ikke desynce.
  RETURN jsonb_build_object('lock_won', true, 'rows_imported', v_inserted);
END;
$$;

-- Backend kalder med service_role (cron-scheduler + admin-stien). authenticated
-- tilføjes for paritet med de øvrige write-RPC'er; SECURITY DEFINER + service_role-
-- only-callere i praksis. PostgREST-eksponering kræver eksplicit GRANT EXECUTE.
REVOKE ALL ON FUNCTION public.apply_stage_result(uuid, integer, integer, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stage_result(uuid, integer, integer, integer, jsonb) TO service_role;

-- =============================================================================
-- Verifikation efter migration (forventet output)
-- =============================================================================
--
-- 1) Normal mellem-etape (lås vindes, rækker skrives):
--    SELECT apply_stage_result(
--      '<race-id>'::uuid, 0, 1, 3,
--      '[{"rider_id":"<rider>","result_type":"stage","rank":1,"stage_number":1,
--         "points_earned":50,"prize_money":50000}]'::jsonb
--    );
--    → forventet: {"lock_won": true, "rows_imported": 1}
--      races.stages_completed = 1, race_results har etape-1-rækken.
--
-- 2) Konkurrent taber låsen (stages_completed != p_stage_index):
--    -- Kald igen med p_stage_index=0 efter stages_completed allerede er 1:
--    SELECT apply_stage_result('<race-id>'::uuid, 0, 1, 3, '[...]'::jsonb);
--    → forventet: {"lock_won": false, "rows_imported": 0}
--      INGEN race_results rørt, counter uændret.
--
-- 3) Partial-rollback (insert fejler → ALT ruller tilbage):
--    -- Send en række med ugyldig result_type (CHECK-violation) efter en gyldig:
--    SELECT apply_stage_result('<race-id>'::uuid, 0, 1, 3,
--      '[{"rider_id":"<rider>","result_type":"INVALID","rank":1}]'::jsonb);
--    → forventet: ERROR (result_type CHECK-constraint). Efter fejlen:
--      races.stages_completed UÆNDRET (counter ikke bumpet), race_results UÆNDRET.
--      Hele transaktionen (counter-bump + delete + insert) er rullet tilbage.
