-- #8015, owner 11/11: all owned riders may use auto-price; departures may reach zero.
-- Patch current definitions, preserving beta, payment, locks, signatures and ACLs.
-- Academy riders graduate in the existing atomic ownership claim at sale, not listing.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $migration$
DECLARE
  f record;
  def text;
  new_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='set_listing_auto_accept_price') THEN
    RAISE EXCEPTION '#8015: auto-accept prerequisite missing';
  END IF;
  FOR f IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'set_listing_auto_accept_price','start_auto_accept_auction','start_auto_accept_auction_bid',
      'auto_accept_claim_transfer','auto_accept_release_rider','create_market_auction_2176')
  LOOP
    def := pg_get_functiondef(f.oid);
    new_def := regexp_replace(def,
      $rx$IF coalesce\((v_academy|r\.is_academy),[ ]*false\) THEN[[:space:]]+RETURN jsonb_build_object\('status',[ ]*'rider_is_academy'\);[[:space:]]+END IF;$rx$,
      '', 'g');
    IF position('rider_is_academy' IN new_def)>0 THEN
      RAISE EXCEPTION '#8015: unrecognized academy guard in %', f.proname;
    END IF;
    -- Senior counts exclude youth. Even with a zero parameter, subtracting a youth
    -- departure would produce -1 and block it. Zero must disable the check itself.
    -- Retain explicit positive-floor compatibility for old internal callers.
    new_def := regexp_replace(new_def,
      $rx$IF ([^\n;]+<[ ]*(p_min_riders|p_min_seller_riders)) THEN([[:space:]]+RETURN jsonb_build_object\('status',[ ]*'(seller_)?squad_floor')$rx$,
      $replacement$IF \2 > 0 AND (\1) THEN\3$replacement$, 'g');
    IF new_def ~ E'IF (v_count|v_seller_count)[^\\n]+<[ ]*p_min_(seller_)?riders THEN' THEN
      RAISE EXCEPTION '#8015: unrecognized departure floor in %', f.proname;
    END IF;
    IF new_def IS DISTINCT FROM def THEN EXECUTE new_def; END IF;
  END LOOP;
END
$migration$;
COMMIT;
