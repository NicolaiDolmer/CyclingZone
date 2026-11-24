-- #8606 (22/11): en rytter, der kommer til holdet efter at datoen er registreret, mister
-- ikke laengere datoen. Samme ejer-princip som #7832 (7/11): "Et hold skal altid kunne
-- traene, ogsaa som helt ny spiller paa foerste dag", nu for den enkelte rytter.
--
-- PROBLEMET. register_training_date_work fryser datoens trup ved foerste registrering og
-- aendrer den aldrig. #6439 lader en rytter, der skifter hold midt paa datoen, traene
-- faerdigt i den trup han stod i. En rytter, der ikke staar i NOGEN trup paa datoen (ny
-- akademirytter, fri agent, rytter fra et hold uden registreret dato), blev derfor aldrig
-- traenet: hverken Traen nu eller aftenkoerslen udvider truppen. Efter #7982 registreres
-- datoen allerede ved dagens foerste etape, saa vinduet blev hele eftermiddagen.
--
-- LOESNINGEN. En SEPARAT funktion, kun kaldt af aftenkoerslen (backend/lib/trainingDateClose.js)
-- for holdets nuvaerende ryttere uden for den frosne trup. Den tilfoejer en rytter, kun naar
-- det kan bevises, at ingen anden har ham paa datoen:
--   · han staar paa holdet nu, er ikke pensioneret og kom til holdet foer datoens slutning,
--   · han staar ikke i et andet holds trup paa datoen (#6439 bestemmer dér),
--   · han har ingen kvittering, ingen Traen nu-laas og ingen etapebelastning paa datoen,
--     og ingen kvittering eller tilstands-afregning paa en senere dato,
--   · han har ingen uafsluttet tidligere dato (samme regel som commit_training_date_tick),
--   · han har en tilstand (rider_condition); den gemmes som hans starttilstand nu,
--   · datoens frist er ikke passeret, og datoen er ikke sendt til afstemning.
-- En 'complete' dato bliver 'partial' igen, saa koerslen afregner den nye rytter; de andre
-- rytteres kvitteringer roeres ikke. register_training_date_work, commit_training_date_tick
-- og Traen nu er uaendrede.
--
-- Mangler funktionen (deploy-vinduet foer auto-migrate), tilfoejer backend ingen ryttere
-- (praecis som foer) og proever igen naeste tick.
-- Additiv og idempotent: CREATE OR REPLACE. Funktion og rettigheder i een transaktion
-- (#6342). Ingen data aendres af selve migrationen.
--
-- POST-VERIFY (read-only, efter apply):
--   SELECT p.proname, p.proconfig, has_function_privilege('anon',p.oid,'EXECUTE') anon,
--          has_function_privilege('authenticated',p.oid,'EXECUTE') auth,
--          has_function_privilege('service_role',p.oid,'EXECUTE') service
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname='admit_late_training_date_riders';
--   -- forventet: een raekke, search_path=public, pg_temp; anon=f, auth=f, service=t
--
-- ROLLBACK: DROP FUNCTION public.admit_late_training_date_riders(uuid,uuid,date,uuid[],timestamptz);
-- (backend falder da tilbage til den gamle adfaerd: ingen ryttere tilfoejes.)

BEGIN;

CREATE OR REPLACE FUNCTION public.admit_late_training_date_riders(p_team_id uuid, p_season_id uuid, p_tick_date date, p_rider_ids uuid[], p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_work public.training_date_work%ROWTYPE;v_end timestamptz;v_admit uuid[];v_openings jsonb;
BEGIN
  IF p_rider_ids IS NULL OR array_position(p_rider_ids,NULL) IS NOT NULL OR p_now IS NULL THEN RAISE EXCEPTION 'Verified late rider list required'; END IF;
  -- Same lock order as register/commit/quarantine, including the cutover exclusion.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||p_tick_date::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('training-date:'||p_team_id::text,0));
  SELECT * INTO v_work FROM public.training_date_work
    WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('admitted_rider_ids','[]'::jsonb,'work',NULL); END IF;
  IF v_work.status NOT IN('pending','partial','complete') OR p_now>=v_work.deadline_at OR cardinality(p_rider_ids)=0 THEN
    RETURN jsonb_build_object('admitted_rider_ids','[]'::jsonb,'work',to_jsonb(v_work));
  END IF;
  v_end:=(p_tick_date+1)::timestamp AT TIME ZONE 'Europe/Copenhagen';
  PERFORM id FROM public.riders WHERE id=ANY(p_rider_ids) ORDER BY id FOR UPDATE;
  PERFORM rider_id FROM public.rider_condition WHERE rider_id=ANY(p_rider_ids) ORDER BY rider_id FOR UPDATE;
  SELECT COALESCE(array_agg(DISTINCT r.id ORDER BY r.id),'{}'::uuid[]) INTO v_admit
    FROM public.riders r JOIN public.rider_condition c ON c.rider_id=r.id
    WHERE r.id=ANY(p_rider_ids) AND r.team_id=p_team_id AND r.is_retired IS NOT TRUE
      AND NOT r.id=ANY(v_work.expected_rider_ids)
      AND (r.created_at IS NULL OR r.created_at<v_end) AND (r.acquired_at IS NULL OR r.acquired_at<v_end)
      -- #6439: another team's frozen roster keeps him for this date.
      AND NOT EXISTS(SELECT 1 FROM public.training_date_work o WHERE o.season_id=p_season_id AND o.tick_date=p_tick_date
        AND o.team_id<>p_team_id AND o.expected_rider_ids @> ARRAY[r.id] AND NOT r.id=ANY(o.quarantined_rider_ids))
      -- Nothing may have trained, pressed, raced or settled him on this date or later.
      AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=r.id AND t.tick_date>=p_tick_date)
      AND NOT EXISTS(SELECT 1 FROM public.training_condition_settlements s WHERE s.rider_id=r.id AND s.tick_date>=p_tick_date)
      AND NOT EXISTS(SELECT 1 FROM public.training_train_now_locks l WHERE l.rider_id=r.id AND l.tick_date=p_tick_date)
      AND NOT EXISTS(SELECT 1 FROM public.training_race_loads l WHERE l.rider_id=r.id AND l.tick_date=p_tick_date)
      -- Same rule as commit_training_date_tick: an unsettled earlier date would fail his commit.
      AND NOT EXISTS(SELECT 1 FROM public.training_date_work older
        WHERE older.season_id=p_season_id AND older.tick_date<p_tick_date AND older.expected_rider_ids @> ARRAY[r.id]
          AND NOT r.id=ANY(older.quarantined_rider_ids)
          AND NOT EXISTS(SELECT 1 FROM public.training_condition_settlements s WHERE s.rider_id=r.id AND s.season_id=p_season_id AND s.tick_date=older.tick_date));
  IF cardinality(v_admit)=0 THEN RETURN jsonb_build_object('admitted_rider_ids','[]'::jsonb,'work',to_jsonb(v_work)); END IF;
  -- His opening is his condition now: nothing has moved it on this date (checked above).
  SELECT COALESCE(jsonb_object_agg(rider_id::text,to_jsonb(c)),'{}') INTO v_openings FROM public.rider_condition c WHERE rider_id=ANY(v_admit);
  UPDATE public.training_date_work SET
      expected_rider_ids=(SELECT array_agg(DISTINCT rider ORDER BY rider) FROM unnest(expected_rider_ids||v_admit) rider),
      opening_conditions=COALESCE(opening_conditions,'{}'::jsonb)||v_openings,
      status=CASE WHEN status='complete' THEN 'partial' ELSE status END,
      updated_at=p_now
    WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date
    RETURNING * INTO STRICT v_work;
  RETURN jsonb_build_object('admitted_rider_ids',to_jsonb(v_admit),'work',to_jsonb(v_work));
END;
$function$;

REVOKE ALL ON FUNCTION public.admit_late_training_date_riders(uuid,uuid,date,uuid[],timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_late_training_date_riders(uuid,uuid,date,uuid[],timestamptz) TO service_role;

COMMIT;
