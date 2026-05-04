-- ============================================================
-- 2026-05-04 — Commit activity_feed schema (drift fix)
-- ============================================================
-- Tabellen har levet som runtime-only siden v2.x og har aldrig
-- været committed til schema.sql. Indsats- og læse-paths er aktive
-- i backend/routes/api.js (logActivity) og backend/cron.js
-- (logActivity), samt frontend Indbakke "Ligaen"-tab.
--
-- Denne migration er idempotent (CREATE TABLE IF NOT EXISTS) og
-- matcher præcist hvad runtime allerede har — den genskaber
-- INTET hvis tabellen findes.
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_feed (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  team_name TEXT,
  rider_id UUID REFERENCES riders(id) ON DELETE SET NULL,
  rider_name TEXT,
  amount INTEGER,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_feed_created
  ON activity_feed(created_at DESC);

ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.activity_feed'::regclass
      AND polname = 'Public read activity_feed'
  ) THEN
    CREATE POLICY "Public read activity_feed"
      ON activity_feed FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.activity_feed'::regclass
      AND polname = 'Service insert activity_feed'
  ) THEN
    CREATE POLICY "Service insert activity_feed"
      ON activity_feed FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;
