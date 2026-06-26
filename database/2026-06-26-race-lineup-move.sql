-- 2026-06-26 — Atomisk "flyt rytter til løb" (#1925-followup, race-lineup move).
-- Sletter rytterens entry i kilde-løbet (hvis givet) og indsætter i mål-løbet i ÉN
-- transaktion under advisory-lås på holdet (undgår dobbelt-booking-race + #1924's
-- ikke-transaktionelle saveSelection-degrade). Cap-tjek på målet sker inde i låsen.
-- p_from_race_id NULL = ren tilføj (intet at evicte). Idempotent på re-kør.
CREATE OR REPLACE FUNCTION public.move_race_entry(
  p_team_id uuid, p_rider_id uuid, p_from_race_id uuid, p_to_race_id uuid, p_max int
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_team_id::text));

  IF p_from_race_id IS NOT NULL THEN
    DELETE FROM race_entries
      WHERE team_id = p_team_id AND rider_id = p_rider_id AND race_id = p_from_race_id;
  END IF;

  -- Allerede i målet? Så er der intet at gøre (idempotent).
  IF EXISTS (SELECT 1 FROM race_entries WHERE race_id = p_to_race_id AND rider_id = p_rider_id) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_count FROM race_entries WHERE race_id = p_to_race_id AND team_id = p_team_id;
  IF v_count >= p_max THEN
    RAISE EXCEPTION 'move_target_full' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
    VALUES (p_to_race_id, p_rider_id, p_team_id, 'helper', false);
END;
$$;
