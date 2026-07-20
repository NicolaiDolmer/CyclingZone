-- =============================================================================
-- Rytter-progression: atomisk pr. rytter (#2361, PR-C af progression-atomicitet)
-- =============================================================================
-- PROBLEM: backend/lib/riderProgressionEngine.js (#1137) skrev
-- rider_development_log FØRST for ALLE ryttere (idempotens-guard), og DEREFTER
-- rider_derived_abilities + riders i to separate batch-update-loops. Fejlede en
-- riders-update midt i batchen (fx netværks-timeout, en enkelt konstraint-fejl),
-- var dev-loggen allerede skrevet for ALLE ryttere → en re-run sprang ALLE over
-- (alreadyDeveloped-filteret), og de fejlede rytteres nye evne/base_value/
-- pensionering blev ALDRIG anvendt — men loggen sagde "udviklet". Uoprettelig
-- inkonsistens, og denne motor kører UIGENKALDELIGT mod hele spillerbasen
-- (~6.939 ryttere) ved hvert sæsonskifte.
--
-- LØSNING: apply_rider_development(...) binder "logget" og "anvendt" atomisk —
-- INSERT i rider_development_log (samme UNIQUE(rider_id,season_id)-guard som
-- før, ON CONFLICT DO NOTHING) + UPDATE rider_derived_abilities + UPDATE riders
-- sker i ÉN Postgres-funktions-kald, altså ÉN transaktion. Rækkefølgen inde i
-- funktionen betyder intet for atomicitet (PostgREST/RPC-kald er implicit i
-- transaktion), men INSERT'en først lader os læse ROW_COUNT og bailer FØR
-- evner/rytter røres, hvis rækken allerede fandtes (race mod en anden samtidig
-- kørsel — den almindelige re-run-sti fanges allerede af engine'ns eget
-- alreadyDeveloped-forfilter før RPC'en overhovedet kaldes).
--
-- KRITISK (undgået naiv fejl): at bare FLYTTE log-skrivningen til sidst uden
-- INSERT-guarden ville IKKE løse problemet — riderProgression.developRiderSeason
-- udvikler fra rytterens NUVÆRENDE evner, så en re-run uden guard ville læse de
-- allerede-rykkede evner og udvikle rytteren IGEN (dobbelt-udvikling). Guarden
-- (INSERT ... ON CONFLICT DO NOTHING → ROW_COUNT) er selve mekanismen der
-- forhindrer det, nu blot atomisk sammen med mutationen i stedet for adskilt.
--
-- CALLER: backend/lib/riderProgressionEngine.js kalder denne RPC pr. rytter i en
-- runBatched(..., 25, ...)-løkke (samme concurrency som før) via service-role
-- Supabase-klienten. Fejler ét kald, kaster engine'n straks — alle FORUDGÅENDE
-- kald i den løkke er allerede committet atomisk (logget OG anvendt sammen).
--
-- SIKKERHED: SECURITY DEFINER (skal kunne skrive uafhængigt af RLS på alle tre
-- tabeller) + intern service_role-gate (samme mønster som dashboard_rider_ranking,
-- 2026-07-19-dashboard-rider-ranking-rpc.sql) + eksplicit REVOKE fra anon/
-- authenticated/PUBLIC (Supabase' ALTER DEFAULT PRIVILEGES gen-granter ellers
-- EXECUTE til anon/authenticated ved funktions-oprettelse — samme klasse som
-- #2676/#2671, se 2026-07-19-revoke-rpc-grants-2676.sql).
--
-- Kolonneliste for rider_derived_abilities verificeret read-only mod prod
-- (information_schema.columns) 2026-07-20: alle 15 VISIBLE_ABILITIES-kolonner
-- (backend/lib/abilityDerivation.js) findes som smallint-kolonner; ability_caps
-- er jsonb. riders.base_value/current_production_value er integer → evne-/
-- værdi-patches rundes eksplicit (ROUND(...)::smallint / ::integer) i stedet for
-- at stole på en implicit numeric→heltal-assignment-cast.
--
-- Idempotent DDL (CREATE OR REPLACE). Ingen data muteres af selve migrationen.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.apply_rider_development(uuid, uuid, integer, jsonb, jsonb, jsonb);
--   -- (rul samtidig riderProgressionEngine.js tilbage til den upsert+batch-update-
--   --  version fra før #2361 — RPC'en og callsite'et hænger sammen)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.apply_rider_development(
  p_rider_id uuid,
  p_season_id uuid,
  p_season_number integer,
  p_ability_patch jsonb,
  p_rider_patch jsonb,
  p_log jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- ── 1) Idempotens-guard + snapshot, atomisk i samme transaktion som mutationen ──
  INSERT INTO public.rider_development_log
    (rider_id, season_id, season_number, age, abilities, base_value, retired_this_season)
  VALUES (
    p_rider_id, p_season_id, p_season_number,
    (p_log->>'age')::integer,
    p_log->'abilities',
    (p_log->>'base_value')::integer,
    COALESCE((p_log->>'retired_this_season')::boolean, false)
  )
  ON CONFLICT (rider_id, season_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    -- Allerede udviklet (race mod en anden samtidig kørsel) — INGEN mutation.
    RETURN false;
  END IF;

  -- ── 2) Evner (kun de nøgler der er sendt; COALESCE bevarer resten uændret) ─────
  UPDATE public.rider_derived_abilities SET
    climbing     = COALESCE(ROUND((p_ability_patch->>'climbing')::numeric)::smallint, climbing),
    time_trial   = COALESCE(ROUND((p_ability_patch->>'time_trial')::numeric)::smallint, time_trial),
    flat         = COALESCE(ROUND((p_ability_patch->>'flat')::numeric)::smallint, flat),
    tempo        = COALESCE(ROUND((p_ability_patch->>'tempo')::numeric)::smallint, tempo),
    sprint       = COALESCE(ROUND((p_ability_patch->>'sprint')::numeric)::smallint, sprint),
    acceleration = COALESCE(ROUND((p_ability_patch->>'acceleration')::numeric)::smallint, acceleration),
    punch        = COALESCE(ROUND((p_ability_patch->>'punch')::numeric)::smallint, punch),
    endurance    = COALESCE(ROUND((p_ability_patch->>'endurance')::numeric)::smallint, endurance),
    recovery     = COALESCE(ROUND((p_ability_patch->>'recovery')::numeric)::smallint, recovery),
    durability   = COALESCE(ROUND((p_ability_patch->>'durability')::numeric)::smallint, durability),
    descending   = COALESCE(ROUND((p_ability_patch->>'descending')::numeric)::smallint, descending),
    cobblestone  = COALESCE(ROUND((p_ability_patch->>'cobblestone')::numeric)::smallint, cobblestone),
    positioning  = COALESCE(ROUND((p_ability_patch->>'positioning')::numeric)::smallint, positioning),
    aggression   = COALESCE(ROUND((p_ability_patch->>'aggression')::numeric)::smallint, aggression),
    tactics      = COALESCE(ROUND((p_ability_patch->>'tactics')::numeric)::smallint, tactics),
    ability_caps = COALESCE(p_ability_patch->'ability_caps', ability_caps)
  WHERE rider_id = p_rider_id;

  -- ── 3) Rytter-felter (aldring, værdi-reconcile, pensionering) ──────────────────
  UPDATE public.riders SET
    is_u25 = COALESCE((p_rider_patch->>'is_u25')::boolean, is_u25),
    base_value = COALESCE(ROUND((p_rider_patch->>'base_value')::numeric)::integer, base_value),
    current_production_value = COALESCE(ROUND((p_rider_patch->>'current_production_value')::numeric)::integer, current_production_value),
    is_retired = COALESCE((p_rider_patch->>'is_retired')::boolean, is_retired)
  WHERE id = p_rider_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.apply_rider_development(uuid, uuid, integer, jsonb, jsonb, jsonb) IS
  'Atomisk pr.-rytter season-progression (#2361): dev-log-insert (idempotens-guard) + ability-update + rider-update i én transaktion. Kaldes af backend/lib/riderProgressionEngine.js. Returnerer false uden mutation hvis rytteren allerede var udviklet for sæsonen.';

-- Supabase' ALTER DEFAULT PRIVILEGES gen-granter EXECUTE til anon+authenticated
-- ved funktions-oprettelse (samme klasse som #2676/#2671) — revoke derfor eksplicit,
-- selv om den interne service_role-gate ovenfor allerede afviser andre rollers kald.
REVOKE ALL ON FUNCTION public.apply_rider_development(uuid, uuid, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_rider_development(uuid, uuid, integer, jsonb, jsonb, jsonb) TO service_role;

-- PostgREST schema-cache reload så RPC'en er kaldbar umiddelbart efter migrate.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verifikation efter apply (kør post-merge, spejler mønstret fra
-- 2026-07-19-revoke-rpc-grants-2676.sql):
--
--   SELECT p.proname,
--          pg_get_function_identity_arguments(p.oid) AS args,
--          (SELECT array_agg(grantee::text || '=' || privilege_type ORDER BY grantee::text)
--           FROM information_schema.routine_privileges rp
--           WHERE rp.specific_schema = 'public' AND rp.routine_name = p.proname) AS grants
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'apply_rider_development';
--
-- Forventet: {postgres=EXECUTE, service_role=EXECUTE} — INGEN anon/authenticated.
--
-- Funktionelt smoke-test (read-only, sikkert at køre gentagne gange — kalder
-- funktionen med en season_id der IKKE findes, så FK-constraints på
-- rider_development_log fejler før nogen mutation sker, men bekræfter at
-- funktionen er kaldbar og service_role-gaten passerer):
--   SELECT public.apply_rider_development(
--     (SELECT id FROM public.riders LIMIT 1),
--     '00000000-0000-0000-0000-000000000000'::uuid,
--     0, '{}'::jsonb, '{}'::jsonb, '{"age": 0, "abilities": {}}'::jsonb
--   ); -- forventes at fejle med FK-violation (season_id findes ikke) — det
--      -- BEVISER at auth-gaten passerede og at INSERT rent faktisk blev forsøgt.
-- =============================================================================
