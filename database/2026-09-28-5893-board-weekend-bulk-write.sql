-- #5893 — Board-weekend skriver i ÉN transaktion i stedet for ~2 kald pr. board.
--
-- HVORFOR: processBoardWeekendFinalization kører efter HVERT afsluttet løb og
-- opdaterede hvert menneskeholds board med én PATCH på board_profiles + én
-- upsert på board_satisfaction_events. Målt i prod 28/9 (S4 løbsdag 1):
-- board-trinnet = 880 DB-kald / 23 s for ÉT løb, selv på en rask database. Ti
-- seniorløb der slutter samtidig (20:00-slottet) gav ~4.400 enkelt-skrivninger
-- på få minutter og to DB-udfald (19:53-19:56 og 20:12-20:20).
--
-- HVAD: apply_board_weekend_writes(p_profiles, p_events) anvender præcis de
-- samme skrivninger som JS-stien, bare set-baseret:
--   · p_profiles: [{id, satisfaction, budget_modifier?, season_start_satisfaction?,
--     season_start_anchor_season_id?, updated_at}] — nøgler der mangler i en
--     række lader kolonnen urørt (baseline-boards sætter kun satisfaction +
--     updated_at, præcis som i dag).
--   · p_events: rækker til board_satisfaction_events (egen undertransaktion:
--     en event-fejl ruller ALDRIG satisfaction tilbage, den returneres som
--     events_error — samme garanti som JS-stien, #1451). ON CONFLICT
--     (board_id, race_id) DO UPDATE = samme semantik som PostgREST-upsert'en med
--     onConflict "board_id,race_id" (created_at bevares ved konflikt).
-- Samme spilregler, samme tal: beregningen bliver i JS; kun I/O'en samles.
--
-- SIKKERHED: kun backend (service_role) må kalde den. SECURITY INVOKER — den
-- kører med kalderens rettigheder, og service_role har allerede skriveadgang
-- til begge tabeller. EXECUTE fjernes fra PUBLIC/anon/authenticated.
--
-- IDEMPOTENT: CREATE OR REPLACE + REVOKE/GRANT kan køres igen uden effekt.

CREATE OR REPLACE FUNCTION public.apply_board_weekend_writes(
  p_profiles jsonb,
  p_events jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_profiles integer := 0;
  v_events integer := 0;
  v_events_error text := NULL;
BEGIN
  WITH src AS (
    SELECT
      (e->>'id')::uuid AS id,
      (e->>'satisfaction')::integer AS satisfaction,
      e ? 'budget_modifier' AS set_modifier,
      (e->>'budget_modifier')::double precision AS budget_modifier,
      e ? 'season_start_satisfaction' AS set_anchor,
      (e->>'season_start_satisfaction')::integer AS season_start_satisfaction,
      (e->>'season_start_anchor_season_id')::uuid AS season_start_anchor_season_id,
      (e->>'updated_at')::timestamptz AS updated_at
    FROM jsonb_array_elements(coalesce(p_profiles, '[]'::jsonb)) AS e
  )
  UPDATE public.board_profiles bp
  SET
    satisfaction = src.satisfaction,
    budget_modifier = CASE WHEN src.set_modifier THEN src.budget_modifier ELSE bp.budget_modifier END,
    season_start_satisfaction = CASE WHEN src.set_anchor THEN src.season_start_satisfaction ELSE bp.season_start_satisfaction END,
    season_start_anchor_season_id = CASE WHEN src.set_anchor THEN src.season_start_anchor_season_id ELSE bp.season_start_anchor_season_id END,
    updated_at = coalesce(src.updated_at, now())
  FROM src
  WHERE bp.id = src.id;
  GET DIAGNOSTICS v_profiles = ROW_COUNT;

  -- Events er visnings-only (#1451): en event-fejl må ALDRIG rulle
  -- bestyrelsernes satisfaction tilbage. Egen undertransaktion (savepoint);
  -- fejlen returneres til kalderen i stedet for at vælte hele kaldet.
  BEGIN
    INSERT INTO public.board_satisfaction_events (
      board_id, team_id, season_id, race_id, race_name, race_days_completed,
      satisfaction_before, satisfaction_after, satisfaction_delta,
      goals_met, goals_total, reason_category
    )
    SELECT
      (e->>'board_id')::uuid,
      (e->>'team_id')::uuid,
      (e->>'season_id')::uuid,
      (e->>'race_id')::uuid,
      e->>'race_name',
      (e->>'race_days_completed')::integer,
      (e->>'satisfaction_before')::integer,
      (e->>'satisfaction_after')::integer,
      (e->>'satisfaction_delta')::integer,
      coalesce((e->>'goals_met')::integer, 0),
      coalesce((e->>'goals_total')::integer, 0),
      e->>'reason_category'
    FROM jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) AS e
    ON CONFLICT (board_id, race_id) DO UPDATE SET
      team_id = EXCLUDED.team_id,
      season_id = EXCLUDED.season_id,
      race_name = EXCLUDED.race_name,
      race_days_completed = EXCLUDED.race_days_completed,
      satisfaction_before = EXCLUDED.satisfaction_before,
      satisfaction_after = EXCLUDED.satisfaction_after,
      satisfaction_delta = EXCLUDED.satisfaction_delta,
      goals_met = EXCLUDED.goals_met,
      goals_total = EXCLUDED.goals_total,
      reason_category = EXCLUDED.reason_category;
    GET DIAGNOSTICS v_events = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_events := 0;
    v_events_error := SQLERRM;
  END;

  RETURN jsonb_build_object('profiles', v_profiles, 'events', v_events, 'events_error', v_events_error);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_board_weekend_writes(jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_board_weekend_writes(jsonb, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_board_weekend_writes(jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_board_weekend_writes(jsonb, jsonb) TO service_role;
