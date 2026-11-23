-- Refs #8584. Apply after merge. The owner approves item-by-item proposals separately.
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.roadmap_items ADD COLUMN IF NOT EXISTS legacy_category text;

-- Keep the original category when merging names or falling back to the old engine.
WITH mapped AS (
  SELECT id, CASE
    WHEN category IN (
      'races','tactics','selection','training','development','form','academy','market',
      'club','board_sponsors','staff','rider_profile','calendar','social','app','growth'
    ) THEN category
    WHEN category IN ('race_engine','race_film') THEN 'races'
    WHEN category = 'scouting' THEN 'market'
    WHEN category = 'messages' THEN 'social'
    WHEN category IN ('onboarding','dashboard') THEN 'app'
    WHEN category = 'youth' OR engine = 'youth' THEN 'academy'
    ELSE engine
  END AS category
  FROM public.roadmap_items
)
UPDATE public.roadmap_items AS item
SET category = mapped.category, legacy_category = coalesce(item.legacy_category, item.category)
FROM mapped
WHERE item.id = mapped.id AND item.category IS DISTINCT FROM mapped.category;

ALTER TABLE public.roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_category_check;
ALTER TABLE public.roadmap_items ADD CONSTRAINT roadmap_items_category_check CHECK (
  category IS NULL OR category IN (
    'races','tactics','selection','training','development','form','academy','market',
    'club','board_sponsors','staff','rider_profile','calendar','social','app','growth'
  )
);
COMMENT ON COLUMN public.roadmap_items.category IS 'Shared roadmap category key. Growth is restricted to admins.';
COMMENT ON COLUMN public.roadmap_items.legacy_category IS 'Previous category when changed during the taxonomy migration.';

CREATE OR REPLACE FUNCTION public.roadmap_has_fixed_horizon(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN value ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN pg_input_is_valid(value, 'date')
    WHEN value ~ '^20[0-9]{2}-W(0[1-9]|[1-4][0-9]|5[0-3])$' THEN
      right(value, 2)::integer <= extract(week FROM make_date(left(value, 4)::integer, 12, 28))
    ELSE coalesce(value ~ '^(season_[1-9][0-9]?(_start)?|q[1-4]_20[0-9]{2})$', false)
  END
$fn$;

ALTER TABLE public.roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_horizon_check;
ALTER TABLE public.roadmap_items ADD CONSTRAINT roadmap_items_horizon_check CHECK (
  public.roadmap_has_fixed_horizon(horizon)
  OR horizon IN ('unscheduled', 'this_week', 'next_week')
  OR horizon ~ '^(y20[0-9]{2}|season_[0-9]{1,2})$'
);
COMMENT ON COLUMN public.roadmap_items.horizon IS
  'Fixed ISO week (YYYY-Www), date (YYYY-MM-DD), season start/season/quarter, or unscheduled. Legacy data is retained pending owner review.';

-- Leave old values intact until their source agreement has been checked. Every
-- new plan, timing change or newly approved plan must satisfy the new rule.
CREATE OR REPLACE FUNCTION public.roadmap_items_check_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.category = 'growth' THEN
    NEW.approved := false;
    NEW.publish_on_beta := false;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.horizon IS DISTINCT FROM OLD.horizon THEN
    IF NEW.horizon IS DISTINCT FROM 'unscheduled' AND NOT public.roadmap_has_fixed_horizon(NEW.horizon) THEN
      RAISE EXCEPTION 'A roadmap item requires a valid fixed horizon or unscheduled' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'planned' AND (
    TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.horizon IS DISTINCT FROM OLD.horizon
    OR NEW.issue_ref IS DISTINCT FROM OLD.issue_ref OR (NEW.approved AND NOT OLD.approved)
  ) AND (NEW.issue_ref IS NULL OR NEW.issue_ref <= 0 OR NOT public.roadmap_has_fixed_horizon(NEW.horizon)) THEN
    RAISE EXCEPTION 'A planned roadmap item requires an issue and a fixed horizon' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.roadmap_items_check_plan() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS roadmap_items_check_plan ON public.roadmap_items;
CREATE TRIGGER roadmap_items_check_plan
  BEFORE INSERT OR UPDATE ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION public.roadmap_items_check_plan();

DROP POLICY IF EXISTS "Hide internal roadmap from anon" ON public.roadmap_items;
CREATE POLICY "Hide internal roadmap from anon" ON public.roadmap_items
  AS RESTRICTIVE FOR SELECT TO anon USING (category IS DISTINCT FROM 'growth');
DROP POLICY IF EXISTS "Hide internal roadmap from players" ON public.roadmap_items;
CREATE POLICY "Hide internal roadmap from players" ON public.roadmap_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (category IS DISTINCT FROM 'growth' OR (SELECT public.is_admin()));

-- Keep the API signature and vote-copy semantics, including 'don't know' votes.
-- secdef-lint: allow roadmap_split_item (service_role only, checked inside too)
CREATE OR REPLACE FUNCTION public.roadmap_split_item(
  p_source uuid, p_title_en text, p_title_da text,
  p_status text DEFAULT 'active', p_horizon text DEFAULT 'unscheduled', p_issue_ref integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src public.roadmap_items%ROWTYPE;
  v_new uuid;
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
  INSERT INTO public.roadmap_items (engine, category, sort_order, title_en, title_da, approved, status, horizon, issue_ref)
  VALUES (v_src.engine, v_src.category, v_src.sort_order, btrim(p_title_en), btrim(p_title_da), false,
          coalesce(p_status, 'active'), coalesce(p_horizon, 'unscheduled'), p_issue_ref)
  RETURNING id INTO v_new;
  INSERT INTO public.roadmap_votes (item_id, user_id, idea_score, importance_score, created_at, updated_at)
  SELECT v_new, user_id, idea_score, importance_score, created_at, updated_at
  FROM public.roadmap_votes WHERE item_id = p_source;
  RETURN v_new;
END
$fn$;
REVOKE ALL ON FUNCTION public.roadmap_split_item(uuid,text,text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roadmap_split_item(uuid,text,text,text,text,integer) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

