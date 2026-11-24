SET lock_timeout = '3s';

-- Refs #7323. The cutover supplies age-eligible moves from riderSeasonAge.js.
-- Installation adds the RPC. The subsequent season cutover owns data changes.
BEGIN;

ALTER TABLE public.academy_graduation
  ADD COLUMN IF NOT EXISTS automatic boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.promote_season_squads_7323(
  p_season_id uuid,
  p_transition_at timestamptz,
  p_moves jsonb
)
RETURNS TABLE (rider_id uuid, team_id uuid, to_squad text, firstname text, lastname text)
LANGUAGE plpgsql
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  locked_team_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = p_season_id AND s.status = 'active') THEN
    RAISE EXCEPTION 'Youth squad promotion requires the active target season';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('squad-promotion:' || p_season_id, 0));
  -- Use the same lock as voluntary squad moves and youth acquisitions.
  FOR locked_team_id IN
    SELECT DISTINCT x.team_id FROM pg_catalog.jsonb_to_recordset(p_moves) AS x(team_id uuid)
    WHERE x.team_id IS NOT NULL ORDER BY x.team_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(locked_team_id::text, 0));
  END LOOP;

  WITH requested AS (
    SELECT *
    FROM pg_catalog.jsonb_to_recordset(p_moves)
      AS x(rider_id uuid, team_id uuid, from_squad text, to_squad text)
    WHERE (x.from_squad = 'junior' AND x.to_squad IN ('u23', 'senior'))
       OR (x.from_squad = 'u23' AND x.to_squad = 'senior')
  ), moved AS (
    UPDATE public.riders r
    SET squad = x.to_squad, is_academy = x.to_squad <> 'senior',
        promotion_pending_to = NULL, promotion_pending_since = NULL
    FROM requested x
    WHERE r.id = x.rider_id AND r.team_id = x.team_id
      AND r.squad = x.from_squad AND r.is_retired IS NOT TRUE
      AND COALESCE(r.pending_team_id, r.team_id) = r.team_id
    RETURNING r.id, r.team_id, x.from_squad, r.squad
  )
  INSERT INTO public.academy_graduation
    (rider_id, team_id, season_id, from_squad, to_squad, status, deadline, resolved_at, automatic)
  SELECT m.id, m.team_id, p_season_id, m.from_squad, m.squad, 'promoted', p_transition_at, p_transition_at, true
  FROM moved m
  ON CONFLICT (rider_id, season_id) DO UPDATE
  SET team_id = EXCLUDED.team_id, from_squad = EXCLUDED.from_squad,
      to_squad = EXCLUDED.to_squad, status = 'promoted', resolved_at = EXCLUDED.resolved_at, automatic = true;

  UPDATE public.academy_graduation g
  SET status = CASE WHEN EXISTS (
        SELECT 1 FROM public.academy_graduation moved
        WHERE moved.season_id = p_season_id AND moved.status = 'promoted' AND moved.automatic
          AND moved.rider_id = g.rider_id AND moved.team_id = g.team_id
      ) THEN 'promoted' ELSE 'expired' END,
      resolved_at = p_transition_at
  WHERE g.status = 'pending';

  UPDATE public.riders
  SET promotion_pending_to = NULL, promotion_pending_since = NULL
  WHERE promotion_pending_to IS NOT NULL OR promotion_pending_since IS NOT NULL;

  -- Use committed history so a retried cutover can still produce its one notice.
  RETURN QUERY
  SELECT g.rider_id, g.team_id, g.to_squad, r.firstname::text, r.lastname::text
  FROM public.academy_graduation g
  JOIN public.riders r ON r.id = g.rider_id
  WHERE g.season_id = p_season_id AND g.status = 'promoted' AND g.automatic
  ORDER BY g.team_id, r.lastname, r.firstname, r.id;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_season_squads_7323(uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_season_squads_7323(uuid, timestamptz, jsonb) TO service_role;

-- Settlement only: an existing winning bid retains the place it reserved before
-- an automatic promotion. Bidding and purchases still use the actual count.
CREATE OR REPLACE FUNCTION public.auction_promotion_allowance_7323(
  p_auction_id uuid, p_team_id uuid, p_squad text
)
RETURNS integer
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  WITH commitment AS (
    SELECT min(b.bid_time) AS bid_at
    FROM public.auction_bids b
    JOIN public.auctions a ON a.id = b.auction_id
    WHERE a.id = p_auction_id AND a.current_bidder_id = p_team_id AND b.team_id = p_team_id
  )
  SELECT count(DISTINCT r.id)::integer
  FROM commitment b
  JOIN public.academy_graduation g ON g.resolved_at > b.bid_at
  JOIN public.riders r ON r.id = g.rider_id AND r.team_id = g.team_id AND r.squad = g.to_squad
  WHERE g.automatic AND g.status = 'promoted' AND g.team_id = p_team_id AND r.squad = p_squad
    AND r.is_retired IS NOT TRUE AND COALESCE(r.pending_team_id, r.team_id) = p_team_id;
$$;

REVOKE ALL ON FUNCTION public.auction_promotion_allowance_7323(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auction_promotion_allowance_7323(uuid, uuid, text) TO service_role;

COMMIT;
