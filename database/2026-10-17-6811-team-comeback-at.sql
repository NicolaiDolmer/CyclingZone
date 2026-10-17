-- #6811 (opfølgning på #6704/#6536) · Varig parkeringsperiode for træning.
--
-- teams.comeback_at: tidspunktet holdet sidst forlod parkering via et comeback
-- (POST /api/season/comeback, backend/lib/comebackService.js returnParkedTeam).
-- Sættes i samme UPDATE som parked_at nulstilles og comeback_season_id sættes.
-- NULL = holdet har ikke lavet et comeback (eller kom tilbage før kolonnen fandtes).
--
-- Hvorfor: trainingDateReadiness.isTrainingDateTeam udelukker et parkeret hold
-- via parked_at. Når holdet vender tilbage, er parked_at væk, og efter en
-- genstart gennemgår loadTrainingDateIndex alle sæsonens datoer igen. Datoerne
-- fra parkeringen har ingen training_date_work, så holdet kunne få dem alle på én
-- gang. Med comeback_at regnes en dato, der sluttede før comebacket, ikke med
-- for holdet (samme regel som created_at for et nyt hold).
--
-- Additiv og idempotent: ADD COLUMN IF NOT EXISTS, ingen rækker ændres (ingen
-- backfill: tidspunktet for et tidligere comeback kendes ikke sikkert).
--
-- Applies af auto-migrate.yml ved merge (#2642); Claude post-verificerer.
-- Koden tåler kolonnens fravær i deploy-vinduet (42703/PGRST204-fallback).
--
-- Post-verify:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'comeback_at';

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS comeback_at timestamptz NULL;

COMMENT ON COLUMN public.teams.comeback_at IS
  'Seneste tidspunkt holdet forlod parkering via comeback (#6811). Træningsdatoer der sluttede før, regnes ikke med. NULL = intet comeback.';

-- Verify: kolonnen findes med den forventede type.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teams'
      AND column_name = 'comeback_at' AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION '#6811: teams.comeback_at mangler eller har forkert type';
  END IF;
END
$$;
