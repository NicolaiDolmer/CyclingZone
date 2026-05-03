-- S8: Discord DM opt-out flag
-- Default true: managers der allerede har discord_id sat, modtager DM med det samme
-- når Railway env DISCORD_BOT_TOKEN er konfigureret. Opt-out via ProfilePage.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS discord_dm_enabled BOOLEAN NOT NULL DEFAULT true;
