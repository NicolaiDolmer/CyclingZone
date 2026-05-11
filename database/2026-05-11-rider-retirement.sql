-- Rider retirement flag.
-- Retired riders stay in the database for future history pages, but are hidden
-- from normal rider searches and blocked from new market actions.

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS is_retired BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_riders_is_retired
  ON riders (is_retired)
  WHERE is_retired = TRUE;
