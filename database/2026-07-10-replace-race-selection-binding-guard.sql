-- 2026-07-10 — Binding-guard INDE i replace_race_selection (#2256, TOCTOU-hul).
--
-- Rod-årsag: PUT /races/:raceId/selection læste binding-konteksten (hvilke ryttere
-- er optaget i overlappende løb) FØR RPC'ens advisory-lås blev taget. To næsten-
-- samtidige PUT'er til to overlappende løb kunne derfor begge passere app-lagets
-- overlap-tjek og begge gemme → samme rytter i to løb på samme in-game-dag
-- (bryder ejer-reglen "én rytter = ét løb pr. løbsdag, alle divisioner").
--
-- Fix: gentag overlap-tjekket INDE i RPC'en, EFTER pg_advisory_xact_lock på holdet,
-- så check+skriv er serialiseret pr. hold. App-lagets tjek beholdes som hurtig,
-- navngiven pre-flight (409 med bound_rider_ids); denne guard er den hårde garanti.
--
-- Nøgle-rum (spejler backend/lib/raceBinding.raceBindingWindow):
--   • Binding regnes i race_stage_schedule.game_day (in-game løbsdag). Et løbs
--     vindue = [min(game_day), max(game_day)]; to løb konflikter iff vinduerne
--     overlapper (inklusive ender). Monument-båndet (game_day >= 100000) bevares
--     automatisk: monumenter overlapper kun andre løb i samme høje bånd.
--   • Legacy-fallback: har ET af løbene IKKE game_day på ALLE etaper, springes
--     SQL-guarden over for det par (app-laget dækker CET-ordinal-fallbacken som
--     hidtil, best-effort). Vi blander ALDRIG game_day og CET-ordinaler i SQL.
--   • Afmeldte løb (race_withdrawals for holdet) binder ikke (Rod A, #1823).
--   • Kun entries for holdets EGNE rækker tjekkes, og kun for de ryttere der
--     faktisk gemmes (p_rider_ids) — ghost-/udlåns-entries for ryttere uden for
--     p_rider_ids kan derfor ikke phantom-afvise et gem (#1906-klassen).
--
-- Fejlkode: 'selection_rider_bound' (samme snake_case som app-laget), så ruten
-- kan mappe RPC-afvisningen til den eksisterende 409 + i18n-besked.
CREATE OR REPLACE FUNCTION public.replace_race_selection(
  p_team_id uuid,
  p_race_id uuid,
  p_rider_ids uuid[],
  p_roles text[]
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_len int := coalesce(array_length(p_rider_ids, 1), 0);
  v_start int;
  v_end int;
  v_full boolean;
BEGIN
  IF coalesce(array_length(p_roles, 1), 0) <> v_len THEN
    RAISE EXCEPTION 'selection_invalid_body' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialisér mod samtidige skriv til samme hold (samme nøgle som move_race_entry).
  PERFORM pg_advisory_xact_lock(hashtext(p_team_id::text));

  -- Binding-guard UNDER lås (#2256): afvis hvis en af de gemte ryttere allerede er
  -- committet i et ANDET, ikke-afmeldt løb hvis in-game-dag-vindue overlapper dette løbs.
  IF v_len > 0 THEN
    SELECT min(s.game_day), max(s.game_day), count(*) = count(s.game_day)
      INTO v_start, v_end, v_full
      FROM race_stage_schedule s
     WHERE s.race_id = p_race_id;

    -- Kun når DETTE løb er fuldt game_day-backfillet (ellers legacy-fallback i app-laget).
    IF v_full AND v_start IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
          FROM race_entries e
          JOIN LATERAL (
            SELECT min(s2.game_day) AS w_start,
                   max(s2.game_day) AS w_end,
                   count(*) = count(s2.game_day) AS w_full
              FROM race_stage_schedule s2
             WHERE s2.race_id = e.race_id
          ) w ON true
         WHERE e.team_id = p_team_id
           AND e.race_id <> p_race_id
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
$$;

COMMENT ON FUNCTION public.replace_race_selection(uuid, uuid, uuid[], text[]) IS
  'Atomisk erstat holdets race_entries for ét løb (#2173) + overlap-binding-guard '
  'under advisory-lås (#2256): afviser selection_rider_bound hvis en gemt rytter '
  'allerede er committet i et andet ikke-afmeldt løb med overlappende game_day-vindue. '
  'is_auto_filled=false (manuel udtagelse).';
