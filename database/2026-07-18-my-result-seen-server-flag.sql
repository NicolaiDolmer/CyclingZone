-- #2593 (del 2) — "Nyt"-badget på dashboard-kortet "Sådan gik det for dit
-- hold" (MyLatestResultCard, #2466/PR #2497) brugte localStorage til at huske
-- hvilket løb manageren senest har set. Det nulstiller sig selv pr.
-- enhed/browser — 54,9% af besøg er mobil, så mange skifter enhed og ser
-- badgen "Nyt" igen for et løb de allerede har set på en anden enhed.
--
-- FIX: persistér seen-status SERVER-SIDE, samme mønster som
-- teams.onboarding_progress_dismissed_at (2026-07-16-onboarding-progress-
-- dismiss-persist.sql) og riders.peak_suggestions_dismissed_season_id
-- (2026-07-16-peak-suggestion-dismiss.sql): én uuid-FK-kolonne på teams,
-- sat af POST /api/dashboard/my-latest-result/seen, læst af
-- GET /api/dashboard/my-latest-result (inkluderet i det eksisterende
-- kort-payload som race.seen — ingen ekstra roundtrip for at LÆSE status).
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER MANUELT POST-MERGE (ejer-politik,
-- jf. feedback_migrations_never_auto_apply_via_mcp). Ingen apply_migration/
-- execute_sql er kørt af agenten. Idempotent (ADD COLUMN IF NOT EXISTS).
--
-- Backend-only tilstand, samme graceful-degradation-mønster som de to
-- ovenstående: mangler kolonnen (42703), opfører GET/POST sig som om intet
-- nogensinde er set (race.seen altid false; POST er en stille no-op ud over
-- 42703-tolerancen) — ingen 500 for spillere før ejer har anvendt migrationen.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS my_result_seen_race_id uuid
    REFERENCES public.races(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.teams.my_result_seen_race_id IS
  '#2593: race-id for det seneste løb manageren har set på dashboardets "Sådan gik det for dit hold"-kort (NULL = intet set endnu). Sat af POST /api/dashboard/my-latest-result/seen, læst af GET /api/dashboard/my-latest-result (race.seen). Server-persisteret så "Nyt"-badgen holder på tværs af enheder/sessioner (erstatter det device-scopede localStorage-flag "cz-dashboard-my-result-seen" fra #2466). Graceful degradation i backend/routes/api.js hvis kolonnen mangler.';
