-- #2153 Fase 1: division-routed resultat-webhooks.
--
-- discord_settings kan nu pege på:
--   • en specifik gruppe   → league_division_id sat (is_summary=false)
--   • en tier-samlekanal   → tier sat + is_summary=true
--   • global/auktion (hidtil) → alle tre NULL/false, styret af webhook_type/is_default
--
-- Ved en resultat-post slår backend race.league_division_id op og sender til
-- BÅDE gruppe-rækken (league_division_id-match) og tier-samlekanalen
-- (tier-match + is_summary). Se backend/lib/discordNotifier.js#getResultWebhooks.
--
-- Soft-reference til league_divisions(id): bevidst INGEN foreign key, så
-- division-rebuild-scripts (reset-*-divisions) ikke cascade-sletter webhook-
-- config. Idempotent (IF NOT EXISTS) så replay i branches/staging er safe.
-- RLS uændret: admin-only policy fra #517-lockdown; service_role bypasser.

ALTER TABLE discord_settings
  ADD COLUMN IF NOT EXISTS league_division_id integer,
  ADD COLUMN IF NOT EXISTS tier               integer,
  ADD COLUMN IF NOT EXISTS is_summary         boolean NOT NULL DEFAULT false;

-- Højst én webhook pr. gruppe.
CREATE UNIQUE INDEX IF NOT EXISTS discord_settings_league_division_idx
  ON discord_settings (league_division_id)
  WHERE league_division_id IS NOT NULL;

-- Højst én samlekanal pr. tier.
CREATE UNIQUE INDEX IF NOT EXISTS discord_settings_tier_summary_idx
  ON discord_settings (tier)
  WHERE is_summary = true;
