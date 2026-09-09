-- #4753. Owner design-go 9/9: retirement with history, atomic reservation,
-- draining, automatic discovery and a single pool budget. No repair runs here.
-- Apply only after merge AND the separate owner production go for this release.
-- No FK delete actions or RLS policies are relaxed. RPCs are service-only.
BEGIN;

CREATE OR REPLACE FUNCTION public.ai_team_retirement_reason(p_team_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.race_entries e JOIN public.races r ON r.id=e.race_id
      WHERE (e.team_id=p_team_id OR e.rider_id IN (SELECT id FROM public.riders WHERE team_id=p_team_id))
        AND r.status<>'completed' AND (r.stages_completed>0 OR EXISTS
          (SELECT 1 FROM public.race_stage_claims c WHERE c.race_id=r.id))) THEN 'inflight_entries'
    WHEN EXISTS (SELECT 1 FROM public.race_results rr JOIN public.races r ON r.id=rr.race_id
      WHERE rr.team_id=p_team_id AND rr.prize_money>0 AND r.prize_paid_at IS NULL) THEN 'unpaid_prizes'
    WHEN EXISTS (SELECT 1 FROM public.riders WHERE
      (team_id=p_team_id AND pending_team_id IS NOT NULL) OR pending_team_id=p_team_id) THEN 'pending_transfer'
    WHEN EXISTS (SELECT 1 FROM public.transfer_offers o
      WHERE o.status IN ('pending','countered','awaiting_confirmation')
        AND (o.seller_team_id=p_team_id OR o.buyer_team_id=p_team_id OR
          o.rider_id IN (SELECT id FROM public.riders WHERE team_id=p_team_id))) THEN 'live_transfer_offers'
    WHEN EXISTS (SELECT 1 FROM public.swap_offers o
      WHERE o.status IN ('pending','countered','awaiting_confirmation') AND
        (o.proposing_team_id=p_team_id OR o.receiving_team_id=p_team_id OR
         o.offered_rider_id IN (SELECT id FROM public.riders WHERE team_id=p_team_id) OR
         o.requested_rider_id IN (SELECT id FROM public.riders WHERE team_id=p_team_id))) THEN 'live_swap_offers'
    WHEN EXISTS (SELECT 1 FROM public.auctions a WHERE a.status IN ('active','extended') AND
      (a.seller_team_id=p_team_id OR a.current_bidder_id=p_team_id OR
       a.rider_id IN (SELECT id FROM public.riders WHERE team_id=p_team_id))) THEN 'live_auctions'
    ELSE NULL END;
$$;

