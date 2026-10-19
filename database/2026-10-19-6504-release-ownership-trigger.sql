-- #6504 (del A) · Hver udgang fra et hold skriver en ejerskifte-hændelse.
--
-- Målt 19/10 (prod, read-only): 0 af 1.385 rider_ownership_events har
-- to_team_id = NULL. Ingen vej, der fjerner en rytter fra et hold (frigivelse,
-- akademi-frigivelse, kontraktudløb, pension, graduering, beta-reset), logger
-- noget. Design: docs/superpowers/specs/2026-10-19-6504-frigivelse-ejerskifte-design.md.
--
-- Én AFTER-trigger på overgangen hold -> intet hold fanger alle veje, også
-- SQL-RPC'er og fremtidige stier. Den rører ikke hold -> hold eller fri -> hold
-- (dem logger auktion/handel/bytte/flush allerede), så der er ingen dobbelt-række.
--
-- Årsag: 'retirement' når rytteren er pensioneret i samme række, ellers 'release'.
-- En SQL-sti kan vælge 'admin' via set_config('cz.ownership_reason', 'admin', true);
-- ukendte værdier falder tilbage til standarden, så CHECK aldrig kan vælte en UPDATE.
-- Finere årsager (kontraktudløb, graduering) tilføjes først, når en revision skal bruge dem.
--
-- BEST-EFFORT som recordRiderOwnershipEvent (backend/lib/riderOwnershipAudit.js):
-- en fejl i loggen må aldrig rulle frigivelsen tilbage. Indsættelsen ligger i en
-- EXCEPTION-blok (subtransaktion) og bliver til en WARNING.
--
-- SECURITY DEFINER: en UPDATE fra en rolle uden INSERT-ret på loggen (RLS) skal
-- stadig logges. Funktionen returnerer trigger og kan ikke kaldes som RPC;
-- EXECUTE er alligevel trukket tilbage fra anon/authenticated.
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS + ADD (superset af den gamle liste),
-- CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE TRIGGER.
-- Applies af auto-migrate.yml ved merge (#2642); Claude post-verificerer.
--
-- Post-verify:
--   SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_record_rider_team_exit';
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'rider_ownership_events_reason_check';
--   -- efter første frigivelse i prod:
--   SELECT reason, count(*) FROM rider_ownership_events WHERE to_team_id IS NULL GROUP BY 1;

SET lock_timeout = '3s';

ALTER TABLE public.rider_ownership_events
  DROP CONSTRAINT IF EXISTS rider_ownership_events_reason_check;
ALTER TABLE public.rider_ownership_events
  ADD CONSTRAINT rider_ownership_events_reason_check CHECK (reason IN (
    'auction_win',
    'guaranteed_bank_sale',
    'trade',
    'swap',
    'release',
    'free_agent_signing',
    'academy_promotion',
    'season_transition',
    'admin',
    'stage_race_deferred_flush',
    'retirement'
  ));

CREATE OR REPLACE FUNCTION public.record_rider_team_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text := NULLIF(current_setting('cz.ownership_reason', true), '');
BEGIN
  IF v_reason IS NULL OR v_reason NOT IN ('release', 'retirement', 'admin') THEN
    v_reason := CASE WHEN NEW.is_retired IS TRUE THEN 'retirement' ELSE 'release' END;
  END IF;
  BEGIN
    INSERT INTO public.rider_ownership_events(
      rider_id, rider_firstname, rider_lastname, from_team_id, to_team_id, reason, actor_type)
    VALUES (NEW.id, NEW.firstname, NEW.lastname, OLD.team_id, NULL, v_reason, 'system');
  EXCEPTION WHEN OTHERS THEN
    -- best-effort: loggen ruller aldrig frigivelsen tilbage (#6504, samme princip som #3582).
    RAISE WARNING 'record_rider_team_exit: % (rider %)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_rider_team_exit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_record_rider_team_exit ON public.riders;
CREATE TRIGGER trg_record_rider_team_exit
  AFTER UPDATE OF team_id ON public.riders
  FOR EACH ROW
  WHEN (OLD.team_id IS NOT NULL AND NEW.team_id IS NULL)
  EXECUTE FUNCTION public.record_rider_team_exit();
