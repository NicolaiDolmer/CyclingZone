-- #5643 (epik #4592, spor A4) · Comeback efter Global Rank ved tilmelding.
--
-- teams.comeback_season_id: den sæson et parkeret hold kom tilbage i via
-- POST /api/season/comeback (backend/lib/comebackService.js). Sættes samtidig med at
-- parked_at nulstilles. NULL = holdet har ikke lavet et comeback.
--
-- Bruges til:
--   · genoptagelse: et gentaget kald i samme sæson kører sponsor og pulje-opfølgning
--     igen (idempotent) i stedet for at svare "ikke parkeret".
--   · spor A5 (senere PR): ingen bestyrelsesdom i comeback-sæsonen (ejer 24/9).
--
-- Additiv og idempotent: ADD COLUMN IF NOT EXISTS, ingen rækker ændres. ON DELETE SET
-- NULL, samme valg som de øvrige sæson-referencer på hold/kontrakter: en slettet sæson
-- må aldrig blokere eller slette et hold.
--
-- Applies af auto-migrate.yml ved merge (#2642); Claude post-verificerer.
--
-- Post-verify:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'comeback_season_id';

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS comeback_season_id uuid NULL REFERENCES public.seasons(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.teams.comeback_season_id IS
  'Sæsonen holdet kom tilbage i efter parkering (#5643, POST /api/season/comeback). NULL = intet comeback.';
