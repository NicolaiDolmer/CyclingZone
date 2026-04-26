-- Online status kolonner på users-tabellen
-- Bruges af: /api/presence (heartbeat), /api/login-streak, /api/online-count, /api/managers/:teamId

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_date TEXT;
