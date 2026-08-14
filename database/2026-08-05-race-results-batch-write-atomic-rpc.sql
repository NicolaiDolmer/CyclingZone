-- Fuld-løb/PCM-import atomisk resultat-skrivning via SECURITY DEFINER-RPC (#3022)
-- =============================================================================
--
-- Baggrund (#3022 fejlmode B): to skrivestier deler stadig et delete-then-insert
-- over TO separate PostgREST-kald, ikke i én transaktion:
--
--   - backend/lib/raceRunner.js::simulateRace()      (admin fuld-løbs-simulering)
--   - backend/lib/pcmResultsImport.js::importPcmResults()  (PCM-upload)
--
-- Begge kalder i dag: 1) supabase.from("race_results").delete()...  2) et separat
-- .insert() via applyRaceResults (raceResultsEngine.js). #2898/#2974 tilføjede
-- eksplicit fejltjek på DELETE'et, så et TAVST fejlet delete ikke længere lader
-- insert køre oven på de gamle rækker (fejlmode A — lukket). Men et HÅRDT
-- proces-kill mellem de to HTTP-kald (deploy, timeout, OOM) rammer stadig: DELETE
-- er commitet, INSERT når aldrig at køre → løbet står resultatløst, permanent,
-- indtil nogen manuelt gen-kører (fejlmode B — IKKE lukket af #2898/#2974).
--
-- Præcis samme fejlklasse som #1598 lukkede for PER-ETAPE-stien (apply_stage_result,
-- database/2026-06-21-stage-write-atomic-rpc.sql). Denne migration er samme mønster,
-- anvendt på fuld-løb/PCM-stiens batch (potentielt flere stage_numbers i én skrivning,
-- ingen stages_completed-lås — den counter-baserede lås er specifik for
-- per-etape-akkumuleringen (#2072) og findes ikke i denne kaldeform).
--
-- Løsning: saml DELETE (pr. de berørte etape-numre) + INSERT (de nybyggede rækker)
-- i ÉN Postgres-funktion = ÉN transaktion. Et crash midtvejs ruller HELE
-- skrivningen tilbage — der findes aldrig et øjeblik hvor løbet har mistet sine
-- gamle resultater uden at have fået de nye.
--
-- Denne RPC er UAFHÆNGIG af race_results_entrant_unique-constrainten
-- (2026-08-05-race-results-entrant-key-unique-constraint.sql), men får sin fulde
-- værdi først når den er anvendt: uden constrainten beskytter transaktionen kun
-- MOD tomme mellemtilstande (fejlmode B); MED constrainten kan et bug i JS-laget
-- der genererer to rækker for samme deltager heller ikke smugle en dublet forbi
-- (fejlmode A, forsvaret på to niveauer — DB-constraint + JS-validator i
-- backend/lib/raceResultEntrantKey.js).
--
-- Idempotens: samme delete-then-insert-semantik som i dag — en gen-kørsel af
-- samme p_stage_numbers re-deleter+re-inserter sikkert. CREATE OR REPLACE gør
-- selve migrationen re-runnable.
--
-- SECURITY DEFINER: backend kalder med service_role (samme mønster som
-- apply_stage_result). search_path pinned (advisor 0011-konvention).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.apply_race_results_batch(uuid, integer[], jsonb);

CREATE OR REPLACE FUNCTION public.apply_race_results_batch(
  p_race_id        uuid,
  p_stage_numbers  integer[],  -- etape-numre der IDEMPOTENT ryddes før insert (NULL/tom = intet slettet, ren insert)
  p_result_rows    jsonb       -- array af race_results-rækker, samme kolonne-form som raceResultsEngine.applyRaceResults' normalizedRows
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
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
  -- Spejler dagens JS-logik 1:1 (stagesInRun/stagesInUpload = distinct
  -- stage_number blandt de nye rækker) — kun sendt-med etaper røres, andre
  -- etaper i samme løb er urørte (en gen-upload af én etape wiper ikke resten).
  IF p_stage_numbers IS NOT NULL AND array_length(p_stage_numbers, 1) > 0 THEN
    DELETE FROM public.race_results
      WHERE race_id = p_race_id
        AND stage_number = ANY(p_stage_numbers);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  -- ── Trin 2: insert de nybyggede rækker ─────────────────────────────────────
  -- Kolonne-mapping spejler raceResultsEngine.applyRaceResults' normalizedRows 1:1
  -- (inkl. sprint_points/kom_points/bonus_seconds — #2770-passage-aggregater —
  -- som apply_stage_result's per-etape-variant IKKE inkluderer; denne sti
  -- dækker fuld-løb + PCM, som begge kan bære dem).
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
    COALESCE((r->>'stage_number')::integer, 1),
    r->>'finish_time',
    COALESCE((r->>'prize_money')::bigint, 0),
    COALESCE((r->>'points_earned')::integer, 0),
    COALESCE((r->>'in_breakaway')::boolean, false),
    COALESCE((r->>'breakaway_caught')::boolean, false),
    NULLIF(r->>'sprint_points', '')::integer,
    NULLIF(r->>'kom_points', '')::integer,
    NULLIF(r->>'bonus_seconds', '')::integer
  FROM jsonb_array_elements(p_result_rows) AS r;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Begge trin er nu commitet sammen. Et crash mellem dem ville have rullet HELE
  -- skrivningen tilbage — løbet kan ikke ende resultatløst.
  RETURN jsonb_build_object('rows_deleted', v_deleted, 'rows_inserted', v_inserted);
END;
$$;

-- #3765: REVOKE FROM PUBLIC er IKKE nok. Supabase' ALTER DEFAULT PRIVILEGES
-- granter EXECUTE eksplicit til anon + authenticated ved enhver funktions-
-- oprettelse, og de grants overlever et PUBLIC-revoke (klassen i #2858).
-- Denne funktion er SECURITY DEFINER UDEN intern guard og skriver i
-- race_results — anon-EXECUTE = enhver kan omskrive ethvert løbs resultater.
REVOKE ALL     ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) TO service_role;

-- =============================================================================
-- Verifikation efter migration (forventet output)
-- =============================================================================
--
-- 1) Normal skrivning (delete + insert i én transaktion):
--    SELECT apply_race_results_batch(
--      '<race-id>'::uuid, ARRAY[1],
--      '[{"rider_id":"<rider>","rider_name":"Test Rider","result_type":"gc","rank":1,
--         "stage_number":1,"points_earned":100,"prize_money":100000}]'::jsonb
--    );
--    → forventet: {"rows_deleted": <tidligere antal for etape 1>, "rows_inserted": 1}
--
-- 2) Partial-rollback (insert fejler → DELETE rulles OGSÅ tilbage):
--    -- Send en række med ugyldig result_type (CHECK-violation) efter et forudgående
--    -- write for samme løb/etape:
--    SELECT apply_race_results_batch('<race-id>'::uuid, ARRAY[1],
--      '[{"rider_id":"<rider>","result_type":"INVALID","rank":1,"stage_number":1}]'::jsonb);
--    → forventet: ERROR (result_type CHECK-constraint). Efter fejlen:
--      race_results for (race_id, stage 1) UÆNDRET — hverken slettet eller halvskrevet.
--
-- 3) Dublet afvises af race_results_entrant_unique (kræver den anden migration appliceret):
--    -- To rækker for samme rider_id i samme batch:
--    SELECT apply_race_results_batch('<race-id>'::uuid, ARRAY[1],
--      '[{"rider_id":"<rider>","result_type":"stage","rank":1,"stage_number":1},
--        {"rider_id":"<rider>","result_type":"stage","rank":2,"stage_number":1}]'::jsonb);
--    → forventet: ERROR: duplicate key value violates unique constraint "race_results_entrant_unique".
--      HELE batchen (inkl. DELETE'et af etape 1's tidligere rækker) rulles tilbage.
