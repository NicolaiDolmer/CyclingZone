-- #7982 part 2 (owner choice A 12/11): one read per "Train now" context read.
--
-- A press read the whole game three times (every team, every rider on a team, and a
-- separate calendar lookup per division and per pending stage). This function returns,
-- in one round trip, only what one team's press needs for one date:
--   - the calendar evidence for the whole season (every race, today's stages, and per
--     division whether a stage ran before today, the highest stored game day before
--     today, whether any of those game days is unknown, and whether a stage follows
--     today). Unentered races and races without the team's riders are included, so the
--     date's slots, the previous maximum and the last race date come from the same
--     ground as the sweep's own loader.
--   - the team row and its current riders, and every binding of those riders on the
--     date: entries in today's races (also under a previous team or another pool), full
--     start snapshots of today's stages, results and abandons on today's stages, race
--     loads, frozen slots and press locks.
-- The domain rules stay in the JS resolvers (backend/lib/trainNowDateContext.js); this
-- only moves rows. Read-only (STABLE, no writes), SECURITY INVOKER with a locked
-- search_path, executable by service_role only. No grants to anon/authenticated and no
-- RLS change. The evening sweep does not use it.
--
-- Deploy window: until this is applied the backend falls back to the previous loader
-- (exactly a missing function; any other error fails the press closed).
-- Additive and idempotent (CREATE OR REPLACE). Applied post-merge per #2642.

-- #6342: fail fast instead of queueing behind live traffic. Safe to re-trigger.
SET lock_timeout = '3s';

BEGIN;

