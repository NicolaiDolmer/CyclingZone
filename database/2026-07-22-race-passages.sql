-- Sub-2 (#2770): passage-lag — aggregat-kolonner + passage-detalje-tabel.
-- =============================================================================
--
-- Baggrund: Sub-2 lægger mellemsprint/KOM-konkurrencer som et post-processing-lag
-- oven på race-motoren. Etape-rækkerne i race_results får tre nullable aggregat-
-- kolonner (NULL = legacy-løb uden rute-data, ingen bagudkompatibilitets-brud);
-- detalje-rækkerne (hvem tog hvilken passage, i hvilken rækkefølge, hvor mange
-- point/bonus-sekunder) går i den nye race_stage_passages-tabel, public read
-- via RLS — spejler race_results' egen adgangs-model.
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER MANUELT POST-MERGE (ejer-politik,
-- jf. feedback_migrations_never_auto_apply_via_mcp). Ingen apply_migration/
-- execute_sql er kørt af agenten. Idempotent (ADD COLUMN IF NOT EXISTS,
-- CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + genskab, CREATE OR
-- REPLACE FUNCTION) — sikkert at genafvikle.
--
-- uuid-konvention: nyeste race-relaterede migrationer (2026-07-12-race-v3-s4-
-- incidents.sql, 2026-07-16-race-v3-s6-why-moments.sql) bruger gen_random_uuid()
-- for tabeller der refererer races(id) — samme konvention følges her (races-
-- tabellen selv i schema.sql er ældre og bruger uuid_generate_v4(), men det er
-- ikke længere konventionen for nye race-satellittabeller).

-- ── race_results: nullable aggregat-kolonner (NULL = legacy, ingen rute-data) ─
ALTER TABLE race_results
  ADD COLUMN IF NOT EXISTS sprint_points  integer,
  ADD COLUMN IF NOT EXISTS kom_points     integer,
  ADD COLUMN IF NOT EXISTS bonus_seconds  integer;

-- ── race_stage_passages — passage-detalje pr. (løb, etape, waypoint, rytter) ──
CREATE TABLE IF NOT EXISTS race_stage_passages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  stage_number integer NOT NULL DEFAULT 1,
  waypoint_kind text NOT NULL CHECK (waypoint_kind IN ('kom','sprint','finish')),
  waypoint_index integer NOT NULL,
  waypoint_name text,
  waypoint_km numeric,
  climb_category text,
  rider_id uuid,
  rider_name text,
  team_id uuid,
  passage_rank integer NOT NULL,
  points integer NOT NULL DEFAULT 0,
  bonus_seconds integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_race_stage_passages_race
  ON race_stage_passages (race_id, stage_number);

ALTER TABLE race_stage_passages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "race_stage_passages_public_read" ON race_stage_passages;
CREATE POLICY "race_stage_passages_public_read" ON race_stage_passages
  FOR SELECT USING (true);
-- Ingen insert/update/delete-policies: kun service_role skriver (backend
-- post-processing-lag, samme mønster som race_incidents/race_stage_moments).

-- =============================================================================
-- apply_stage_result: udvidet med sprint_points/kom_points/bonus_seconds
-- =============================================================================
--
-- Base: database/2026-06-21-stage-write-atomic-rpc.sql (funktionens ORIGINALE
-- definition — verificeret nyeste: database/2026-06-29-secure-securitydefiner-
-- rpc-grants.sql rører KUN GRANT/REVOKE på funktionen, ikke funktionskroppen).
-- apply_stage_result enumererer race_results-kolonnerne eksplicit i sin INSERT,
-- så RPC'en skal lære de tre nye kolonner for at backend-skrevne etape-resultater
-- (via applyStageResultAtomic, backend/lib/stageResultRpc.js) kan bære passage-
-- aggregaterne på linje med den ikke-atomære sti.
--
-- Ændring: KUN INSERT-kolonnelisten + SELECT-unpacking udvidet med de tre nye
-- felter. Alt andet (lås-prædikat, delete-then-insert-idempotens, validering,
-- SECURITY DEFINER/search_path-hærdning) er UÆNDRET fra 2026-06-21-versionen.
-- Bevidst INGEN coalesce til 0: NULL fra jsonb (feltet mangler/er null) skal
-- passere som NULL — det er signalet for "legacy-løb uden rute-data", ikke "0
-- point". CREATE OR REPLACE FUNCTION gør migrationen re-runnable (#401).
--
-- Rollback: DROP FUNCTION IF EXISTS public.apply_stage_result(uuid, integer, integer, integer, jsonb);
-- (ville rulle tilbage til 2026-06-21-signaturen — samme signatur, så et rent
-- CREATE OR REPLACE af den gamle krop reetablerer den forrige adfærd 1:1).

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
  -- Sub-2 (#2770): sprint_points/kom_points/bonus_seconds tilføjet — bevidst
  -- IKKE coalesce'et til 0, NULL betyder "legacy/ingen passage-data".
  INSERT INTO public.race_results (
    race_id, rider_id, rider_name, team_id, team_name,
    result_type, rank, stage_number, finish_time,
    prize_money, points_earned, in_breakaway, breakaway_caught,
    sprint_points, kom_points, bonus_seconds
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
    COALESCE((r->>'breakaway_caught')::boolean, false),
    (r->>'sprint_points')::integer,
    (r->>'kom_points')::integer,
    (r->>'bonus_seconds')::integer
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
-- (Uændret fra 2026-06-21-versionen — CREATE OR REPLACE FUNCTION bevarer
-- eksisterende GRANT/REVOKE-tilstand, men gentaget her for idempotens/klarhed
-- hvis funktionen nogensinde genskabes fra bunden.)
REVOKE ALL ON FUNCTION public.apply_stage_result(uuid, integer, integer, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stage_result(uuid, integer, integer, integer, jsonb) TO service_role;

-- =============================================================================
-- Verifikation efter migration (forventet output)
-- =============================================================================
--
-- 1) Kolonner + tabel findes:
--    SELECT column_name FROM information_schema.columns
--      WHERE table_name = 'race_results'
--        AND column_name IN ('sprint_points','kom_points','bonus_seconds');
--    → forventet: 3 rækker.
--    SELECT to_regclass('public.race_stage_passages');
--    → forventet: ikke NULL.
--
-- 2) RLS public read:
--    SELECT * FROM race_stage_passages LIMIT 1;  -- som anon/authenticated
--    → forventet: ingen RLS-fejl (tom resultsæt er OK, adgang er det der testes).
--
-- 3) apply_stage_result med passage-aggregater (NULL-passthrough):
--    SELECT apply_stage_result(
--      '<race-id>'::uuid, 0, 1, 3,
--      '[{"rider_id":"<rider>","result_type":"stage","rank":1,"stage_number":1,
--         "points_earned":50,"prize_money":50000,
--         "sprint_points":6,"kom_points":null,"bonus_seconds":10}]'::jsonb
--    );
--    → forventet: {"lock_won": true, "rows_imported": 1}
--      race_results-rækken har sprint_points=6, kom_points=NULL, bonus_seconds=10.
--
-- 4) Legacy-kald uden passage-felter (bagudkompatibilitet):
--    SELECT apply_stage_result('<race-id>'::uuid, 1, 2, 3,
--      '[{"rider_id":"<rider>","result_type":"stage","rank":1,"stage_number":2}]'::jsonb);
--    → forventet: {"lock_won": true, "rows_imported": 1}
--      race_results-rækken har sprint_points/kom_points/bonus_seconds = NULL
--      (feltet manglede i jsonb → NULLIF/->> giver NULL, ingen coalesce til 0).
--
-- 5) Idempotens — hele migrationen kan genafvikles uden fejl (ADD COLUMN IF NOT
--    EXISTS, CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS + genskab,
--    CREATE OR REPLACE FUNCTION).
