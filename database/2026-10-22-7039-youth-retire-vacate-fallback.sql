-- #7039: an AI team leaving the game must never block on its youth places.
-- #4753 required a spare AI (no youth groups, >=6 U23 + >=6 junior academy
-- riders) to take both places, and raised no_safe_youth_replacement otherwise.
-- In prod every AI team sits in a youth group, so no spare exists: five excess
-- D4 AI teams could not retire (22/10, Sentry CYCLINGZONE-8R), and the AI-fill
-- sweep in "Afslut sæson" (processSeasonEnd -> reconcileAiTeamsForPool) would
-- throw halfway after promotion/relegation was written.
--
-- New contract (owner-approved 22/10): replace when a safe spare exists and
-- both groups still hold exactly 24 teams; otherwise the retiring team simply
-- vacates its youth places (the group runs one short until the next regroup,
-- which rebuilds every youth group, YOUTH_RULES §2.3). Unfinished entries still
-- fail closed. Idempotent: CREATE OR REPLACE only, no data change.
-- Verify after apply:
--   SELECT pg_get_functiondef('public.replace_retired_ai_youth_group(uuid,timestamptz)'::regprocedure) ILIKE '%vacated%';
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.replace_retired_ai_youth_group(p_team_id uuid, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  target_u23 bigint;
  target_junior bigint;
  target_retired_at timestamptz;
  target_is_ai boolean;
  target_user_id uuid;
  replacement_id uuid;
  vacate_reason text;
  changed integer;
BEGIN
  IF p_now IS NULL THEN RAISE EXCEPTION 'replacement_time_required'; END IF;
  SELECT t.u23_league_division_id,t.junior_league_division_id,t.retired_at,t.is_ai,t.user_id
    INTO target_u23,target_junior,target_retired_at,target_is_ai,target_user_id
    FROM public.teams t WHERE t.id=p_team_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('replaced',false,'reason','team_not_found'); END IF;
  IF target_is_ai IS DISTINCT FROM true OR target_user_id IS NOT NULL OR target_retired_at IS NULL THEN
    RAISE EXCEPTION 'target_not_retired_ai';
  END IF;
  IF target_u23 IS NULL AND target_junior IS NULL THEN
    RETURN jsonb_build_object('replaced',false,'reason','no_youth_groups');
  END IF;

  -- A team with an unfinished race must remain in its current youth groups.
  IF EXISTS (SELECT 1 FROM public.race_entries e JOIN public.races x ON x.id=e.race_id
      WHERE (e.team_id=p_team_id OR e.rider_id IN
        (SELECT id FROM public.riders WHERE team_id=p_team_id)) AND x.status<>'completed') THEN
    RAISE EXCEPTION 'target_has_unfinished_entries';
  END IF;

  -- All replacements acquire group locks in ID order, then a spare team row.
  PERFORM 1 FROM public.league_divisions d
    WHERE d.id IN (target_u23,target_junior) AND d.retired_at IS NULL
    ORDER BY d.id FOR UPDATE;

  IF (target_u23 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.league_divisions
      WHERE id=target_u23 AND retired_at IS NULL)) OR
     (target_junior IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.league_divisions
      WHERE id=target_junior AND retired_at IS NULL)) THEN
    vacate_reason := 'youth_group_retired_or_missing';
  ELSIF (target_u23 IS NOT NULL AND
      (SELECT count(*) FROM public.teams WHERE u23_league_division_id=target_u23 AND NOT coalesce(is_bank,false))<>24) OR
     (target_junior IS NOT NULL AND
      (SELECT count(*) FROM public.teams WHERE junior_league_division_id=target_junior AND NOT coalesce(is_bank,false))<>24) THEN
    vacate_reason := 'youth_group_not_full';
  ELSE
    -- The same startable club takes both youth places, as the departing club did.
    -- UUID order matches the existing youth planner's deterministic AI tie-break.
    SELECT t.id INTO replacement_id FROM public.teams t
      WHERE t.id<>p_team_id AND t.is_ai=true AND t.user_id IS NULL
        AND t.is_bank=false AND t.is_frozen=false AND t.is_test_account=false
        AND t.parked_at IS NULL AND t.retired_at IS NULL AND t.pending_removal_at IS NULL
        AND t.league_division_id IS NOT NULL
        AND t.u23_league_division_id IS NULL AND t.junior_league_division_id IS NULL
        AND (SELECT count(*) FROM public.riders r WHERE r.team_id=t.id AND r.squad='u23'
          AND r.is_academy=true AND r.is_retired=false AND r.pending_team_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.rider_condition c WHERE c.rider_id=r.id
            AND c.injured_until >= (p_now AT TIME ZONE 'Europe/Copenhagen')::date))>=6
        AND (SELECT count(*) FROM public.riders r WHERE r.team_id=t.id AND r.squad='junior'
          AND r.is_academy=true AND r.is_retired=false AND r.pending_team_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.rider_condition c WHERE c.rider_id=r.id
            AND c.injured_until >= (p_now AT TIME ZONE 'Europe/Copenhagen')::date))>=6
        AND NOT EXISTS (SELECT 1 FROM public.race_entries e JOIN public.races x ON x.id=e.race_id
          WHERE (e.team_id=t.id OR e.rider_id IN
            (SELECT id FROM public.riders WHERE team_id=t.id))
            AND x.squad IN ('u23','junior') AND x.status<>'completed')
      ORDER BY t.id LIMIT 1 FOR UPDATE OF t SKIP LOCKED;
    IF replacement_id IS NULL THEN vacate_reason := 'no_safe_youth_replacement'; END IF;
  END IF;

  UPDATE public.teams SET u23_league_division_id=NULL,junior_league_division_id=NULL
    WHERE id=p_team_id AND retired_at IS NOT NULL
      AND u23_league_division_id IS NOT DISTINCT FROM target_u23
      AND junior_league_division_id IS NOT DISTINCT FROM target_junior;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'retired_youth_target_changed'; END IF;

  IF vacate_reason IS NOT NULL THEN
    RETURN jsonb_build_object('replaced',false,'vacated',true,'reason',vacate_reason,
      'retiredTeamId',p_team_id,'u23GroupId',target_u23,'juniorGroupId',target_junior);
  END IF;

  UPDATE public.teams SET u23_league_division_id=target_u23,junior_league_division_id=target_junior
    WHERE id=replacement_id AND retired_at IS NULL AND pending_removal_at IS NULL
      AND u23_league_division_id IS NULL AND junior_league_division_id IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'youth_replacement_changed'; END IF;

  RETURN jsonb_build_object('replaced',true,'retiredTeamId',p_team_id,
    'replacementTeamId',replacement_id,'u23GroupId',target_u23,'juniorGroupId',target_junior);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_retired_ai_youth_group(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_retired_ai_youth_group(uuid,timestamptz) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