-- Read-only and shared by dry-run, reservation and actual retirement. Occupancy
-- includes frozen/test teams; they occupy a real slot and may never be retired here.
CREATE OR REPLACE FUNCTION public.plan_ai_pool_retirements(p_pool_id bigint, p_now timestamptz DEFAULT now())
RETURNS TABLE(team_id uuid, team_name text, pool_id bigint, pool_label text,
  teams_now bigint, target_size int, reason text, pending_since timestamptz, blocked_since timestamptz,
  riders_count bigint, offers_preserved bigint, future_entries_removed bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH population AS (
    SELECT d.id,d.label,
      count(t.id) FILTER (WHERE NOT coalesce(t.is_bank,false)) AS n,
      CASE WHEN d.tier<=2 OR count(t.id) FILTER (WHERE t.is_ai=false
        AND NOT coalesce(t.is_bank,false) AND NOT coalesce(t.is_frozen,false)
        AND NOT coalesce(t.is_test_account,false))>0 THEN 24 ELSE 0 END AS target
    FROM public.league_divisions d LEFT JOIN public.teams t ON t.league_division_id=d.id
    WHERE d.id=p_pool_id GROUP BY d.id,d.label,d.tier
  ), candidates AS (
    SELECT t.*,public.ai_team_retirement_reason(t.id) AS block_reason
    FROM public.teams t WHERE t.league_division_id=p_pool_id AND t.is_ai=true
      AND NOT coalesce(t.is_bank,false) AND NOT coalesce(t.is_frozen,false)
      AND NOT coalesce(t.is_test_account,false) AND t.user_id IS NULL AND t.retired_at IS NULL
  )
  SELECT t.id,t.name,p.id,p.label,p.n,p.target,t.block_reason,t.pending_removal_at,t.pending_removal_blocked_since,
    (SELECT count(*) FROM public.riders WHERE team_id=t.id),
    (SELECT count(*) FROM public.transfer_offers o WHERE o.seller_team_id=t.id OR o.buyer_team_id=t.id
      OR o.rider_id IN (SELECT id FROM public.riders WHERE team_id=t.id)),
    (SELECT count(*) FROM public.race_entries e JOIN public.races r ON r.id=e.race_id
      WHERE (e.team_id=t.id OR e.rider_id IN (SELECT id FROM public.riders WHERE team_id=t.id))
      AND r.status='scheduled' AND r.stages_completed=0
      AND NOT EXISTS (SELECT 1 FROM public.race_stage_claims c WHERE c.race_id=r.id))
  FROM candidates t CROSS JOIN population p
  ORDER BY (t.pending_removal_at IS NULL), (t.block_reason IS NOT NULL),t.pending_removal_at,t.id
  LIMIT (SELECT greatest(0,n-target) FROM population);
$$;

CREATE OR REPLACE FUNCTION public.reserve_ai_pool_retirements(p_pool_id bigint, p_now timestamptz DEFAULT now())
RETURNS int LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE chosen uuid[]; candidate record; n int;
BEGIN
  IF p_pool_id IS NULL THEN RETURN 0; END IF;
  -- All placement and retirement paths acquire this same pool lock first.
  PERFORM 1 FROM public.league_divisions WHERE id=p_pool_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT coalesce(array_agg(team_id),'{}'::uuid[]) INTO chosen
    FROM public.plan_ai_pool_retirements(p_pool_id,p_now);
  -- Same advisory key/order as apply_race_entry_unit_batch / move_race_entry.
  -- Acquire before team/entry locks: batch deletes old entries before inserting.
  FOR candidate IN SELECT id FROM public.teams WHERE id=ANY(chosen) ORDER BY id LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(candidate.id::text));
  END LOOP;
  UPDATE public.teams SET pending_removal_at=NULL,pending_removal_blocked_reason=NULL,
    pending_removal_blocked_since=NULL WHERE league_division_id=p_pool_id AND is_ai=true
    AND user_id IS NULL AND NOT coalesce(is_bank,false) AND pending_removal_at IS NOT NULL
    AND NOT(id=ANY(chosen));
  -- Lock candidates before checking obligations again. Market/entry guards take
  -- a share lock on the same teams, closing the stale-read insertion window.
  FOR candidate IN SELECT id FROM public.teams WHERE id=ANY(chosen) ORDER BY id FOR UPDATE LOOP
    UPDATE public.teams SET pending_removal_at=coalesce(pending_removal_at,p_now)
      WHERE id=candidate.id;
    -- Do not let a race start between deciding that it is future and draining it.
    PERFORM 1 FROM public.races r WHERE r.id IN (
      SELECT e.race_id FROM public.race_entries e WHERE e.team_id=candidate.id OR
        e.rider_id IN (SELECT id FROM public.riders WHERE team_id=candidate.id)) ORDER BY r.id FOR SHARE;
    DELETE FROM public.race_entries e USING public.races r WHERE r.id=e.race_id
      AND r.status='scheduled' AND r.stages_completed=0
      AND NOT EXISTS (SELECT 1 FROM public.race_stage_claims c WHERE c.race_id=r.id)
      AND (e.team_id=candidate.id OR
        e.rider_id IN (SELECT id FROM public.riders WHERE team_id=candidate.id));
    UPDATE public.transfer_listings SET status='withdrawn' WHERE status IN ('open','negotiating') AND
      (seller_team_id=candidate.id OR rider_id IN (SELECT id FROM public.riders WHERE team_id=candidate.id));
    UPDATE public.teams SET
      pending_removal_blocked_since=CASE WHEN pending_removal_blocked_reason IS DISTINCT FROM
        public.ai_team_retirement_reason(candidate.id) OR pending_removal_blocked_since IS NULL
        THEN p_now ELSE pending_removal_blocked_since END,
      pending_removal_blocked_reason=public.ai_team_retirement_reason(candidate.id)
      WHERE id=candidate.id;
  END LOOP;
  n := cardinality(chosen);
  RETURN n;
END;
$$;

-- Trigger-only definer: an authenticated INSERT may not read or update other
-- teams under RLS. This function has no callable arguments; it reserves only the
-- actual affected pool after the caller's own row has passed its normal RLS.
CREATE OR REPLACE FUNCTION public.reserve_ai_retirement_on_placement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.league_division_id IS NOT DISTINCT FROM OLD.league_division_id THEN RETURN NEW; END IF;
  IF TG_WHEN='BEFORE' THEN
    PERFORM 1 FROM public.league_divisions WHERE id IN
      (NEW.league_division_id,CASE WHEN TG_OP='UPDATE' THEN OLD.league_division_id ELSE NULL END)
      ORDER BY id FOR NO KEY UPDATE;
  ELSIF NEW.is_ai=false AND NEW.league_division_id IS NOT NULL THEN
    PERFORM public.reserve_ai_pool_retirements(NEW.league_division_id,now());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_pool_placement_lock ON public.teams;
