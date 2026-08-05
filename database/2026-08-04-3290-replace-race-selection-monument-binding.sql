-- #3290 — replace_race_selection: RPC'ens interne binding-guard har SAMME Monument-hul
-- som #3114, men kun for en snæver samtidigheds-case.
--
-- Rod-årsag: #3114/PR #3278 lukkede save-guard-hullet i APP-laget
-- (backend/lib/raceBinding.js: loadTeamBindingContext). Men den ATOMARE hård-garanti
-- INDE i denne RPC (kører UNDER pg_advisory_xact_lock, se #2256/
-- database/2026-07-10-replace-race-selection-binding-guard.sql) brugte STADIG det
-- naive {min,max}(game_day)-vindue for et Monument-løb. Monuments får deres game_day
-- fra lane-packerens bevidste 100000-sentinel (MONUMENT_GAMEDAY_BASE,
-- backend/lib/raceCalendarLanePacker.js) — IKKE en ægte in-game-dag — så et sådant
-- vindue ({100000+}) kan ALDRIG overlappe et normalt løbs vindue (0..~88). To næsten-
-- samtidige manuelle PUT'er til to overlappende løb (ét Monument, ét normalt) kunne
-- derfor i teorien begge passere app-lagets pre-check (der nu afleder korrekt siden
-- PR #3278) FØR den anden har committet — og RPC'ens egen guard, som er den sidste,
-- hårde linje, ville ikke fange dobbeltbookingen.
--
-- Fix (SAMME mønster som #3114/PR #3278's loadPoolLocalCetSpans +
-- deriveMonumentBindingWindow i backend/lib/raceBinding.js): når et løb (p_race_id
-- ELLER et af holdets andre committede løb) har HELE sin schedule i monument-båndet
-- (alle game_day >= 100000), afledes dets binding-vindue on-demand som unionen af de
-- NORMALE løbs game_day-spans i SAMME sæson + SAMME pulje (league_division_id,
-- IS NOT DISTINCT FROM — spejler #3076's season_id-mønster) der deler løbets danske
-- kalenderdag(e) (scheduled_at AT TIME ZONE 'Europe/Copenhagen'). Kører intet normalt
-- løb den dag → vinduet forbliver NULL og guarden springes over for det løb — samme
-- konservative "kan ikke håndhæves"-fallback som hidtil, ingen falsk positiv.
--
-- Verificeret READ-ONLY mod prod 4/8 (execute_sql, ingen mutation):
--   • Monument 5d596bad-77c1-4071-9752-dc681175e14c (De Vlaamse Ronde, S2, D1):
--     derived_start=3, derived_end=4, matched_rows=4 — matcher PR #3278's
--     dokumenterede verifikation og de eksisterende unit-test-fixtures i
--     raceBinding.test.js.
--   • Monument 06393f32-16be-4847-b06e-1ead3723906e (La Doyenne des Ardennes, S1, D1),
--     via den GENERISKE form af formlen nedenfor (samme SQL som indlejres i LATERAL-
--     joinet for "et af holdets andre løb"): n_full=true, n_is_monument=true,
--     derived_start=23, derived_end=25 — et gyldigt, ikke-sentinel vindue, hvor det
--     naive vindue ville have været {100000,100000}.
--
-- Idempotent: CREATE OR REPLACE. Ikke-destruktiv: ingen DDL på tabeller, ingen
-- data-mutation. Kun funktionskroppen (+ dens COMMENT) ændres. APPLY IKKE her —
-- orkestrator applier post-merge under #2642-rammerne (idempotent + post-verify).
--
-- Refs #3290, #3114, #3076, #2256.

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
  v_league_division_id integer;
  v_is_monument boolean;
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
    SELECT r.season_id, r.league_division_id INTO v_season_id, v_league_division_id
      FROM races r WHERE r.id = p_race_id;

    SELECT min(s.game_day), max(s.game_day), count(*) = count(s.game_day)
      INTO v_start, v_end, v_full
      FROM race_stage_schedule s
     WHERE s.race_id = p_race_id;

    -- #3290: er DETTE løb et Monument (hele dets schedule i 100000-sentinelbåndet)?
    -- Så er {v_start,v_end} det naive vindue der aldrig kan overlappe et normalt løb —
    -- aflede i stedet det pulje-lokale game_day-vindue (samme afledning som app-laget).
    v_is_monument := v_full AND v_start IS NOT NULL AND v_start >= 100000;
    IF v_is_monument THEN
      SELECT min(s2.game_day), max(s2.game_day)
        INTO v_start, v_end
        FROM race_stage_schedule s2
        JOIN races r2 ON r2.id = s2.race_id
       WHERE r2.season_id = v_season_id
         AND r2.league_division_id IS NOT DISTINCT FROM v_league_division_id
         AND s2.game_day IS NOT NULL AND s2.game_day < 100000
         AND (s2.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date IN (
           SELECT DISTINCT (s1.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date
             FROM race_stage_schedule s1
            WHERE s1.race_id = p_race_id
         );
      v_full := v_start IS NOT NULL;
    END IF;

    -- Kun når DETTE løb er fuldt game_day-backfillet (ellers legacy-fallback i
    -- app-laget) ELLER har fået et gyldigt afledt Monument-vindue ovenfor.
    IF v_full AND v_start IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
          FROM race_entries e
          JOIN races r2 ON r2.id = e.race_id
          JOIN LATERAL (
            SELECT
              CASE WHEN naive.n_is_monument THEN mon.d_start ELSE naive.n_start END AS w_start,
              CASE WHEN naive.n_is_monument THEN mon.d_end ELSE naive.n_end END AS w_end,
              CASE WHEN naive.n_is_monument THEN mon.d_start IS NOT NULL ELSE naive.n_full END AS w_full
              FROM (
                SELECT min(s2.game_day) AS n_start,
                       max(s2.game_day) AS n_end,
                       count(*) = count(s2.game_day) AS n_full,
                       coalesce(bool_and(s2.game_day IS NOT NULL AND s2.game_day >= 100000), false) AS n_is_monument
                  FROM race_stage_schedule s2
                 WHERE s2.race_id = e.race_id
              ) naive
              LEFT JOIN LATERAL (
                -- #3290: samme pulje-lokale afledning som ovenfor, men for et af
                -- holdets ANDRE committede løb — kører kun reelt når det ER et
                -- Monument (naive.n_is_monument), ellers NULL (uden effekt, se CASE).
                SELECT min(s3.game_day) AS d_start, max(s3.game_day) AS d_end
                  FROM race_stage_schedule s3
                  JOIN races r3 ON r3.id = s3.race_id
                 WHERE naive.n_is_monument
                   AND r3.season_id = r2.season_id
                   AND r3.league_division_id IS NOT DISTINCT FROM r2.league_division_id
                   AND s3.game_day IS NOT NULL AND s3.game_day < 100000
                   AND (s3.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date IN (
                     SELECT DISTINCT (s4.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date
                       FROM race_stage_schedule s4
                      WHERE s4.race_id = e.race_id
                   )
              ) mon ON true
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
  'under advisory-lås (#2256), sæson-scopet (#3076), Monument-pulje-lokal afledning '
  '(#3290, spejler backend/lib/raceBinding.js): afviser selection_rider_bound hvis en '
  'gemt rytter allerede er committet i et andet ikke-afmeldt løb med overlappende '
  'game_day-vindue (Monument-løb afleder vinduet pulje-lokalt fra normale løb i samme '
  'sæson+pulje på samme danske kalenderdag i stedet for det naive 100000-sentinelvindue). '
  'is_auto_filled=false (manuel udtagelse).';
