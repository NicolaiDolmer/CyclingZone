BEGIN;
SET LOCAL lock_timeout = '3s';

-- The receiving season may not exist when the season-end parking sweep runs.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS comeback_board_season_number integer;

CREATE OR REPLACE FUNCTION public.reset_board_penalties_on_comeback_8100()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  neutral_confidence constant integer := 50;
BEGIN
  -- Judgment precedes parking in the season-end sweep, but the sweep uses
  -- the timestamp captured before judgment. Active penalties are frozen
  -- during parking, so the reset must not use parked_at as a cutoff.
  UPDATE public.transfer_listings AS listing
  SET status = 'withdrawn'
  FROM public.board_consequences AS consequence
  WHERE consequence.team_id = NEW.id
    AND consequence.layer = 4
    AND consequence.status = 'active'
    AND listing.id::text = consequence.payload->>'listing_id'
    AND listing.seller_team_id = NEW.id
    AND listing.status IN ('open', 'negotiating', 'paused');

  UPDATE public.board_consequences
  SET status = 'expired', resolved_at = transaction_timestamp()
  WHERE team_id = NEW.id
    AND status = 'active' AND layer BETWEEN 2 AND 5;

  UPDATE public.board_profiles
  SET satisfaction = DEFAULT,
      budget_modifier = CASE WHEN budget_modifier < 1 THEN 1 ELSE budget_modifier END
  WHERE team_id = NEW.id;

  -- Keep the recorded season and receipt metadata. A missing or older
  -- season anchor will be recreated from neutral confidence by the evaluator.
  UPDATE public.board_relations
  SET confidence = neutral_confidence,
      confidence_source = jsonb_set(
        CASE WHEN jsonb_typeof(confidence_source) = 'object' THEN confidence_source ELSE '{}'::jsonb END,
        '{season_anchor}',
        (CASE WHEN jsonb_typeof(confidence_source->'season_anchor') = 'object'
          THEN confidence_source->'season_anchor' ELSE '{}'::jsonb END)
          || jsonb_build_object('confidence', neutral_confidence)
      )
  WHERE team_id = NEW.id;

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