CREATE OR REPLACE FUNCTION public.train_now_date_context(
  p_team_id uuid, p_season_id uuid, p_tick_date date, p_day_start timestamptz, p_day_end timestamptz
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  WITH team_riders AS (
    SELECT r.id, r.team_id, r.squad, r.is_academy, r.is_retired, r.pending_team_id, r.created_at, r.acquired_at
    FROM public.riders r
    WHERE r.team_id = p_team_id AND r.is_retired = false
  ),
  season_races AS (
    SELECT r.id, r.league_division_id, r.race_type, r.squad, r.stages_completed, r.finalize_state
    FROM public.races r
    WHERE r.season_id = p_season_id
  ),
  today_stages AS (
    SELECT s.race_id, s.stage_number, s.game_day, s.scheduled_at
    FROM public.race_stage_schedule s
    JOIN public.races r ON r.id = s.race_id
    WHERE r.season_id = p_season_id AND s.scheduled_at >= p_day_start AND s.scheduled_at < p_day_end
  ),
  today_race_ids AS (
    SELECT DISTINCT race_id FROM today_stages
  ),
  calendar AS (
    -- Same three answers as the sweep's per-division lookups: a number, "nothing before
    -- today", or unknown (a stored game day before today is missing).
    SELECT r.league_division_id,
      count(s.race_id) FILTER (WHERE s.scheduled_at < p_day_start) AS prior_rows,
      COALESCE(bool_or(s.game_day IS NULL) FILTER (WHERE s.scheduled_at < p_day_start), false) AS prior_has_unknown,
      max(s.game_day) FILTER (WHERE s.scheduled_at < p_day_start) AS prior_max_game_day,
      COALESCE(bool_or(s.scheduled_at >= p_day_end), false) AS later_exists
    FROM season_races r
    LEFT JOIN public.race_stage_schedule s ON s.race_id = r.id
    WHERE r.league_division_id IS NOT NULL
    GROUP BY r.league_division_id
  )
  SELECT jsonb_build_object(
    'team', (SELECT jsonb_build_object(
        'id', t.id, 'league_division_id', t.league_division_id,
        'u23_league_division_id', t.u23_league_division_id, 'junior_league_division_id', t.junior_league_division_id,
        'is_ai', t.is_ai, 'parked_at', t.parked_at, 'assistant_autopick_enabled', t.assistant_autopick_enabled,
        'is_bank', t.is_bank, 'is_frozen', t.is_frozen, 'is_test_account', t.is_test_account,
        'created_at', t.created_at, 'comeback_at', t.comeback_at)
      FROM public.teams t WHERE t.id = p_team_id),
    'riders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', tr.id, 'team_id', tr.team_id, 'squad', tr.squad, 'is_academy', tr.is_academy,
        'is_retired', tr.is_retired, 'pending_team_id', tr.pending_team_id,
        'created_at', tr.created_at, 'acquired_at', tr.acquired_at) ORDER BY tr.id)
      FROM team_riders tr), '[]'::jsonb),
    'races', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', sr.id, 'league_division_id', sr.league_division_id, 'race_type', sr.race_type, 'squad', sr.squad,
        'stages_completed', sr.stages_completed, 'finalize_state', sr.finalize_state) ORDER BY sr.id)
      FROM season_races sr), '[]'::jsonb),
    'stages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'race_id', ts.race_id, 'stage_number', ts.stage_number, 'game_day', ts.game_day, 'scheduled_at', ts.scheduled_at)
        ORDER BY ts.scheduled_at, ts.race_id, ts.stage_number)
      FROM today_stages ts), '[]'::jsonb),
    'runs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'race_id', sim.race_id, 'stage_number', sim.stage_number, 'entrant_snapshot', sim.entrant_snapshot)
        ORDER BY sim.race_id, sim.stage_number)
      FROM public.race_simulation_runs sim WHERE sim.race_id IN (SELECT race_id FROM today_race_ids)), '[]'::jsonb),
    'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'race_id', e.race_id, 'rider_id', e.rider_id, 'team_id', e.team_id) ORDER BY e.race_id, e.rider_id)
      FROM public.race_entries e
      WHERE e.race_id IN (SELECT race_id FROM today_race_ids) AND e.rider_id IN (SELECT id FROM team_riders)), '[]'::jsonb),
    'results', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'race_id', rr.race_id, 'stage_number', rr.stage_number, 'rider_id', rr.rider_id, 'result_type', rr.result_type)
        ORDER BY rr.race_id, rr.stage_number, rr.id)
      FROM public.race_results rr
      WHERE rr.result_type IN ('stage', 'gc') AND rr.rider_id IN (SELECT id FROM team_riders)
        AND EXISTS (SELECT 1 FROM today_stages ts WHERE ts.race_id = rr.race_id AND ts.stage_number = rr.stage_number)), '[]'::jsonb),
    'incidents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'race_id', ri.race_id, 'stage_number', ri.stage_number, 'rider_id', ri.rider_id, 'outcome', ri.outcome)
        ORDER BY ri.race_id, ri.stage_number, ri.id)
      FROM public.race_incidents ri
      WHERE ri.outcome = 'abandon' AND ri.rider_id IN (SELECT id FROM team_riders)
        AND EXISTS (SELECT 1 FROM today_stages ts WHERE ts.race_id = ri.race_id AND ts.stage_number = ri.stage_number)), '[]'::jsonb),
    'loads', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'rider_id', l.rider_id, 'race_id', l.race_id, 'stage_number', l.stage_number, 'game_day', l.game_day, 'load', l.load)
        ORDER BY l.rider_id, l.game_day)
      FROM public.training_race_loads l
      WHERE l.season_id = p_season_id AND l.tick_date = p_tick_date AND l.rider_id IN (SELECT id FROM team_riders)), '[]'::jsonb),
    'frozen', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'rider_id', k.rider_id, 'instant_entry_snapshot', k.instant_entry_snapshot) ORDER BY k.rider_id)
      FROM public.training_train_now_locks k
      WHERE k.season_id = p_season_id AND k.tick_date = p_tick_date AND k.instant_entry_snapshot IS NOT NULL
        AND k.rider_id IN (SELECT id FROM team_riders)), '[]'::jsonb),
    'locked_rider_ids', COALESCE((SELECT jsonb_agg(k.rider_id ORDER BY k.rider_id)
      FROM public.training_train_now_locks k
      WHERE k.tick_date = p_tick_date AND k.rider_id IN (SELECT id FROM team_riders)), '[]'::jsonb),
    'calendar', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'league_division_id', c.league_division_id, 'prior_rows', c.prior_rows,
        'prior_has_unknown', c.prior_has_unknown, 'prior_max_game_day', c.prior_max_game_day,
        'later_exists', c.later_exists) ORDER BY c.league_division_id)
      FROM calendar c), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.train_now_date_context(uuid,uuid,date,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.train_now_date_context(uuid,uuid,date,timestamptz,timestamptz) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
