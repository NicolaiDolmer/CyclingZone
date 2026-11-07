-- =============================================================================
-- 2026-11-08 · #7895 - roadmap: saesonnumre og kvartaler i stedet for Snart/Senere
-- =============================================================================
-- Ejer 8/11 nat: "Snart" og "Senere" er for uspecifikke, og "Denne/Naeste
-- saeson" skal vise saesonens nummer. Nye horisonter:
--   this_week, next_week          Denne uge / Naeste uge
--   season_<N>                    Saeson N (kommer i saeson N, foer N+1 starter)
--   q<1-4>_<YYYY>                 Q1 2027 osv.
--   y<YYYY>                       2027 (resten af aaret)
--   unscheduled                   Ide i afstemningspuljen uden tid ("Til afstemning")
-- Moenstret (ikke en fast liste) goer, at saeson 7, Q3 2027 osv. kan bruges
-- uden ny migration. Klienten kender raekkefoelgen (roadmapModel.ts).
--
-- Placeringen af hvert planlagt punkt er besluttet med ejeren en ad gangen
-- (docs/investigations/2026-11-07-roadmap-omprioritering-forslag.md).
-- Idempotent: den generelle oversaettelse (trin 1) koerer kun, mens der
-- stadig findes gamle vaerdier, saa en genkoersel ikke flytter y2027 igen.
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642).
--
-- Rollback (gamle vaerdier kan ikke gendannes 1:1; foer-tilstand i beslutningsfilen):
--   ALTER TABLE public.roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_horizon_check;
--   UPDATE public.roadmap_items SET horizon = 'next' WHERE horizon NOT IN ('this_week','next_week','y2027');
--   ALTER TABLE public.roadmap_items ADD CONSTRAINT roadmap_items_horizon_check
--     CHECK (horizon IN ('this_week','next_week','next','this_season','next_season','y2027','later'));
--   ALTER TABLE public.roadmap_items ALTER COLUMN horizon SET DEFAULT 'next';
-- =============================================================================

SET lock_timeout = '3s';

ALTER TABLE public.roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_horizon_check;

-- 1. Generel oversaettelse af de gamle vaerdier for besluttede punkter.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM public.roadmap_items WHERE horizon IN ('next', 'later', 'this_season', 'next_season')) THEN
    UPDATE public.roadmap_items SET horizon = 'q1_2027'
      WHERE status IN ('planned', 'in_progress') AND horizon = 'y2027';
    UPDATE public.roadmap_items SET horizon = 'y2027'
      WHERE status IN ('planned', 'in_progress') AND horizon = 'later';
  END IF;
END $do$;
UPDATE public.roadmap_items SET horizon = 'season_5'
  WHERE status IN ('planned', 'in_progress') AND horizon = 'this_season';
UPDATE public.roadmap_items SET horizon = 'season_6'
  WHERE status IN ('planned', 'in_progress') AND horizon = 'next_season';
UPDATE public.roadmap_items SET horizon = 'next_week'
  WHERE status IN ('planned', 'in_progress') AND horizon = 'next';

-- 2. Ejerens placering 8/11, punkt for punkt (kun besluttede punkter).
UPDATE public.roadmap_items SET horizon = 'this_week'
  WHERE status IN ('planned', 'in_progress') AND issue_ref IN (7715);
UPDATE public.roadmap_items SET horizon = 'next_week'
  WHERE status IN ('planned', 'in_progress') AND issue_ref IN (5573, 5574, 3813, 6917, 6984, 7864, 7859, 7892, 6916);
UPDATE public.roadmap_items SET horizon = 'season_5'
  WHERE status IN ('planned', 'in_progress') AND issue_ref IN (5238, 1140, 3984, 1833, 2798, 7417, 1177, 7471, 7535);
UPDATE public.roadmap_items SET horizon = 'season_6'
  WHERE status IN ('planned', 'in_progress') AND issue_ref IN (4620, 4621, 7805);
UPDATE public.roadmap_items SET horizon = 'season_6'
  WHERE status IN ('planned', 'in_progress') AND issue_ref IS NULL AND title_en = 'Prize money in youth races.';
UPDATE public.roadmap_items SET horizon = 'q1_2027'
  WHERE status IN ('planned', 'in_progress') AND issue_ref IN (3463, 4957, 5106);

-- 3. Ideer: kun dem ejeren gav en tid 7/11 beholder en; resten er "Til afstemning".
UPDATE public.roadmap_items SET horizon = 'q1_2027'
  WHERE status = 'active' AND issue_ref IN (4630, 5621, 935, 1147);
UPDATE public.roadmap_items SET horizon = 'season_6'
  WHERE status = 'active' AND issue_ref IN (6191, 5625, 1154, 5180);
UPDATE public.roadmap_items SET horizon = 'unscheduled'
  WHERE status = 'active' AND horizon IN ('next', 'later', 'this_season', 'next_season', 'this_week', 'next_week');

-- 4. Faerdige og arkiverede punkter vises ikke efter horisont.
UPDATE public.roadmap_items SET horizon = 'unscheduled'
  WHERE status IN ('shipped', 'archived') AND horizon IN ('next', 'later', 'this_season', 'next_season');

ALTER TABLE public.roadmap_items ALTER COLUMN horizon SET DEFAULT 'unscheduled';
ALTER TABLE public.roadmap_items ADD CONSTRAINT roadmap_items_horizon_check
  CHECK (horizon IN ('this_week', 'next_week', 'unscheduled')
         OR horizon ~ '^(season_[0-9]{1,2}|q[1-4]_20[0-9]{2}|y20[0-9]{2})$');

-- roadmap_split_item havde standard/fallback 'next', som nu bryder reglen.
CREATE OR REPLACE FUNCTION public.roadmap_split_item(
  p_source UUID, p_title_en TEXT, p_title_da TEXT,
  p_status TEXT DEFAULT 'planned', p_horizon TEXT DEFAULT 'next_week', p_issue_ref INTEGER DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src public.roadmap_items%ROWTYPE;
  v_new UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_title_en, '')) = '' OR btrim(coalesce(p_title_da, '')) = '' THEN
    RAISE EXCEPTION 'both titles are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_src FROM public.roadmap_items WHERE id = p_source;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source item not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.roadmap_items (engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref)
  VALUES (v_src.engine, v_src.sort_order, btrim(p_title_en), btrim(p_title_da), FALSE,
          coalesce(p_status, 'planned'), coalesce(p_horizon, 'next_week'), p_issue_ref)
  RETURNING id INTO v_new;
  INSERT INTO public.roadmap_votes (item_id, user_id, idea_score, importance_score, created_at, updated_at)
  SELECT v_new, user_id, idea_score, importance_score, created_at, updated_at
  FROM public.roadmap_votes WHERE item_id = p_source;
  RETURN v_new;
END;
$fn$;
REVOKE ALL ON FUNCTION public.roadmap_split_item(uuid,text,text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roadmap_split_item(uuid,text,text,text,text,integer) TO service_role;

COMMENT ON COLUMN public.roadmap_items.horizon IS
  'Hvornaar punktet er planlagt (#7895): this_week, next_week, season_<N>, q<1-4>_<YYYY>, y<YYYY>, eller unscheduled (ide uden tid).';

-- Verifikation (read-only, efter apply):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'roadmap_items_horizon_check';
--   SELECT status, horizon, count(*) FROM public.roadmap_items GROUP BY 1, 2 ORDER BY 1, 2;
