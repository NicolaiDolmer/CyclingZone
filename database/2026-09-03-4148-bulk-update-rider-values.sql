-- Bulk-opdatering af riders.prize_earnings_bonus i ÉT kald (#4148)
-- =============================================================================
--
-- Baggrund: economyEngine.updateRiderValues() genberegner prize_earnings_bonus
-- for HVER rytter i spillet ved hvert løbs præmieudbetaling (prizePayoutEngine.
-- paySeasonPrizesToDate → R3 #895) og ved sæson-slut. Skrivningen sker i dag som
-- ét PATCH pr. rytter (25.562 stk. i 50 minutters løbsheat, målt 23/8, #4148) —
-- backenden venter 40-60 ms r/t på hvert enkelt PostgREST-kald i stedet for at
-- regne. Denne RPC samler ALLE rækker i én statement.
--
-- Ingen ny beregning: den JS-side udregning af hver rytters nye bonus (fixed
-- 3-sæsons-vindue, se updateRiderValues' JSDoc) er UÆNDRET — kun HVORDAN
-- resultatet skrives ændres. Testet byte-identisk mod den gamle per-rytter-sti
-- i economyEngine.riderValues.bulkWrite.test.js (samme beregnede payload fodrer
-- begge skrivestier).
--
-- Bag flag (app_config.rider_values_bulk_write_enabled, default OFF — se
-- backend/lib/riderValuesBulkWriteFlag.js): updateRiderValues falder tilbage
-- til den eksisterende per-rytter-PATCH-loop når flaget er slukket. Ingen
-- adfærdsændring for eksisterende drift ved denne migrations merge.
--
-- SECURITY DEFINER: backend kalder med service_role (samme mønster som
-- apply_stage_result/apply_race_results_batch). search_path pinned + EXECUTE
-- revoket fra anon/authenticated EKSPLICIT i denne fil (Supabase' default
-- privileges granter dem automatisk ved enhver funktions-(re)oprettelse —
-- #2858/#3765-klassen; se .claude/learnings/2026-09-03-create-or-replace-secdef-
-- loses-search-path.md for hvorfor SET search_path skal stå i SAMME statement).
--
-- Idempotens: ren UPDATE på id-match — en gen-kørsel med samme payload skriver
-- samme værdier. CREATE OR REPLACE gør selve migrationen re-runnable.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.bulk_update_rider_prize_earnings_bonus(jsonb);

CREATE OR REPLACE FUNCTION public.bulk_update_rider_prize_earnings_bonus(
  p_updates jsonb  -- array af {"id": "<rider uuid>", "prize_earnings_bonus": <integer>}
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'p_updates must be a JSON array';
  END IF;
  IF jsonb_array_length(p_updates) = 0 THEN
    RETURN 0;
  END IF;
  -- Chunk-loft matcher backend-siden (RIDER_VALUES_BULK_CHUNK_SIZE, economyEngine.js) —
  -- margin over selv de største rytter-populationer pr. kald.
  IF jsonb_array_length(p_updates) > 5000 THEN
    RAISE EXCEPTION 'Too many rows in one call (max 5000) - chunk the payload';
  END IF;

  UPDATE public.riders AS r
  SET prize_earnings_bonus = (u.value->>'prize_earnings_bonus')::integer
  FROM jsonb_array_elements(p_updates) AS u(value)
  WHERE r.id = (u.value->>'id')::uuid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- #2858/#3765: REVOKE ALL FROM PUBLIC er IKKE nok — Supabase' ALTER DEFAULT
-- PRIVILEGES granter EXECUTE eksplicit til anon + authenticated ved enhver
-- funktions-(re)oprettelse, og de overlever et PUBLIC-revoke. Denne funktion er
-- SECURITY DEFINER UDEN intern guard og skriver riders.prize_earnings_bonus —
-- anon-EXECUTE ville lade enhver omskrive enhver rytters værdi.
REVOKE ALL     ON FUNCTION public.bulk_update_rider_prize_earnings_bonus(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_update_rider_prize_earnings_bonus(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bulk_update_rider_prize_earnings_bonus(jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.bulk_update_rider_prize_earnings_bonus(jsonb) TO service_role;

-- =============================================================================
-- Verifikation efter migration (forventet output)
-- =============================================================================
--
-- 1) Funktionen findes med korrekt search_path + er IKKE anon/authenticated-kaldbar:
--    SELECT p.proconfig,
--           has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_can_execute,
--           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
--           has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role_can_execute
--    FROM pg_proc p
--    WHERE p.oid = 'public.bulk_update_rider_prize_earnings_bonus(jsonb)'::regprocedure;
--    → forventet: proconfig indeholder 'search_path=public, pg_catalog';
--      anon_can_execute=false, authenticated_can_execute=false, service_role_can_execute=true.
--
-- 2) Tom payload er en no-op:
--    SELECT bulk_update_rider_prize_earnings_bonus('[]'::jsonb);
--    → forventet: 0
--
-- 3) Normal opdatering (kræver en ægte rider-id):
--    SELECT bulk_update_rider_prize_earnings_bonus(
--      jsonb_build_array(jsonb_build_object('id', '<rider-id>', 'prize_earnings_bonus', 12345))
--    );
--    → forventet: 1, og SELECT prize_earnings_bonus FROM riders WHERE id = '<rider-id>' → 12345
--
-- 4) Ukendt rider-id rammer 0 rækker (matcher WHERE r.id = ...), kaster ikke:
--    SELECT bulk_update_rider_prize_earnings_bonus(
--      jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'prize_earnings_bonus', 1))
--    );
--    → forventet: 0