CREATE TRIGGER trg_ai_pool_placement_lock BEFORE INSERT OR UPDATE OF league_division_id ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.reserve_ai_retirement_on_placement();
DROP TRIGGER IF EXISTS trg_ai_pool_placement_reserve ON public.teams;
CREATE TRIGGER trg_ai_pool_placement_reserve AFTER INSERT OR UPDATE OF league_division_id ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.reserve_ai_retirement_on_placement();

-- A new obligation is serialized with reservation/retirement. Existing offers
-- can counter/confirm/complete, and existing race entries can update their roles.
-- Definer is confined to a trigger and reads only the parent rows' retirement state.
CREATE OR REPLACE FUNCTION public.guard_draining_ai_obligation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE payload jsonb := to_jsonb(NEW); previous jsonb; ids uuid[]; rids uuid[];
  t record; existing boolean := false;
BEGIN
  IF TG_TABLE_NAME='auctions' AND payload->>'current_bidder_id' IS NOT NULL AND
    (TG_OP='INSERT' OR payload->>'current_bidder_id' IS DISTINCT FROM to_jsonb(OLD)->>'current_bidder_id') THEN
    FOR t IN SELECT id,is_ai,pending_removal_at,retired_at FROM public.teams
      WHERE id=(payload->>'current_bidder_id')::uuid FOR SHARE LOOP
      IF t.is_ai AND (t.pending_removal_at IS NOT NULL OR t.retired_at IS NOT NULL) THEN
        RAISE EXCEPTION 'AI team is draining: no new auction bids' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END IF;
  IF TG_OP='UPDATE' THEN
    previous := to_jsonb(OLD);
    -- Identity, not negotiation amounts/metadata, defines an existing obligation.
    existing := jsonb_build_array(payload->'race_id',payload->'team_id',payload->'rider_id',
      payload->'seller_team_id',payload->'buyer_team_id',payload->'listing_id',
      payload->'proposing_team_id',payload->'receiving_team_id',payload->'offered_rider_id',payload->'requested_rider_id') =
      jsonb_build_array(previous->'race_id',previous->'team_id',previous->'rider_id',
      previous->'seller_team_id',previous->'buyer_team_id',previous->'listing_id',
      previous->'proposing_team_id',previous->'receiving_team_id',previous->'offered_rider_id',previous->'requested_rider_id');
    IF TG_TABLE_NAME='race_entries' AND existing THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME<>'race_entries' AND payload->>'status' NOT IN
      ('open','negotiating','active','extended','pending','countered','awaiting_confirmation') THEN RETURN NEW; END IF;
    IF existing AND previous->>'status' IN
      ('open','negotiating','active','extended','pending','countered','awaiting_confirmation') THEN RETURN NEW; END IF;
  END IF;
  SELECT array_agg(value::uuid) INTO rids FROM jsonb_each_text(payload)
    WHERE key IN ('rider_id','offered_rider_id','requested_rider_id') AND value IS NOT NULL;
  SELECT array_agg(id) INTO ids FROM (
    SELECT value::uuid AS id FROM jsonb_each_text(payload)
      WHERE key IN ('team_id','seller_team_id','buyer_team_id','proposing_team_id','receiving_team_id')
        AND value IS NOT NULL
    UNION SELECT team_id FROM public.riders WHERE id=ANY(rids)
  ) s;
  FOR t IN SELECT id,is_ai,pending_removal_at,retired_at FROM public.teams
    WHERE id=ANY(ids) ORDER BY id FOR SHARE LOOP
    IF t.is_ai AND (t.pending_removal_at IS NOT NULL OR t.retired_at IS NOT NULL) THEN
      RAISE EXCEPTION 'AI team is draining: no new obligations' USING ERRCODE='23514';
    END IF;
  END LOOP;
  -- Retired riders have no current team; retain this protection after pool exit.
  IF EXISTS (SELECT 1 FROM public.riders WHERE id=ANY(rids) AND is_retired=true) THEN
    RAISE EXCEPTION 'AI rider is retired: no new obligations' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_drain_entries ON public.race_entries;
CREATE TRIGGER trg_ai_drain_entries BEFORE INSERT OR UPDATE ON public.race_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_draining_ai_obligation();
DROP TRIGGER IF EXISTS trg_ai_drain_offers ON public.transfer_offers;
CREATE TRIGGER trg_ai_drain_offers BEFORE INSERT OR UPDATE ON public.transfer_offers
  FOR EACH ROW EXECUTE FUNCTION public.guard_draining_ai_obligation();
DROP TRIGGER IF EXISTS trg_ai_drain_swaps ON public.swap_offers;
CREATE TRIGGER trg_ai_drain_swaps BEFORE INSERT OR UPDATE ON public.swap_offers
  FOR EACH ROW EXECUTE FUNCTION public.guard_draining_ai_obligation();
