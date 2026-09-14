-- #5130 (ejer-direktiv 10/9): idempotens-kolonne for Discord-velkomstbeskeden.
--
-- teams.discord_welcome_sent_at: NULL indtil discordWelcomeSweep.js har
-- sendt (claimet) beskeden for holdet. Sweepen claimer kolonnen FØR selve
-- notify()-kaldet (UPDATE ... WHERE discord_welcome_sent_at IS NULL, med
-- .select() for at opdage et tabt raceløb mellem to sweep-tick) — dedupe pr.
-- team_id, præcis én besked nogensinde pr. hold.
--
-- Additiv, nullable, idempotent. Applies post-merge under #2642-rammerne
-- (ikke-destruktiv → ikke ejer-gated).
--
-- Post-verify:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'teams' AND column_name = 'discord_welcome_sent_at';
--   SELECT count(*) FROM public.teams WHERE discord_welcome_sent_at IS NOT NULL;  -- forventet 0 lige efter apply

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS discord_welcome_sent_at timestamptz;

-- Sweepens kandidat-forespørgsel filtrerer på "IS NULL" over hele teams-tabellen
-- (høj selektivitet, faldende andel over tid) — partielt indeks holder det minimalt.
CREATE INDEX IF NOT EXISTS idx_teams_discord_welcome_pending
  ON public.teams (id)
  WHERE discord_welcome_sent_at IS NULL;
