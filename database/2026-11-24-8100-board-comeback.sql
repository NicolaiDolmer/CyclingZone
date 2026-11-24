SET lock_timeout = '3s';
BEGIN;

-- The receiving season may not exist when the season-end parking sweep runs.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS comeback_board_season_number integer;

CREATE OR REPLACE FUNCTION public.reset_board_penalties_on_comeback_8100()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- A forced listing must stop accepting offers when its punishment expires.
  UPDATE public.transfer_listings AS listing
  SET status = 'withdrawn'
  FROM public.board_consequences AS consequence
  WHERE consequence.team_id = NEW.id
    AND consequence.layer = 4
    AND consequence.status = 'active'
    AND consequence.created_at <= OLD.parked_at
    AND listing.id::text = consequence.payload->>'listing_id'
    AND listing.seller_team_id = NEW.id
    AND listing.status IN ('open', 'negotiating');

  UPDATE public.board_consequences
  SET status = 'expired', resolved_at = transaction_timestamp()
  WHERE team_id = NEW.id
    AND status = 'active' AND layer BETWEEN 2 AND 5
    AND created_at <= OLD.parked_at;

  UPDATE public.board_profiles
  SET budget_modifier = 1
  WHERE team_id = NEW.id AND budget_modifier < 1;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_board_penalties_on_comeback_8100() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reset_board_penalties_on_comeback_8100 ON public.teams;
CREATE TRIGGER reset_board_penalties_on_comeback_8100
AFTER UPDATE OF parked_at ON public.teams
FOR EACH ROW
WHEN (OLD.parked_at IS NOT NULL AND NEW.parked_at IS NULL)
EXECUTE FUNCTION public.reset_board_penalties_on_comeback_8100();

COMMIT;
