-- #3076 — replace_race_selection: binding-guarden må ikke krydse sæsongrænsen.
--
-- Rod-årsag (samme som #3070, men i DB-laget): guarden sammenligner in-game-dag-
-- vinduer (race_stage_schedule.game_day) mellem det løb man gemmer til og holdets
-- entries i ANDRE løb. game_day er SÆSON-RELATIV og nulstilles hver sæson — i prod
-- spænder både sæson 1 og sæson 2 game_day 0..~100000. Uden sæson-filter binder en
-- sæson-1-entry på game_day 4 et sæson-2-løb der spænder game_day 0-6, og RAISE
-- EXCEPTION 'selection_rider_bound' afviser gemningen.
--
-- #3070 fiksede app-lagets pre-flight-tjek (loadTeamBindingContext), men DENNE guard
-- kører UNDER advisory-låsen inde i RPC'en og er derfor en selvstændig afvisningsvej:
-- efter #3070 blev rytterne vist som ledige i UI'et, men gemningen fejlede stadig.
-- Rapporteret i Discord 27/7 af ez4prebren, smukkethomsen, jonasnielsen_05591
-- ("Jeg kan ikke få lov til at gemme mine hold, til de 2 første løb").
--
-- Ændring: JOIN races på entry-løbet og kræv samme season_id som p_race_id's løb.
-- IS NOT DISTINCT FROM (ikke =) så to løb der begge mangler season_id fortsat binder
-- hinanden — uændret legacy-adfærd, ingen tavs afkobling ved NULL.
--
-- Idempotent: CREATE OR REPLACE. Ikke-destruktiv: ingen DDL på tabeller, ingen
-- data-mutation. Kun funktionskroppen ændres.

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
  -- committet i et ANDET, ikke-afmeldt løb hvis in-game-dag-vindue overlapper dette løbs.
  -- #3076: kun løb i SAMME sæson kan binde — game_day er sæson-relativ.
  IF v_len > 0 THEN
    SELECT min(s.game_day), max(s.game_day), count(*) = count(s.game_day)
      INTO v_start, v_end, v_full
      FROM race_stage_schedule s
     WHERE s.race_id = p_race_id;

    SELECT r.season_id INTO v_season_id FROM races r WHERE r.id = p_race_id;

    -- Kun når DETTE løb er fuldt game_day-backfillet (ellers legacy-fallback i app-laget).
    IF v_full AND v_start IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
          FROM race_entries e
          JOIN races r2 ON r2.id = e.race_id
          JOIN LATERAL (
            SELECT min(s2.game_day) AS w_start,
                   max(s2.game_day) AS w_end,
                   count(*) = count(s2.game_day) AS w_full
              FROM race_stage_schedule s2
             WHERE s2.race_id = e.race_id
          ) w ON true
         WHERE e.team_id = p_team_id
           AND e.race_id <> p_race_id
           AND r2.season_id IS NOT DISTINCT FROM v_season_id
           AND e.rider_id = ANY (p_rider_ids)
           AND NOT EXISTS (
             SELECT 1 FROM race_withdrawals rw
              WHERE rw.race_id = e.race_id AND rw.team_id = p_team_id
           )
           AND w.w_full
           AND w.w_start IS NOT NULL
           AND w.w_start <= v_end
           AND v_start <= w.w_end
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
