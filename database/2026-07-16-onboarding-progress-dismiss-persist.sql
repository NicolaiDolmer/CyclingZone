-- #2439 — "Kom i gang"-onboarding-modulet re-triggerede for etablerede spillere.
--
-- ROD-ÅRSAG: dismiss af OnboardingProgressCard blev bevidst gemt i
-- sessionStorage (#1569 — for ikke at dræbe kortet permanent ved et fejlklik
-- på 0/4 trin). Men de 4 trin (first_bid_placed/first_training_run/
-- first_squad_selected/board_plan_set, se GET /me/onboarding-progress i
-- backend/routes/api.js) er handlinger en etableret manager kan gå HELE
-- sæsoner uden at ramme (fx altid brug af squad-auto-fill, aldrig en manuel
-- board-forhandling) — completed_count når derfor aldrig total_count, og
-- sessionStorage-dismisset nulstiller sig selv ved hver ny fane/browser-
-- genstart/enhed. Resultatet: kortet "spammer" på tværs af sessions for
-- spillere der reelt er langt forbi onboarding.
--
-- FIX: persistér dismiss SERVER-SIDE (denne kolonne) så ét afvist-klik er
-- permanent på tværs af enheder/sessions. created_at bruges desuden til en
-- auto-complete-heuristik i backend (etablerede hold >14 dage gamle skal
-- aldrig se kortet, uanset step-status — matcher #2458s 14→2-dages-mønster).
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER MANUELT POST-MERGE (ejer-politik,
-- jf. feedback_migrations_never_auto_apply_via_mcp). Ingen apply_migration/
-- execute_sql er kørt af agenten. Idempotent (ADD COLUMN IF NOT EXISTS).
--
-- Backend-only tilstand, samme grace-degradation-mønster som
-- riders.peak_suggestions_dismissed_season_id (2026-07-16-peak-suggestion-
-- dismiss.sql): mangler kolonnen (42703) opfører GET/POST /me/onboarding-
-- progress sig som om intet er dismisset (ingen 500).
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS onboarding_progress_dismissed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.teams.onboarding_progress_dismissed_at IS
  '#2439: tidspunkt hvor manageren aktivt afviste "Kom i gang"-progress-kortet på Dashboard (NULL = ikke afvist). Sat af POST /api/me/onboarding-progress/dismiss, læst af GET /api/me/onboarding-progress. Server-persisteret så dismiss holder på tværs af enheder/sessions (erstatter det session-scopede sessionStorage-dismiss fra #1569). Graceful degradation i backend/routes/api.js hvis kolonnen mangler.';
