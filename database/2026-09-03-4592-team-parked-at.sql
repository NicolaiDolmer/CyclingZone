-- [epic #4592 del 2] Parkering af inaktive hold ved sæsonskifte (forberedelse,
-- bag flag season_signup_enabled — se seasonSignupFlag.js).
--
-- teams.parked_at: sættes af managerParking.parkTeam() når et hold parkeres
-- uden for divisionerne ved cutover. Holdet er URØRT ud over dette felt +
-- league_division_id (sættes til NULL, samme "frigiv pladsen"-mekanik som
-- #4183's occupancy-tælling allerede respekterer) — ingen ryttere, ingen
-- balance, ingen andet nulstilles eller slettes.
--
-- IKKE en sletnings-markør (til forskel fra AI-holdenes pending_removal_at,
-- #2187) — et parkeret menneskehold forbliver i databasen for evigt indtil
-- manageren selv melder sig tilbage via "Tilmeld dig næste sæson"-knappen.
--
-- Idempotent. Applies af Claude POST-merge under #2642-rammerne. Denne PR
-- flipper IKKE flaget og kører IKKE parkeringen mod prod — kun forberedelse.
--
-- Post-verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'teams' AND column_name = 'parked_at';

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS parked_at timestamptz;
