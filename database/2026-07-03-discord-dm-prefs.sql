-- Per-type Discord DM preferences (jsonb).
-- Stores only opt-OUTs, e.g. { "board_update": false }. An absent key means the
-- DM type is enabled (default-on), so this column changes nothing until a player
-- mutes a type. The master switch stays users.discord_dm_enabled (2026-05-03).
--
-- Additive + idempotent. Enforced in backend/lib/discordDmPrefs.js (gate) +
-- discordDmRecipient.js (fetch). Pref keys: auction_outbid, auction_won,
-- watchlist_rider_auction, transfer_offer, transfer_response, board_update.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS discord_dm_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
