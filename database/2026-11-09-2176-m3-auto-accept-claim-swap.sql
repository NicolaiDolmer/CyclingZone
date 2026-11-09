-- #2176 · Auto-accept M3: byttehandlens ejerskabsskift under samme holdlaase og
-- auktionstjek som transfer (auto_accept_claim_transfer) og frigivelse
-- (auto_accept_release_rider). Tjekliste-punkt fra det uafhaengige review 9/11.
--
-- Problemet: executeSwapOffer tjekker, om en af de to ryttere er paa auktion, og
-- flytter dem bagefter i to separate kald uden holdlaasen. En samtidig
-- start_auto_accept_auction kan derfor saette rytteren paa auktion imellem de to
-- skridt, og samme rytter kan baade vindes paa auktionen og byttes vaek.
--
-- public.auto_accept_claim_swap(...): tager begge holdlaase (samme noegle som
-- start-RPC'en og increment_balance_with_audit), saa begge rytter-raekker i fast
-- raekkefoelge. Tjekker ejerskab, parkering og aktiv auktion for BEGGE ryttere og
-- flytter/parkerer begge i EEN transaktion, saa et halvt bytte ikke kan opstaa.
-- Backend kalder den kun med auto_accept_enabled taendt; slukket bruger byttet
-- sin gamle sti uaendret. Betalingen foelger bagefter som i dag.
--
-- Intet gulv- eller pladstjek her: et bytte er een rytter ud og een ind paa hvert
-- hold, saa holdenes antal er uaendret.
--
-- Laaseraekkefoelge: holdlaase, saa rytter-raekkerne sorteret efter id (samme som
-- hold_sale_escrow og settle_sale_escrow).
--
-- Afhaenger af 2026-11-07-2176-m2-auto-accept.sql (auto_accept_lock_teams).
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642).
-- Ingen data roeres.
--
-- POST-VERIFY (read-only, efter apply):
--   SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
--          has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
--     FROM pg_proc p WHERE p.proname = 'auto_accept_claim_swap';
--   -- anon=false, auth=false, service=true
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.auto_accept_claim_swap(uuid, uuid, uuid, uuid, boolean, timestamptz, jsonb, jsonb);
--
-- Refs #2176

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.auto_accept_claim_swap(
  p_offered_rider_id uuid,
  p_requested_rider_id uuid,
  p_proposing_team_id uuid,
  p_receiving_team_id uuid,
  p_defer_registration boolean,
  p_now timestamptz,
  p_offered_patch jsonb,
  p_requested_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  o public.riders;
  q public.riders;
  v_leg record;
  v_assignments text;
  v_contract_assignments text;
BEGIN
  IF p_offered_rider_id IS NULL OR p_requested_rider_id IS NULL
     OR p_offered_rider_id = p_requested_rider_id
     OR p_proposing_team_id IS NULL OR p_receiving_team_id IS NULL
     OR p_proposing_team_id = p_receiving_team_id
     OR p_defer_registration IS NULL OR p_now IS NULL
     OR p_offered_patch IS NULL OR jsonb_typeof(p_offered_patch) <> 'object'
     OR p_requested_patch IS NULL OR jsonb_typeof(p_requested_patch) <> 'object' THEN
    RAISE EXCEPTION 'auto_accept_claim_swap: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_offered_patch || p_requested_patch) k
             WHERE k NOT IN ('salary','contract_length','contract_end_season','squad','is_academy')) THEN
    RAISE EXCEPTION 'auto_accept_claim_swap: invalid patch' USING ERRCODE = '22023';
  END IF;

  PERFORM public.auto_accept_lock_teams(p_proposing_team_id, p_receiving_team_id);
  PERFORM 1 FROM public.riders WHERE id IN (p_offered_rider_id, p_requested_rider_id) ORDER BY id FOR UPDATE;
  SELECT * INTO o FROM public.riders WHERE id = p_offered_rider_id;
  SELECT * INTO q FROM public.riders WHERE id = p_requested_rider_id;

  IF o.id IS NULL OR q.id IS NULL
     OR o.team_id IS DISTINCT FROM p_proposing_team_id
     OR q.team_id IS DISTINCT FROM p_receiving_team_id
     OR o.pending_team_id IS NOT NULL OR q.pending_team_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','rider_state_changed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auctions a
              WHERE a.rider_id IN (o.id, q.id) AND a.status IN ('active','extended')) THEN
    RETURN jsonb_build_object('status','rider_on_auction');
  END IF;

  -- Samme tildelinger som auto_accept_claim_transfer: udeladte felter forbliver
  -- uroert, og et eksplicit NULL i patchen skrives som NULL.
  FOR v_leg IN
    SELECT * FROM (VALUES
      (o.id, p_receiving_team_id, p_offered_patch),
      (q.id, p_proposing_team_id, p_requested_patch)
    ) AS t(rider_id, target_team_id, patch)
  LOOP
    v_assignments := CASE WHEN p_defer_registration THEN 'pending_team_id=$2, updated_at=$3'
      ELSE 'team_id=$2, pending_team_id=NULL, acquired_at=$3' END;
    SELECT string_agg(format('%1$I=p.%1$I', k), ', ' ORDER BY k) INTO v_contract_assignments
      FROM jsonb_object_keys(v_leg.patch) k;
    IF v_contract_assignments IS NOT NULL THEN
      v_assignments := v_assignments || ', ' || v_contract_assignments;
    END IF;
    EXECUTE 'UPDATE public.riders r SET ' || v_assignments ||
      ' FROM jsonb_populate_record(NULL::public.riders,$1) p WHERE r.id=$4'
      USING v_leg.patch, v_leg.target_team_id, p_now, v_leg.rider_id;
  END LOOP;

  RETURN jsonb_build_object('status','claimed','offered_rider_id',o.id,'requested_rider_id',q.id);
END;
$$;

REVOKE ALL ON FUNCTION public.auto_accept_claim_swap(uuid, uuid, uuid, uuid, boolean, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_claim_swap(uuid, uuid, uuid, uuid, boolean, timestamptz, jsonb, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
