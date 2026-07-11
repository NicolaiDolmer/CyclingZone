-- 2026-07-11 · Race v3 salt: provably-fair seed-salt på race-motoren.
-- Plan: docs/superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md §10.
--
-- Ejer-direktiv (11/7): resultat-seeds skal blandes med en server-side hemmelighed
-- (RACE_ENGINE_SEED_SALT), så udfald ikke er pre-computable fra offentlige data
-- (race.id + etapenummer). Selve salten bor UDELUKKENDE i Railway/Infisical-env —
-- ALDRIG i denne database, ALDRIG i klienten. Denne migration tilføjer kun en
-- audit-kolonne der stempler HVILKEN salt-version en run blev genereret under.
--
-- BEHAVIOUR-NEUTRAL: kolonnen er nullable og ikke-læst af nogen eksisterende kode
-- før raceRunner.js#persistRuns (samme PR, #2351) begynder at skrive den. NULL =
-- usaltet legacy-run (alle eksisterende rækker + alle nye runs indtil ejeren
-- sætter RACE_ENGINE_SEED_SALT i prod-env).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Refs #2351.

ALTER TABLE public.race_simulation_runs
  ADD COLUMN IF NOT EXISTS salt_version integer;

COMMENT ON COLUMN public.race_simulation_runs.salt_version IS
  'Provably-fair seed-salt-version (#2351) — hvilken RACE_ENGINE_SEED_SALT_VERSION runnen blev seedet under. NULL = usaltet legacy-run. Selve salten bor i Infisical/Railway-env (RACE_ENGINE_SEED_SALT), aldrig i DB. Refs #2351.';
