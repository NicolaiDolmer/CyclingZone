-- Refs #6221 #6174. Forward hardening; backend requireAdmin is the caller gate.
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
    (SELECT COUNT(DISTINCT user_id) FROM public.roadmap_votes)::int,
    (SELECT COUNT(DISTINCT user_id) FROM public.roadmap_votes WHERE updated_at > NOW() - INTERVAL '14 days')::int,
    (SELECT COUNT(*) FROM public.roadmap_votes)::int,
    (SELECT COUNT(*) FROM per_user WHERE n = (SELECT COUNT(*) FROM votable))::int,
    (SELECT COUNT(*) FROM public.teams WHERE user_id IS NOT NULL)::int
  WHERE auth.role() = 'service_role';
$$;
CREATE OR REPLACE FUNCTION public.roadmap_split_item(
  p_source UUID, p_title_en TEXT, p_title_da TEXT,
  p_status TEXT DEFAULT 'planned', p_horizon TEXT DEFAULT 'next', p_issue_ref INTEGER DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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
          coalesce(p_status, 'planned'), coalesce(p_horizon, 'next'), p_issue_ref)
  RETURNING id INTO v_new;
  INSERT INTO public.roadmap_votes (item_id, user_id, idea_score, importance_score, created_at, updated_at)
  SELECT v_new, user_id, idea_score, importance_score, created_at, updated_at
  FROM public.roadmap_votes WHERE item_id = p_source;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.roadmap_admin_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roadmap_admin_stats() TO service_role;
REVOKE ALL ON FUNCTION public.roadmap_split_item(uuid,text,text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roadmap_split_item(uuid,text,text,text,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.roadmap_resync_flags() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roadmap_resync_flags() TO service_role;
