-- #6185 (del 1): tredje udbrudstilstand "sat af fra udbruddet" i race_results.
--
-- race_results.breakaway_caught er NOT NULL og kan kun baere to tilstande
-- (indhentet / ikke indhentet). En udbryder der blev sat af fra udbruddet
-- endte derfor som "ikke indhentet" = vist som "holdt hjem".
--
-- Mindste datamodel: EN ny nullable kolonne ved siden af den gamle.
--   breakaway_dropped = true  -> sat af fra udbruddet
--   breakaway_dropped = false -> vurderet, ikke sat af (holdt hjem / indhentet / ikke udbryder)
--   breakaway_dropped = NULL  -> ikke vurderet (legacy, v3, PCM-import)
-- breakaway_caught beholder sin betydning og sin NOT NULL, saa de mange
-- eksisterende laesere er uaendrede.
--
-- Additiv og idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE af de
-- to skrive-RPC'er med PRAECIS samme krop som i prod (5/10) og kun den nye
-- kolonne tilfoejet (NULL naar noeglen mangler, aldrig coalesce til false).
-- Grants bevares af CREATE OR REPLACE. Ingen data roeres her; backfill af
-- koerte v4-etaper er et separat script med dry-run
-- (backend/scripts/backfill-6185-dropped-breakaway.js).
--
-- Lock-timeout (praecedens: 2026-09-04-4754): race_results er en varm tabel.
-- ADD COLUMN er metadata-only (nullable, uden default), men kraever et kort
-- ACCESS EXCLUSIVE-lock. SET LOCAL lock_timeout = '3s' faar migrationen til at
-- fejle hurtigt (og kan koeres igen), i stedet for at staa i koe bag en lang
-- transaktion og blokere alle laesere og skrivere af race_results imens.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.race_results
  ADD COLUMN IF NOT EXISTS breakaway_dropped boolean;

COMMENT ON COLUMN public.race_results.breakaway_dropped IS
  '#6185: true = escapee dropped from the break before the line; false = assessed, not dropped; NULL = not assessed.';

CREATE OR REPLACE FUNCTION public.apply_race_results_batch(p_race_id uuid, p_stage_numbers integer[], p_result_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_row_count integer;
  v_deleted   integer := 0;
  v_inserted  integer := 0;
BEGIN
  IF p_race_id IS NULL THEN
    RAISE EXCEPTION 'race_id required';
  END IF;
  IF p_result_rows IS NULL OR jsonb_typeof(p_result_rows) <> 'array' THEN
    RAISE EXCEPTION 'result_rows must be a JSON array';
  END IF;

  v_row_count := jsonb_array_length(p_result_rows);
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'At least one result row required';
  END IF;
  -- Et helt løb (alle etaper, alle klassementer) kan have langt flere rækker end
  -- én enkelt etape (apply_stage_result's loft på 2000) — 5000 dækker selv de
  -- største Grand Tour-simuleringer med margin.
  IF v_row_count > 5000 THEN
    RAISE EXCEPTION 'Too many result rows (max 5000)';
  END IF;

  -- ── Trin 1: idempotent delete af PRÆCIS de berørte etape-numre ────────────
  IF p_stage_numbers IS NOT NULL AND array_length(p_stage_numbers, 1) > 0 THEN
    DELETE FROM public.race_results
      WHERE race_id = p_race_id
        AND stage_number = ANY(p_stage_numbers);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  -- ── Trin 2: insert de nybyggede rækker ─────────────────────────────────────
  -- Kolonne-mapping spejler raceResultsEngine.applyRaceResults' normalizedRows 1:1.
  -- #6185: breakaway_dropped bevidst UDEN coalesce (NULL = ikke vurderet).
  INSERT INTO public.race_results (
    race_id, rider_id, rider_name, team_id, team_name,
    result_type, rank, stage_number, finish_time,
    prize_money, points_earned, in_breakaway, breakaway_caught, breakaway_dropped,
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
    COALESCE((r->>'stage_number')::integer, 1),
    r->>'finish_time',
    COALESCE((r->>'prize_money')::bigint, 0),
    COALESCE((r->>'points_earned')::integer, 0),
    COALESCE((r->>'in_breakaway')::boolean, false),
    COALESCE((r->>'breakaway_caught')::boolean, false),
    (r->>'breakaway_dropped')::boolean,
    NULLIF(r->>'sprint_points', '')::integer,
    NULLIF(r->>'kom_points', '')::integer,
    NULLIF(r->>'bonus_seconds', '')::integer
  FROM jsonb_array_elements(p_result_rows) AS r;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('rows_deleted', v_deleted, 'rows_inserted', v_inserted);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_stage_result(p_race_id uuid, p_stage_index integer, p_stage_number integer, p_total_stages integer, p_result_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  UPDATE public.races
    SET stages_completed = p_stage_number
    WHERE id = p_race_id
      AND stages_completed = p_stage_index
    RETURNING id INTO v_locked_id;

  IF v_locked_id IS NULL THEN
    RETURN jsonb_build_object('lock_won', false, 'rows_imported', 0);
  END IF;

  -- ── Trin 2: idempotent delete af PRÆCIS denne etapes race_results ──────────
  DELETE FROM public.race_results
    WHERE race_id = p_race_id
      AND stage_number = p_stage_number;

  -- ── Trin 3: insert de nybyggede rækker for etapen ─────────────────────────
  -- Kolonne-mapping spejler raceResultsEngine.applyRaceResults' normalizedRows 1:1.
  -- #6185: breakaway_dropped bevidst UDEN coalesce (NULL = ikke vurderet).
  INSERT INTO public.race_results (
    race_id, rider_id, rider_name, team_id, team_name,
    result_type, rank, stage_number, finish_time,
    prize_money, points_earned, in_breakaway, breakaway_caught, breakaway_dropped,
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
    (r->>'breakaway_dropped')::boolean,
    (r->>'sprint_points')::integer,
    (r->>'kom_points')::integer,
    (r->>'bonus_seconds')::integer
  FROM jsonb_array_elements(p_result_rows) AS r;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('lock_won', true, 'rows_imported', v_inserted);
END;
$function$;

-- SECURITY DEFINER uden intern guard: EXECUTE forbliver service_role-only
-- (#3765/#2858). CREATE OR REPLACE bevarer grants; gentaget her eksplicit og idempotent.
REVOKE ALL     ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) TO service_role;
REVOKE ALL     ON FUNCTION public.apply_stage_result(uuid, integer, integer, integer, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_stage_result(uuid, integer, integer, integer, jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_stage_result(uuid, integer, integer, integer, jsonb) TO service_role;

COMMIT;
