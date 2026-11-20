-- Refs #5153. Manual apply after review and merge.
-- Preserve the existing grants and access predicates. Remove overlapping SELECT
-- policies for authenticated users on beta requests and survey definitions.
BEGIN;
SET LOCAL lock_timeout = '2s';

DROP POLICY IF EXISTS beta_requests_select_admin ON public.beta_requests;
DROP POLICY IF EXISTS beta_requests_select_own ON public.beta_requests;
DROP POLICY IF EXISTS beta_requests_select_authorized ON public.beta_requests;
CREATE POLICY beta_requests_select_authorized
  ON public.beta_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

-- The existing SELECT policy already permits administrators to read all surveys.
DROP POLICY IF EXISTS "Admins can write surveys" ON public.surveys;
DROP POLICY IF EXISTS "Admins can insert surveys" ON public.surveys;
DROP POLICY IF EXISTS "Admins can update surveys" ON public.surveys;
DROP POLICY IF EXISTS "Admins can delete surveys" ON public.surveys;
CREATE POLICY "Admins can insert surveys"
  ON public.surveys FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update surveys"
  ON public.surveys FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins can delete surveys"
  ON public.surveys FOR DELETE TO authenticated
  USING (public.is_admin());

-- The existing question SELECT policy also includes administrators.
DROP POLICY IF EXISTS "Admins can write survey questions" ON public.survey_questions;
DROP POLICY IF EXISTS "Admins can insert survey questions" ON public.survey_questions;
DROP POLICY IF EXISTS "Admins can update survey questions" ON public.survey_questions;
DROP POLICY IF EXISTS "Admins can delete survey questions" ON public.survey_questions;
CREATE POLICY "Admins can insert survey questions"
  ON public.survey_questions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update survey questions"
  ON public.survey_questions FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins can delete survey questions"
  ON public.survey_questions FOR DELETE TO authenticated
  USING (public.is_admin());

COMMIT;
