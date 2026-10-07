-- Refs #6061/#6129. Kompensationsledgeren blev lagt i prod 5/10 kl. 08:42 fra
-- database/proposals/2026-10-03-6061-apply-compensation.sql (MCP-migration
-- 6061_apply_training_compensation). Denne fil goer tabel + trigger sporbare i
-- database/ (feature-liveness Detector D). Idempotent; writer-funktionen ejes af
-- 2026-10-05-6129-compensation-slim-source.sql.
CREATE TABLE IF NOT EXISTS public.training_compensation_receipts (
 rider_id uuid NOT NULL, season_id uuid NOT NULL, game_day integer NOT NULL,
 tick_date date NOT NULL, team_id uuid NOT NULL, plan_hash text NOT NULL,
 payload jsonb NOT NULL, applied_at timestamptz NOT NULL,
 PRIMARY KEY(rider_id,season_id,game_day)
);
ALTER TABLE public.training_compensation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_compensation_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.training_compensation_receipts TO service_role;
CREATE OR REPLACE FUNCTION public.reject_compensated_training_tick() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.training_compensation_receipts c WHERE c.rider_id=NEW.rider_id AND c.season_id=NEW.season_id AND c.game_day=NEW.game_day) THEN
  RAISE EXCEPTION 'Training slot already compensated; historical retry requires reconciliation';
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.reject_compensated_training_tick() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reject_compensated_training_tick() TO service_role;
DROP TRIGGER IF EXISTS reject_compensated_training_tick ON public.training_rider_ticks;
CREATE TRIGGER reject_compensated_training_tick BEFORE INSERT ON public.training_rider_ticks FOR EACH ROW EXECUTE FUNCTION public.reject_compensated_training_tick();
