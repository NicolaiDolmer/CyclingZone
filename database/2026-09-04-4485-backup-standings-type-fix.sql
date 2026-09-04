-- #4485: backup-tabellen for season_standings havde league_division_id som uuid,
-- men prod's season_standings.league_division_id er integer (og penalty_points er bigint).
-- Apply-koerslen 4/9 kl. ~14:00 stoppede i trin 0 (backup) med
-- "invalid input syntax for type uuid: \"1\"" FOER nogen skrivning til live-tabeller.
-- Rettet direkte i prod 4/9 (tabellen var tom); denne fil holder repo og prod i sync.
-- Idempotent: ALTER TYPE til samme type er en no-op.

ALTER TABLE IF EXISTS public.backup_4485_season_standings_20260904
  ALTER COLUMN league_division_id TYPE integer USING NULL,
  ALTER COLUMN penalty_points TYPE bigint;

-- POST-VERIFY:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'backup_4485_season_standings_20260904'
--     AND column_name IN ('league_division_id', 'penalty_points');
--   -> integer, bigint
