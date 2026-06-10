-- #1162: Ægte server-side skjuling af riders.potentiale (snyd-sikker scouting).
--
-- Frontend læser riders direkte via PostgREST (anon/authenticated). Display-lag
-- v1 (#1138) skjulte kun potentialet i UI'et — den rå værdi lå stadig i payloaden
-- og kunne læses i devtools/netværksfanen. Denne migration håndhæver skjulingen
-- i databasen med KOLONNE-PRIVILEGIER:
--
--   • REVOKE SELECT på hele riders-tabellen fra anon + authenticated
--   • GRANT SELECT på alle kolonner UNDTAGEN potentiale
--   • Samme behandling af rider_derived_abilities.hidden_potential:
--     hidden_potential = scoreFrac(0.60·potentiale + 0.25·ungdom + 0.15·seeded
--     støj) hvor ungdom (birthdate) og støjen (deterministisk FNV-1a over
--     rider_id) begge kan beregnes i klienten — feltet er altså EKSAKT
--     invertérbart til den rå potentiale og dermed samme lækage.
--
-- Klienter får i stedet det viewer-maskerede estimat fra backend
-- (POST /api/scouting/estimates — beregnet server-side pr. (rytter, hold)).
-- Backend (service_role) og codex_readonly beholder fuld læseadgang.
--
-- ⚠️ FAIL-CLOSED for fremtidige kolonner: en senere
--    `ALTER TABLE riders ADD COLUMN ...` er IKKE automatisk klient-læsbar.
--    Nye kolonner der skal kunne læses af frontend kræver et eksplicit
--    `GRANT SELECT (ny_kolonne) ON public.riders TO anon, authenticated;`
--    i samme migration. Skjult-information-felter (som potentiale) skal
--    bevidst IKKE grantes.
--
-- ⚠️ Klient-forbud efter denne migration (PostgREST afviser ellers HELE kaldet):
--    • select=* på riders OG rider_derived_abilities (alle frontend-selects
--      skal være eksplicitte kolonnelister)
--    • filter/order på potentiale (fx potentiale=gte.X) — det var også en oracle-lækage
--
-- Idempotent: REVOKE + GRANT kan genkøres frit. Kolonnelisterne bygges dynamisk
-- fra information_schema, så migrationen er robust mod kolonne-drift på apply-tidspunkt.

DO $$
DECLARE
  cols text;
BEGIN
  -- riders: alt undtagen potentiale.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'riders'
    AND column_name <> 'potentiale';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'public.riders not found — refusing to revoke';
  END IF;

  EXECUTE 'REVOKE SELECT ON public.riders FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.riders TO anon, authenticated', cols);

  -- rider_derived_abilities: alt undtagen hidden_potential (eksakt invertérbar
  -- til potentiale — se header). Tabellen kan mangle på ældre miljøer (skabt i
  -- 2026-06-04-race-engine-physiology-schema.sql) — så skip i stedet for fail.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'rider_derived_abilities'
    AND column_name <> 'hidden_potential';

  IF cols IS NOT NULL THEN
    EXECUTE 'REVOKE SELECT ON public.rider_derived_abilities FROM anon, authenticated';
    EXECUTE format('GRANT SELECT (%s) ON public.rider_derived_abilities TO anon, authenticated', cols);
  END IF;
END $$;

-- PostgREST schema-cache reload (GRANT/REVOKE trigges normalt af pgrst_ddl_watch,
-- men eksplicit NOTIFY koster intet og fjerner al tvivl).
NOTIFY pgrst, 'reload schema';
