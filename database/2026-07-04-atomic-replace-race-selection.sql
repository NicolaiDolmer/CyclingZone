-- 2026-07-04 — Atomisk "gem holdudtagelse" (#2173, lineup silent save).
--
-- Rod-årsag: saveSelection lavede delete-then-insert UDEN transaktion
-- ("accepteret degradering"). Fejlede insert efter delete → løbet stod med 0
-- entries (tavst tab, dækket af autopick ved race-tid). Det er præcis den
-- data-integritetsfejl #2173 forbyder. Denne RPC erstatter holdets entries for
-- ét løb i ÉN transaktion under en advisory-lås på holdet, så et gem enten
-- lykkes fuldt eller ruller helt tilbage (og en samtidig PUT til samme hold
-- serialiseres i stedet for at flette to delvise skriv).
--
-- Spejler move_race_entry (2026-06-26): samme advisory-lås-nøgle (hashtext på
-- team_id), samme SET search_path, samme snake_case-fejlkode-konvention, så
-- rute-laget kan mappe RAISE EXCEPTION-koden til en i18n-besked.
--
-- p_rider_ids[] i samme rækkefølge som p_roles[] (parallelle arrays). Tom trup
-- (p_rider_ids = '{}') er gyldig: holdet ryddes for løbet (delvis/ingen trup er
-- tilladt; motoren top-fylder ved race-tid). is_auto_filled sættes altid false
-- (dette er en MANUEL udtagelse — det er hele pointen med et eksplicit gem).
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
BEGIN
  IF coalesce(array_length(p_roles, 1), 0) <> v_len THEN
    RAISE EXCEPTION 'selection_invalid_body' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialisér mod samtidige skriv til samme hold (samme nøgle som move_race_entry).
  PERFORM pg_advisory_xact_lock(hashtext(p_team_id::text));

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
  'Atomisk erstat holdets race_entries for ét løb (#2173). Delete+insert i én '
  'transaktion under advisory-lås på holdet, så et gem aldrig efterlader løbet '
  'med et delvist/tomt sæt. is_auto_filled=false (manuel udtagelse).';
