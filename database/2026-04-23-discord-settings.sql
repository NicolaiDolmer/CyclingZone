-- Discord webhook configuration and per-user Discord ID mapping

CREATE TABLE IF NOT EXISTS discord_settings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_url  text NOT NULL,
  webhook_name text,
  webhook_type text NOT NULL DEFAULT 'general',
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Only one default webhook at a time
CREATE UNIQUE INDEX IF NOT EXISTS discord_settings_default_idx
  ON discord_settings (is_default)
  WHERE is_default = true;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS discord_id text;