DROP TRIGGER IF EXISTS trg_ai_drain_auctions ON public.auctions;
CREATE TRIGGER trg_ai_drain_auctions BEFORE INSERT OR UPDATE ON public.auctions
  FOR EACH ROW EXECUTE FUNCTION public.guard_draining_ai_obligation();
DROP TRIGGER IF EXISTS trg_ai_drain_listings ON public.transfer_listings;
CREATE TRIGGER trg_ai_drain_listings BEFORE INSERT OR UPDATE ON public.transfer_listings
  FOR EACH ROW EXECUTE FUNCTION public.guard_draining_ai_obligation();

-- A simulation claims its stage BEFORE loading entrants, while stages_completed
-- is still zero. Serialize that claim with draining's race lock, so either the
-- claim is visible to retirement or the entrant is gone before simulation starts.
CREATE OR REPLACE FUNCTION public.lock_ai_retirement_race_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.races WHERE id=NEW.race_id FOR UPDATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_retirement_claim_lock ON public.race_stage_claims;
CREATE TRIGGER trg_ai_retirement_claim_lock BEFORE INSERT OR UPDATE ON public.race_stage_claims
  FOR EACH ROW EXECUTE FUNCTION public.lock_ai_retirement_race_claim();

CREATE OR REPLACE FUNCTION public.retire_ai_pool_team(p_team_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE pool bigint; why text; rider_ids uuid[]; chosen boolean;
BEGIN
  SELECT league_division_id INTO pool FROM public.teams WHERE id=p_team_id AND is_ai=true
    AND user_id IS NULL AND NOT coalesce(is_bank,false) AND NOT coalesce(is_frozen,false)
    AND NOT coalesce(is_test_account,false) AND retired_at IS NULL;
  IF pool IS NULL THEN RETURN jsonb_build_object('retired',false,'reason','not_active_ai','ridersRetired',0); END IF;
  PERFORM 1 FROM public.league_divisions WHERE id=pool FOR NO KEY UPDATE;
  PERFORM public.reserve_ai_pool_retirements(pool,p_now);
  SELECT EXISTS(SELECT 1 FROM public.plan_ai_pool_retirements(pool,p_now) WHERE team_id=p_team_id) INTO chosen;
  IF NOT chosen THEN RETURN jsonb_build_object('retired',false,'reason','not_excess','ridersRetired',0); END IF;
  PERFORM 1 FROM public.teams WHERE id=p_team_id AND league_division_id=pool FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('retired',false,'reason','pool_changed','ridersRetired',0); END IF;
  PERFORM 1 FROM public.riders WHERE team_id=p_team_id ORDER BY id FOR UPDATE;
  SELECT public.ai_team_retirement_reason(p_team_id) INTO why;
  IF why IS NOT NULL THEN RETURN jsonb_build_object('retired',false,'reason',why,'ridersRetired',0); END IF;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO rider_ids FROM public.riders WHERE team_id=p_team_id;
  -- The in-app notification rows are the durable delivery. They become visible
  -- only at commit. Retry cannot duplicate them: successful retirement has no pool.
  INSERT INTO public.notifications(user_id,type,title,message,related_id,metadata)
    SELECT w.user_id,'watchlist_departed','Rider has left the game',
      concat_ws(' ',r.firstname,r.lastname)||' has left the game and was removed from your watchlist.',r.id,
      jsonb_build_object('riderId',r.id,'titleCode','notif.watchlistDeparted.title','titleParams','{}'::jsonb,
        'messageCode','notif.watchlistDeparted.message','messageParams',
        jsonb_build_object('rider',concat_ws(' ',r.firstname,r.lastname)))
    FROM public.rider_watchlist w JOIN public.riders r ON r.id=w.rider_id WHERE r.id=ANY(rider_ids);
  DELETE FROM public.rider_watchlist WHERE rider_id=ANY(rider_ids);
  UPDATE public.riders SET is_retired=true,team_id=NULL,pending_team_id=NULL WHERE id=ANY(rider_ids);
  UPDATE public.teams SET retired_at=p_now,league_division_id=NULL,pending_removal_at=NULL,
    pending_removal_blocked_reason=NULL,pending_removal_blocked_since=NULL WHERE id=p_team_id;
  RETURN jsonb_build_object('retired',true,'ridersRetired',cardinality(rider_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.ai_team_retirement_reason(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.plan_ai_pool_retirements(bigint,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reserve_ai_pool_retirements(bigint,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.retire_ai_pool_team(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reserve_ai_retirement_on_placement() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_draining_ai_obligation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_ai_retirement_race_claim() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_team_retirement_reason(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_ai_pool_retirements(bigint,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_ai_pool_retirements(bigint,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.retire_ai_pool_team(uuid,timestamptz) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
