-- #6110 (ejer 23/10): lukker sidekanalen til rytterens talent i traeningsscoren.
--
-- `rider_training_scores.contributions` rummer scorens bidrag med point, herunder
-- talentet (`potential`) og dagens tilfaeldighed (`noise`). RLS lader en manager
-- laese sit eget holds raekker direkte fra klienten, saa kolonnen kunne laeses
-- uden om API'et (som nu filtrerer de to bidrag fra, trainingScore.js).
--
-- Samme kolonne-privilegie-model som riders.potentiale (#1162): alt undtagen
-- `contributions` grantes til anon/authenticated. Backend bruger service-noeglen
-- og paavirkes ikke. Frontend laeser ikke tabellen direkte.
--
-- IDEMPOTENT: REVOKE + GRANT kan koeres igen uden fejl. Ingen data aendres.

DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'rider_training_scores'
    AND column_name <> 'contributions';
  IF cols IS NULL THEN
    RAISE EXCEPTION 'public.rider_training_scores not found - refusing to revoke';
  END IF;
  EXECUTE 'REVOKE SELECT ON public.rider_training_scores FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.rider_training_scores TO anon, authenticated', cols);
END $$;
