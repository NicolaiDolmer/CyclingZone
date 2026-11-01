-- #7246 point 3: preserve the contract on the existing team-exit audit event.
-- OLD is the row before contractExpiryRelease.js clears the contract fields.
-- Capture all team exits without inferring a more specific release reason.
-- No historical backfill: contracts already cleared cannot be reconstructed.
-- Prepared only; Claude applies after merge and verifies the column/function.
SET lock_timeout = '3s';

ALTER TABLE public.rider_ownership_events
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

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
      rider_id, rider_firstname, rider_lastname, from_team_id, to_team_id, reason, actor_type, meta)
    VALUES (NEW.id, NEW.firstname, NEW.lastname, OLD.team_id, NULL, v_reason, 'system',
      jsonb_build_object('contract_end_season', OLD.contract_end_season,
                         'contract_length', OLD.contract_length));
  EXCEPTION WHEN OTHERS THEN
    -- Preserve #6504's best-effort policy: audit failures cannot roll back release.
    RAISE WARNING 'record_rider_team_exit: % (rider %)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_rider_team_exit() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Post-verify (Claude, after merge/apply):
-- SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'rider_ownership_events' AND column_name = 'meta';
-- SELECT pg_get_functiondef('public.record_rider_team_exit()'::regprocedure);
-- After a real release, inspect meta on its existing event (do not create a test release in prod).
