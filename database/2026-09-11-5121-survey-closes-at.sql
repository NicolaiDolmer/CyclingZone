-- #5121 — closes_at bliver en RIGTIG lukning og ikke bare et felt.
--
-- HVAD DER VAR GALT: kolonnen `surveys.closes_at` har eksisteret siden #4943's
-- migration, men INTET laeste den. Hverken RLS, backend eller frontend. Et skema
-- var aabent praecis saa laenge `status = 'open'`, og lukkedatoen var derfor en
-- paamindelse til ejeren om selv at flippe status i tide. Issue #5121 saetter
-- 14/9 som lukkedato og sender et indbakke-skub der NAEVNER den dato til 218
-- spillere. Et loefte om at skemaet lukker den 14. skal holde af sig selv, ogsaa
-- hvis ingen sidder ved tastaturet soendag aften.
--
-- HVAD DENNE MIGRATION GOER: de fire skrive-policyer paa survey_responses og
-- survey_completions kraevede i forvejen at skemaet har status 'open'. De kraever
-- nu OGSAA at closes_at enten er tom eller ligger i fremtiden. Efter
-- lukketidspunktet afviser databasen nye svar og nye gennemfoerelser, uden at
-- nogen skal roere status.
--
-- HVORFOR IKKE BARE FLIPPE STATUS MED ET CRON-JOB: et job er en ting mere der
-- kan fejle, og det ville lukke skemaet et ukendt antal minutter for sent.
-- Betingelsen hoerer samme sted som den oevrige adgangskontrol, hvor den
-- evalueres paa hver eneste skrivning. Ejeren kan stadig lukke manuelt ved at
-- saette status = 'closed'; de to maader udelukker ikke hinanden.
--
-- HVAD DEN IKKE ROERER:
--   * LAESE-policyerne. Et skema hvis closes_at er passeret skal stadig kunne
--     laeses, ellers kan /survey/:slug ikke skelne "lukket" fra "findes ikke",
--     og alle der foelger et gammelt indbakke-link faar en 404. Samme
--     begrundelse som #4943's kommentar om status 'closed'.
--   * survey_questions. Spoergsmaalene er laesbare mens status er 'open', ogsaa
--     efter lukketid, saa den lukkede flade kan vise hvad der blev spurgt om.
--   * Data. Ingen raekker aendres, ingen kolonner tilfoejes eller fjernes, og
--     ingen eksisterende closes_at-vaerdi saettes her. Selve datoen saettes af
--     ejeren via backend/scripts/survey-nudge.js --execute --set-closes-at,
--     saa beslutningen om hvornaar spillerne mister muligheden for at svare
--     ikke ligger begravet i en migration.
--
-- Idempotent (DROP POLICY IF EXISTS foer hver CREATE POLICY). Ingen destruktiv
-- klasse. Applies af CI ved merge (auto-migrate.yml).
--
-- Post-verify:
--   SELECT slug, status, closes_at FROM public.surveys WHERE slug = '2026-09-features';
--   SELECT polname FROM pg_policy
--     WHERE polrelid IN ('public.survey_responses'::regclass, 'public.survey_completions'::regclass)
--     ORDER BY 1;   -- forventet 6 raekker (4 paa responses, 2 paa completions)
--   -- Og som en almindelig spiller mens closes_at er i fremtiden: et svar kan
--   -- stadig gemmes paa /survey/2026-09-features.
--
-- Refs #5121 #4943

-- ── survey_responses ───────────────────────────────────────────────────────
-- Uaendret ift. #4943 bortset fra `AND (s.closes_at IS NULL OR s.closes_at > NOW())`
-- i skema-tjekket. Resten (egen bruger, kendt question_key, eget hold) staar
-- ordret som foer; policyer kan ikke aendres delvist, saa hele teksten gentages.

DROP POLICY IF EXISTS "Users can insert own survey responses" ON public.survey_responses;
CREATE POLICY "Users can insert own survey responses"
  ON public.survey_responses FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id
        AND s.status = 'open'
        AND (s.closes_at IS NULL OR s.closes_at > NOW())
    )
    AND EXISTS (
      SELECT 1 FROM public.survey_questions q
      WHERE q.survey_id = survey_responses.survey_id AND q.key = survey_responses.question_key
    )
    AND (
      team_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = team_id AND t.user_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can update own survey responses" ON public.survey_responses;
CREATE POLICY "Users can update own survey responses"
  ON public.survey_responses FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id
        AND s.status = 'open'
        AND (s.closes_at IS NULL OR s.closes_at > NOW())
    )
    AND EXISTS (
      SELECT 1 FROM public.survey_questions q
      WHERE q.survey_id = survey_responses.survey_id AND q.key = survey_responses.question_key
    )
    AND (
      team_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = team_id AND t.user_id = (SELECT auth.uid())
      )
    )
  );

-- DELETE lukkes ogsaa: efter lukketid maa et afgivet svar hverken rettes eller
-- fjernes. Ellers kunne en spiller tomme sit felt (siden sletter raekken naar
-- feltet ryddes) og dermed aendre resultatet efter fristen.
DROP POLICY IF EXISTS "Users can delete own survey responses" ON public.survey_responses;
CREATE POLICY "Users can delete own survey responses"
  ON public.survey_responses FOR DELETE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id
        AND s.status = 'open'
        AND (s.closes_at IS NULL OR s.closes_at > NOW())
    )
  );

-- ── survey_completions ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can insert own survey completions" ON public.survey_completions;
CREATE POLICY "Users can insert own survey completions"
  ON public.survey_completions FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id
        AND s.status = 'open'
        AND (s.closes_at IS NULL OR s.closes_at > NOW())
    )
    AND EXISTS (
      SELECT 1 FROM public.survey_responses r
      WHERE r.survey_id = survey_completions.survey_id AND r.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own survey completions" ON public.survey_completions;
CREATE POLICY "Users can update own survey completions"
  ON public.survey_completions FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id
        AND s.status = 'open'
        AND (s.closes_at IS NULL OR s.closes_at > NOW())
    )
  );

COMMENT ON COLUMN public.surveys.closes_at IS
  '#5121 lukketidspunkt. NULL = ingen frist. Er tidspunktet passeret, afviser RLS nye svar og gennemfoerelser selvom status stadig er open, og /survey/:slug viser lukke-fladen. Saettes via backend/scripts/survey-nudge.js --execute --set-closes-at <ISO>.';
