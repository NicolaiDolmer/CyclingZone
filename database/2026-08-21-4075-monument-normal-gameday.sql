-- #4075 / spec §3.4 (B2, ejer-låst 21/8) — monumenter har NORMAL game_day.
--
-- 100000-sentinelen (MONUMENT_GAMEDAY_BASE) er fjernet fra kalender-generatoren:
-- et monument får nu sin egen, EKSKLUSIVE in-game-løbsdag i sit eget tidsslot
-- (ingen modløb på samme game_day; andre løb må ligge i datoens øvrige slots).
-- Dermed bortfalder hele den pulje-lokale monument-afledning i DB-laget:
--
--   1. replace_race_selection (#3290's v_is_monument-gren + LATERAL-afledning)
--      reduceres til den rene sæson-scopede naive {min,max}(game_day)-guard —
--      som nu er KORREKT for monumenter, fordi deres game_day er ægte.
--   2. race_entries_binding_span (#3420's `min(game_day) >= 100000 → NULL`-case)
--      fjernes, så monument-entries får et normalt int4range og dermed bliver
--      bindende via no_rider_double_booking-EXCLUDE-constrainten som alle andre.
--
-- Tabeller, triggere og constrainten fra #3420 er UÆNDREDE — kun de to
-- funktionskroppe (+ kommentarer) erstattes. Idempotent: CREATE OR REPLACE.
-- APPLY: orkestrator applier post-merge under #2642-rammerne (post-verify:
-- pg_get_functiondef for begge funktioner må ikke længere indeholde '100000').
--
-- FORUDSÆTNING for korrekt binding: sæsonens monument-rækker i
-- race_stage_schedule skal have normale game_day-værdier (S3 omnummereres af
-- kalender-regenereringen i samme session). Gamle sæsoners (S1/S2) sentinel-
-- rækker er historiske og ikke-bindende i forvejen (status=completed → NULL).
--
-- Refs #4075, #3290, #3420, #3114, #3076, #2256.

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
  -- #4075: monumenter har normal game_day, så det naive vindue er korrekt for alle løb.
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

COMMENT ON FUNCTION public.replace_race_selection(uuid, uuid, uuid[], text[]) IS
  'Atomisk erstat holdets race_entries for ét løb (#2173) + overlap-binding-guard '
  'under advisory-lås (#2256), sæson-scopet (#3076). #4075: monumenter har normal '
  'game_day, så den naive {min,max}(game_day)-guard dækker alle løb — den pulje-lokale '
  'monument-afledning (#3290) er fjernet. Afviser selection_rider_bound hvis en gemt '
  'rytter allerede er committet i et andet ikke-afmeldt løb med overlappende '
  'game_day-vindue. is_auto_filled=false (manuel udtagelse).';

CREATE OR REPLACE FUNCTION public.race_entries_binding_span(p_race_id uuid, p_team_id uuid)
RETURNS int4range
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  select case
    -- Færdigkørte løb er ikke-bindende (#3420, ejer-valg 18/8): constrainten skal
    -- beskytte FREMTIDIGE skrivninger.
    when exists (
      select 1 from public.races r
       where r.id = p_race_id and r.status = 'completed'
    ) then null::int4range
    when exists (
      select 1 from public.race_withdrawals w
       where w.race_id = p_race_id and w.team_id = p_team_id
    ) then null::int4range
    else (
      select case
        when count(*) = 0 then null::int4range
        -- delvist backfillet schedule (nogle rækker mangler game_day) → kan ikke
        -- udlede et sikkert span, spejler raceBindingWindow's useGameDay-alt-eller-intet.
        when count(*) filter (where s.game_day is null) > 0 then null::int4range
        -- #4075: monument-sentinel-casen (>= 100000 → NULL) er fjernet — monumenter
        -- har normal game_day og binder som alle andre løb.
        else int4range(min(s.game_day), max(s.game_day), '[]')
      end
      from public.race_stage_schedule s
      where s.race_id = p_race_id
    )
  end;
$$;

COMMENT ON FUNCTION public.race_entries_binding_span(uuid, uuid) is
  '#3420: ren beregning af race_entries.binding_span for ét (race_id, team_id)-par.
  NULL for færdigkørte løb (status=completed), afmeldte løb og løb uden fuldt
  game_day-backfillet schedule. #4075: monumenter binder normalt (sentinel-casen
  fjernet). Ellers int4range(min(game_day), max(game_day), inklusiv).';
