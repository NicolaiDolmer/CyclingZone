-- #6184 · Oprydning/rollback for database/2026-10-05-6184-race-results-latest-indexes.sql
--
-- KØRES IKKE AUTOMATISK. Køres manuelt med psql UDEN for en transaktion
-- (DROP INDEX CONCURRENTLY kan ikke køre i BEGIN/COMMIT).
--
-- Brug 1 (afbrudt byg): migrationen fejler med "INVALID indeks fra et afbrudt
-- byg". Kør de DROP-linjer der matcher det navngivne indeks, og genkør derefter
-- migrationen (fjern dens række fra schema_migrations, hvis den nåede at blive
-- registreret, eller retrig auto-migrate).
--
-- Brug 2 (rollback): indeksene er rent additive. Rollback = drop begge.
-- Koden i stallWatchdog.js og useHeroAgonyMoment.js virker stadig uden dem,
-- bare med de gamle langsomme planer.
--
-- CONCURRENTLY tager ikke ACCESS EXCLUSIVE på race_results, så læsere og
-- skrivere blokeres ikke.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_race_results_team_stage_latest;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_race_results_race_id_imported_at;
