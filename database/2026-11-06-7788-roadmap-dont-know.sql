-- Roadmap: Ved ikke på Stem (#7788). Ét Ved ikke pr. punkt (ejer 6/11), ikke pr. akse.
--
-- Ved ikke er en stemme-række uden tal: importance_score og idea_score er begge
-- NULL. Punktet er dermed besvaret (rækken findes), men rækken tæller ikke i
-- snittet. Der kommer bevidst ingen ny kolonne: klienten læser og skriver de samme
-- felter som i dag, så almindelige stemmer virker uændret, uanset om frontend eller
-- migration lander først.
--
-- Additiv + idempotent. Ingen eksisterende række ændres, og for dem er tallene i
-- viewet og RPC'en de samme som før. Apply sker efter merge (auto-migrate.yml, #2642).
--
-- Pre-check (read-only mod prod 6/11):
--   - idea_score er allerede nullable (#5387); importance_score er NOT NULL.
--   - 1-6-CHECK'ene på begge kolonner slipper NULL igennem og røres ikke.
--   - Ingen rækker har importance_score NULL, så den nye CHECK validerer rent.
--   - Policies, view og RPC står i prod som i 2026-10-05-5387 og 2026-10-06-6221.

-- Én transaktion: auto-migrate kører filen uden, og ellers ville stemmer fejle i
-- hullet mellem DROP POLICY og CREATE POLICY. Kan låsen ikke fås, ruller det hele
-- tilbage, og auto-migrate kan køres igen (#6342).
SET lock_timeout = '3s';
BEGIN;

-- 1. roadmap_votes -----------------------------------------------------------
ALTER TABLE roadmap_votes ALTER COLUMN importance_score DROP NOT NULL;

-- En halv stemme findes ikke: uden vigtighed er der heller ingen idé-score.
ALTER TABLE roadmap_votes DROP CONSTRAINT IF EXISTS roadmap_votes_dont_know_check;
ALTER TABLE roadmap_votes ADD CONSTRAINT roadmap_votes_dont_know_check
  CHECK (importance_score IS NOT NULL OR idea_score IS NULL);

-- En idé kræver fortsat begge tal, men må nu også få et Ved ikke.
DROP POLICY IF EXISTS "Users can insert own roadmap votes" ON roadmap_votes;
CREATE POLICY "Users can insert own roadmap votes"
  ON roadmap_votes FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM roadmap_items i
      WHERE i.id = roadmap_votes.item_id
        AND i.approved
        AND (
          i.status = 'planned'
          OR (i.status = 'active' AND (roadmap_votes.idea_score IS NOT NULL OR roadmap_votes.importance_score IS NULL))
        )
    )
  );

-- USING er uændret: en stemme på et låst punkt kan stadig ikke ændres.
DROP POLICY IF EXISTS "Users can update own roadmap votes" ON roadmap_votes;
CREATE POLICY "Users can update own roadmap votes"
  ON roadmap_votes FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM roadmap_items i
      WHERE i.id = roadmap_votes.item_id
        AND i.approved
        AND i.status IN ('active', 'planned')
    )
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM roadmap_items i
      WHERE i.id = roadmap_votes.item_id
        AND i.approved
        AND (
          i.status = 'planned'
          OR (i.status = 'active' AND (roadmap_votes.idea_score IS NOT NULL OR roadmap_votes.importance_score IS NULL))
        )
    )
  );

-- 2. roadmap_item_scores -----------------------------------------------------
-- votes tæller nu kun stemmer med tal, så Ved ikke heller ikke løfter styrings-
-- scoren. dont_know er det tal, admin ser; ny kolonne står SIDST
-- (CREATE OR REPLACE VIEW må kun tilføje kolonner i enden).
CREATE OR REPLACE VIEW roadmap_item_scores
  WITH (security_invoker = true) AS
SELECT
  i.id AS item_id,
  i.engine,
  i.title_en,
  i.approved,
  i.status,
  COUNT(v.importance_score) AS votes,
  ROUND(AVG(v.idea_score)::numeric, 2) AS avg_idea,
  ROUND(AVG(v.importance_score)::numeric, 2) AS avg_importance,
  ROUND(((AVG(v.importance_score) * 0.6 + AVG(v.idea_score) * 0.4) * sqrt(COUNT(v.importance_score)))::numeric, 2) AS steering_score,
  i.title_da,
  i.sort_order,
  i.horizon,
  i.issue_ref,
  COUNT(v.idea_score) AS idea_votes,
  ROUND(STDDEV_SAMP(v.importance_score)::numeric, 2) AS sd_importance,
  COUNT(v.id) - COUNT(v.importance_score) AS dont_know
FROM roadmap_items i
LEFT JOIN roadmap_votes v ON v.item_id = i.id
GROUP BY i.id, i.engine, i.title_en, i.approved, i.status, i.title_da, i.sort_order, i.horizon, i.issue_ref;

-- 3. roadmap_admin_stats -----------------------------------------------------
-- Har stemt, aktive og stemmer i alt ser bort fra Ved ikke. voted_all ("Har svaret
-- på alt") tæller det med, fordi punktet er besvaret. Signaturen er uændret; admin-
-- fanen lægger dont_know fra viewet sammen til totalen.
-- secdef-lint: allow roadmap_admin_stats (backendens admin-route kalder den som service_role; gaten er auth.role() i kroppen)
CREATE OR REPLACE FUNCTION public.roadmap_admin_stats()
RETURNS TABLE (voters integer, voters_14d integer, votes_total integer, voted_all integer, managed_teams integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH votable AS (
    SELECT id FROM public.roadmap_items WHERE approved AND status IN ('active', 'planned')
  ), per_user AS (
    SELECT v.user_id, COUNT(*) AS n
    FROM public.roadmap_votes v JOIN votable a ON a.id = v.item_id
    GROUP BY v.user_id
  )
  SELECT
    (SELECT COUNT(DISTINCT user_id) FROM public.roadmap_votes WHERE importance_score IS NOT NULL)::int,
    (SELECT COUNT(DISTINCT user_id) FROM public.roadmap_votes WHERE importance_score IS NOT NULL AND updated_at > NOW() - INTERVAL '14 days')::int,
    (SELECT COUNT(*) FROM public.roadmap_votes WHERE importance_score IS NOT NULL)::int,
    (SELECT COUNT(*) FROM per_user WHERE n = (SELECT COUNT(*) FROM votable))::int,
    (SELECT COUNT(*) FROM public.teams WHERE user_id IS NOT NULL)::int
  WHERE auth.role() = 'service_role';
$$;
REVOKE ALL ON FUNCTION public.roadmap_admin_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roadmap_admin_stats() TO service_role;

COMMENT ON COLUMN roadmap_votes.importance_score IS
  'Vigtighed 1-6. NULL = Ved ikke (#7788): punktet er besvaret uden tal, og idea_score er da også NULL.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Post-verify (read-only, køres efter apply):
--   1. SELECT is_nullable FROM information_schema.columns
--        WHERE table_name = 'roadmap_votes' AND column_name = 'importance_score';  -- YES
--   2. SELECT conname FROM pg_constraint WHERE conname = 'roadmap_votes_dont_know_check';  -- 1 række
--   3. SELECT count(*) FROM roadmap_votes WHERE importance_score IS NULL;  -- 0 lige efter apply
--   4. SELECT sum(votes), sum(dont_know) FROM roadmap_item_scores;  -- votes = antal rækker, dont_know = 0
--   5. has_function_privilege('authenticated', 'public.roadmap_admin_stats()', 'EXECUTE') = false.
