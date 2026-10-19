-- #6504 (del B) · En rytter, der beviseligt har forladt holdet, er ikke et
-- afstemningsfund.
--
-- Målt 19/10 (prod, read-only): 14 af 22 karantæner de seneste 14 dage var
-- ryttere, der nu har team_id = NULL (frigivet, pension, graduering). Alle gav
-- needs_reconciliation + Sentry CYCLINGZONE-9B og druknede de 8 reelle fund.
-- Design: docs/superpowers/specs/2026-10-19-6504-frigivelse-ejerskifte-design.md
-- (afsnit B, rettet 19/10: rytteren bliver i quarantined_rider_ids, se nedenfor).
--
-- depart_training_date_riders gør det samme som quarantine_training_date_riders
-- med ét forbehold: beviset gemmes i departure_evidence, IKKE i
-- quarantine_evidence, og der skrives ingen outbox-række (ingen alarm).
--
-- Hvorfor rytteren bliver i quarantined_rider_ids (og i expected_rider_ids):
-- de to lister ER datoens ejerskabs-semantik. register_training_date_work lader
-- et andet hold registrere rytteren samme dato, netop fordi han står i den
-- første række som karantæneret, og commit_training_date_tick tæller aktive
-- ryttere som expected − quarantined og springer ham over i tidligere-dato-
-- værnet. Alt det bevares uændret. Kun "manglende beviser" (missing_evidence,
-- bygget af quarantine_evidence + afregningernes huller) ser ham ikke længere,
-- så datoen ender complete i stedet for needs_reconciliation.
--
-- Server-side bevis: kun ryttere, der LIGE NU har riders.team_id IS NULL, tages
-- ud. Resten returneres ikke og karantæneres af kalderen som før (fx en rytter
-- på et andet hold uden åbnings-tilstand, eller en slettet rytter).
--
-- Status regnes med SAMME formel som commit_training_date_tick (6439/6490), så
-- de to aldrig er uenige om en dato.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE. Applies af
-- auto-migrate.yml ved merge (#2642); Claude post-verificerer.
--
-- Post-verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'training_date_work' AND column_name = 'departure_evidence';
--   SELECT has_function_privilege('authenticated',
--     'public.depart_training_date_riders(uuid,uuid,date,uuid[],timestamptz)', 'EXECUTE'); -- false
--   -- efter næste aftenafregning med frigivelser:
--   SELECT tick_date, jsonb_array_length(departure_evidence) FROM training_date_work
--   WHERE departure_evidence <> '[]' ORDER BY tick_date DESC LIMIT 5;

SET lock_timeout = '3s';

ALTER TABLE public.training_date_work
  ADD COLUMN IF NOT EXISTS departure_evidence jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Oprettelse + REVOKE + GRANT i én transaktion: funktionen er aldrig åben for PUBLIC.
BEGIN;
CREATE OR REPLACE FUNCTION public.depart_training_date_riders(
  p_team_id uuid, p_season_id uuid, p_tick_date date, p_rider_ids uuid[], p_now timestamptz DEFAULT clock_timestamp()
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE w public.training_date_work%ROWTYPE;new_ids uuid[];evidence jsonb;missing jsonb;active_count integer;receipt_count integer;new_status text;
BEGIN
  -- Samme låse og rækkefølge som quarantine_training_date_riders.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||p_tick_date::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('training-date:'||p_team_id::text,0));
  SELECT * INTO STRICT w FROM public.training_date_work WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date FOR UPDATE;
  IF p_rider_ids IS NULL OR NOT p_rider_ids<@w.expected_rider_ids THEN RAISE EXCEPTION 'Departure requires frozen roster IDs'; END IF;
  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id),'{}') INTO new_ids FROM unnest(p_rider_ids) id
    WHERE NOT id=ANY(w.quarantined_rider_ids)
      AND NOT EXISTS(SELECT 1 FROM public.training_condition_settlements s WHERE s.rider_id=id AND s.season_id=p_season_id AND s.tick_date=p_tick_date)
      AND EXISTS(SELECT 1 FROM public.riders r WHERE r.id=id AND r.team_id IS NULL);
  IF cardinality(new_ids)=0 THEN RETURN jsonb_build_object('departed_rider_ids','[]'::jsonb,'work_status',w.status); END IF;
  SELECT jsonb_agg(jsonb_build_object('rider_id',id,'kind','departed','reason','left_team','at',p_now,
    'applied_receipt_days',(SELECT COALESCE(jsonb_agg(game_day ORDER BY game_day),'[]') FROM public.training_rider_ticks WHERE rider_id=id AND season_id=p_season_id AND tick_date=p_tick_date),
    'opening_condition',w.opening_conditions->id::text)) INTO evidence FROM unnest(new_ids) id;
  w.quarantined_rider_ids:=w.quarantined_rider_ids||new_ids;
  w.departure_evidence:=COALESCE(w.departure_evidence,'[]'::jsonb)||evidence;
  -- missing_evidence: præcis som commit_training_date_tick, departure_evidence indgår ikke.
  SELECT COALESCE(jsonb_agg(e||jsonb_build_object('rider_id',s.rider_id) ORDER BY s.rider_id),'[]') INTO missing
    FROM public.training_condition_settlements s CROSS JOIN LATERAL jsonb_array_elements(s.missing_evidence)e
    WHERE s.season_id=p_season_id AND s.tick_date=p_tick_date AND s.rider_id=ANY(w.expected_rider_ids);
  SELECT missing||COALESCE(jsonb_agg(e-'opening_condition'-'current_condition'),'[]') INTO missing FROM jsonb_array_elements(w.quarantine_evidence)e;
  active_count:=cardinality(w.expected_rider_ids)-cardinality(w.quarantined_rider_ids);
  SELECT count(*) INTO receipt_count FROM public.training_rider_ticks WHERE season_id=p_season_id AND tick_date=p_tick_date
    AND rider_id=ANY(w.expected_rider_ids) AND NOT rider_id=ANY(w.quarantined_rider_ids);
  new_status:=CASE WHEN receipt_count=active_count*5 THEN CASE WHEN jsonb_array_length(missing)>0 THEN 'needs_reconciliation' ELSE 'complete' END
    ELSE w.status END;
  UPDATE public.training_date_work SET quarantined_rider_ids=w.quarantined_rider_ids,departure_evidence=w.departure_evidence,
    missing_evidence=missing,status=new_status,updated_at=p_now
    WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date RETURNING * INTO w;
  RETURN jsonb_build_object('departed_rider_ids',to_jsonb(new_ids),'work_status',new_status,'work',to_jsonb(w));
END;
$$;
REVOKE ALL ON FUNCTION public.depart_training_date_riders(uuid,uuid,date,uuid[],timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.depart_training_date_riders(uuid,uuid,date,uuid[],timestamptz) TO service_role;
COMMIT;
