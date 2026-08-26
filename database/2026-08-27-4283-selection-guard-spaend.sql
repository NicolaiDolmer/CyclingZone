-- #4283 — replace_race_selection: binding-guarden skal matche #4217-spændet, ikke kun
-- de faktiske etape-dage.
--
-- ROD-ÅRSAG. #4217 gjorde bindingen til HELE spændet min(game_day)..max(game_day)
-- (race_entry_days_rebuild bruger generate_series — GT-hviledage og pausedage bindes).
-- RPC'ens egen pre-flight-guard (#2256) blev IKKE opdateret tilsvarende: dens EXISTS
-- joiner race_entry_days (andre løbs SPÆND) mod race_stage_schedule for p_race_id —
-- dvs. kun DETTE løbs FAKTISKE etape-dage. Ligger den eneste overlappende dag i dette
-- løbs eget hul (GT-hviledag/pausedag), ser guarden ingen konflikt og lader insert'en
-- køre. Invarianten reddes stadig af no_rider_double_booking_day (AFTER-triggerens
-- rebuild kaster 23505), men fejlen når app-laget som en rå unique_violation i stedet
-- for RPC'ens navngivne 'selection_rider_bound'.
--
-- app-laget (raceSelection.js:saveSelection) klassificerer fra #4283 OGSÅ rå
-- 23505/no_rider_double_booking som 'selection_rider_bound' (belt-and-suspenders),
-- men guarden bør afvise korrekt selv: samme mængde-semantik i alle tre lag
-- (JS-pre-flight = RPC-guard = race_entry_days_rebuild).
--
-- HVAD DER ÆNDRES. Guardens JOIN på race_stage_schedule erstattes af
-- generate_series(v_start, v_end) — præcis samme spænd som race_entry_days_rebuild
-- skriver og raceBindingWindow (JS) håndhæver. v_start/v_end fandtes allerede.
-- Alt andet i funktionen er uændret (advisory-lås, sæson-filter, delete+insert).
--
-- IDEMPOTENT. CREATE OR REPLACE; ingen data røres. Kan køres ubegrænset.
--
-- POST-VERIFY (read-only):
--   select pg_get_functiondef('public.replace_race_selection(uuid,uuid,uuid[],text[])'::regprocedure);
--   -- forventet: guarden bruger generate_series(v_start, v_end), ingen JOIN på
--   -- race_stage_schedule i EXISTS'en.
--
-- Refs #4283 #4217 #2256 #4173 #3420
begin;

CREATE OR REPLACE FUNCTION public.replace_race_selection(p_team_id uuid, p_race_id uuid, p_rider_ids uuid[], p_roles text[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_len int := coalesce(array_length(p_rider_ids, 1), 0);
  v_start int;
  v_end int;
  v_full boolean;
  v_season_id uuid;
BEGIN
  IF coalesce(array_length(p_roles, 1), 0) <> v_len THEN
    RAISE EXCEPTION 'selection_invalid_body' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialisér mod samtidige skriv til samme hold (samme nøgle som move_race_entry).
  PERFORM pg_advisory_xact_lock(hashtext(p_team_id::text));

  -- Binding-guard UNDER lås (#2256): afvis hvis en af de gemte ryttere allerede er
  -- committet i et ANDET, ikke-afmeldt løb der deler en løbsdag med dette løbs SPÆND
  -- (#4217 — hele min..max inkl. hvile-/pausedage, samme mængde som
  -- race_entry_days_rebuild skriver). #3076: kun løb i SAMME sæson kan binde.
  IF v_len > 0 THEN
    SELECT r.season_id INTO v_season_id
      FROM races r WHERE r.id = p_race_id;

    SELECT min(s.game_day), max(s.game_day), count(*) = count(s.game_day)
      INTO v_start, v_end, v_full
      FROM race_stage_schedule s
     WHERE s.race_id = p_race_id;

    -- Kun når DETTE løb er fuldt game_day-backfillet (ellers legacy-fallback i app-laget).
    IF v_full AND v_start IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
          FROM race_entry_days d
          JOIN generate_series(v_start, v_end) AS gs(game_day)
            ON gs.game_day = d.game_day
         WHERE d.team_id = p_team_id
           AND d.race_id <> p_race_id
           AND d.season_id IS NOT DISTINCT FROM v_season_id
           AND d.rider_id = ANY (p_rider_ids)
      ) THEN
        RAISE EXCEPTION 'selection_rider_bound' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- Erstat holdets entries for løbet atomisk (hele delete+insert i denne transaktion).
  DELETE FROM race_entries WHERE race_id = p_race_id AND team_id = p_team_id;

  IF v_len > 0 THEN
    INSERT INTO race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
    SELECT p_race_id, p_rider_ids[i], p_team_id, p_roles[i], false
    FROM generate_series(1, v_len) AS g(i);
  END IF;
END;
$function$;

commit;
