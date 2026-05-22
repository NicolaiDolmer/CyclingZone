-- Race-result submit: atomic RPC + tightened RLS on child rows (#518)
-- =============================================================================
--
-- Baggrund:
-- Code-audit 2026-05-20 (issue #518) fandt 2 problemer i race-result upload:
--   1. Atomicity: frontend submitResults() i RacesPage.jsx kalder først
--      supabase.from("pending_race_results").insert() og DEREFTER
--      supabase.from("pending_race_result_rows").insert(rows) — to separate
--      kald uden transaction. Hvis child-insert fejler → orphan parent row.
--   2. RLS: pending_race_result_rows har INSERT WITH CHECK (true) og
--      SELECT USING (true) — enhver authenticated user (eller anon) kan:
--        - se alle pending result rows (incl. andres submissions)
--        - inserte rows tilknyttet hvilket som helst pending_id
--      Sidste rls_policy_always_true advisor-warning (verificeret 2026-05-22).
--
-- Fix:
--   1. Ny RPC public.submit_race_results(p_race_id, p_rows jsonb) der inserter
--      parent + alle child-rows i én transaction. SECURITY INVOKER, så caller's
--      auth.uid() bruges og RLS-policies på begge tabeller stadig håndhæves.
--   2. Drop permissive policies på pending_race_result_rows. Erstat med
--      owner-or-admin-gated policies der joiner til parent for at finde
--      submitted_by. is_admin() (SECURITY DEFINER fra #548) bruges til
--      konsistens med nylige migrations.
--   3. Tilføj index på pending_id for at undgå seq-scan ved RLS-check (FK
--      har ikke automatisk index i Postgres).
--
-- Backend impact:
--   approve-results endpoint (backend/routes/api.js:2485) bruger service_role
--   client → bypasser RLS uanset. Approve/reject workflow upåvirket.
--
-- Frontend impact:
--   submitResults() i RacesPage.jsx skal skifte fra 2x .insert() til
--   .rpc("submit_race_results", ...). Read-paths bevares: PendingSubmission
--   læser rows via parent-join eller eq("pending_id") — ny SELECT-policy
--   tillader owner-or-admin, hvilket dækker både submitter og admin-godkender.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY, CREATE OR REPLACE FUNCTION,
-- CREATE INDEX IF NOT EXISTS. Safe at replay.

BEGIN;

-- =============================================================================
-- 1. Index på pending_id (RLS-perf + FK lookup)
-- =============================================================================
CREATE INDEX IF NOT EXISTS pending_race_result_rows_pending_id_idx
  ON public.pending_race_result_rows (pending_id);

-- =============================================================================
-- 2. Atomic RPC: submit_race_results
-- =============================================================================
-- SECURITY INVOKER: kører som caller. RLS på begge tabeller håndhæves stadig.
-- Inden for samme transaction ser child-insert den lige-indsatte parent row
-- (read-after-write inden for transaction, uanset isolation level).
CREATE OR REPLACE FUNCTION public.submit_race_results(
  p_race_id uuid,
  p_rows jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pending_id uuid;
  v_user_id uuid;
  v_row_count int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_race_id IS NULL THEN
    RAISE EXCEPTION 'race_id required';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows must be a JSON array';
  END IF;

  v_row_count := jsonb_array_length(p_rows);
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'At least one row required';
  END IF;
  IF v_row_count > 500 THEN
    RAISE EXCEPTION 'Too many rows (max 500)';
  END IF;

  -- Insert parent (RLS: "Managers can insert pending results" kræver
  -- auth.uid() = submitted_by — vi sætter submitted_by = v_user_id).
  INSERT INTO public.pending_race_results (race_id, submitted_by, status)
  VALUES (p_race_id, v_user_id, 'pending')
  RETURNING id INTO v_pending_id;

  -- Insert children (RLS: ny "Owner or admin insert pending rows" policy
  -- joiner til parent og verificerer submitted_by = auth.uid()).
  INSERT INTO public.pending_race_result_rows
    (pending_id, rider_id, result_type, rank, stage_number)
  SELECT
    v_pending_id,
    (r->>'rider_id')::uuid,
    r->>'result_type',
    (r->>'rank')::int,
    COALESCE((r->>'stage_number')::int, 1)
  FROM jsonb_array_elements(p_rows) r;

  RETURN v_pending_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_race_results(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_race_results(uuid, jsonb) TO authenticated;

-- =============================================================================
-- 3. Lockdown af pending_race_result_rows policies
-- =============================================================================
-- Pre-state (advisor rls_policy_always_true):
--   INSERT "Insert pending rows": WITH CHECK (true) — anyone can insert any row
--   SELECT "Read pending rows":   USING (true)      — anyone can read all rows
-- Post-state: owner-or-admin gated via join til parent.

DROP POLICY IF EXISTS "Insert pending rows" ON public.pending_race_result_rows;
DROP POLICY IF EXISTS "Read pending rows" ON public.pending_race_result_rows;
DROP POLICY IF EXISTS "Owner or admin insert pending rows" ON public.pending_race_result_rows;
DROP POLICY IF EXISTS "Owner or admin read pending rows" ON public.pending_race_result_rows;

CREATE POLICY "Owner or admin insert pending rows"
  ON public.pending_race_result_rows
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pending_race_results p
      WHERE p.id = pending_race_result_rows.pending_id
        AND p.submitted_by = auth.uid()
    )
    OR public.is_admin()
  );

CREATE POLICY "Owner or admin read pending rows"
  ON public.pending_race_result_rows
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pending_race_results p
      WHERE p.id = pending_race_result_rows.pending_id
        AND (p.submitted_by = auth.uid() OR public.is_admin())
    )
  );

-- UPDATE/DELETE admin-policies bevares uændrede (allerede admin-only).

COMMIT;

-- =============================================================================
-- Verifikation efter migration (forventet output)
-- =============================================================================
--
-- 1) Random auth user SELECT mod andres rows:
--    SET LOCAL role = authenticated; SET LOCAL request.jwt.claim.sub = '<other-uuid>';
--    SELECT COUNT(*) FROM pending_race_result_rows WHERE pending_id = '<existing-id>';
--    → forventet: 0 (ny SELECT-policy blokerer)
--
-- 2) Random auth user INSERT i rows med fake pending_id:
--    SET LOCAL role = authenticated; SET LOCAL request.jwt.claim.sub = '<random-uuid>';
--    INSERT INTO pending_race_result_rows (pending_id, rider_id, result_type, rank)
--    VALUES ('<existing-pending-id>', '<rider>', 'stage', 1);
--    → forventet: ERROR: new row violates row-level security policy
--
-- 3) Manager submit via RPC:
--    SET LOCAL role = authenticated; SET LOCAL request.jwt.claim.sub = '<manager-uuid>';
--    SELECT submit_race_results(
--      '<race-id>'::uuid,
--      '[{"rider_id":"<rider>","result_type":"stage","rank":1,"stage_number":1}]'::jsonb
--    );
--    → forventet: returnerer ny pending_id, både parent + row inserted atomic
--
-- 4) Advisor rerun:
--    pending_race_result_rows.Insert pending rows skal være FJERNET fra
--    rls_policy_always_true (sidste forekomst).
