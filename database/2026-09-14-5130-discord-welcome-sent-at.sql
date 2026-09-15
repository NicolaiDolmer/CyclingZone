-- #5130 (ejer-direktiv 10/9): idempotens-kolonne for Discord-velkomstbeskeden.
--
-- teams.discord_welcome_sent_at: NULL indtil discordWelcomeSweep.js har
-- sendt (claimet) beskeden for holdet. Sweepen claimer kolonnen FØR selve
-- notify()-kaldet (UPDATE ... WHERE discord_welcome_sent_at IS NULL, med
-- .select() for at opdage et tabt raceløb mellem to sweep-tick — og ruller
-- claimet tilbage til NULL igen hvis notify() fejler, så et midlertidigt
-- Supabase-udfald ikke taber holdet permanent) — dedupe pr. team_id, præcis
-- én besked nogensinde pr. hold.
--
-- CodeRabbit-fund (denne PR): en NULL-default ville lade EKSISTERENDE hold
-- (måneder gamle) se ud som kandidater — sweepens 24t-fallback ville sende
-- "ny spiller"-velkomstbeskeden til HELE spillerbasen ved første kørsel.
-- Kolonnen bakfyldes derfor til now() for alle eksisterende rækker FØR
-- defaulten fjernes igen, så kun hold oprettet EFTER denne migration er
-- reelle kandidater.
--
-- Additiv, nullable, idempotent (backfill rammer kun rækker der stadig er
-- NULL — en genkørsel er et no-op). Applies post-merge under #2642-rammerne
-- (ikke-destruktiv → ikke ejer-gated).
--
-- Post-verify:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'teams' AND column_name = 'discord_welcome_sent_at';
--   SELECT count(*) FROM public.teams WHERE discord_welcome_sent_at IS NULL;  -- forventet 0 lige efter apply (alt bakfyldt)

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS discord_welcome_sent_at timestamptz;

-- Bakfyld FØR defaulten sættes/fjernes — kun rækker der stadig er NULL
-- (idempotent: en genkørsel rører ingen rækker anden gang).
UPDATE public.teams
  SET discord_welcome_sent_at = now()
  WHERE discord_welcome_sent_at IS NULL;

-- Sweepens kandidat-forespørgsel filtrerer på "IS NULL" over hele teams-tabellen
-- (høj selektivitet, faldende andel over tid) — partielt indeks holder det minimalt.
CREATE INDEX IF NOT EXISTS idx_teams_discord_welcome_pending
  ON public.teams (id)
  WHERE discord_welcome_sent_at IS NULL;
