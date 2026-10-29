-- #5319 · Træningskatalog v3 (S12) bag et stadie-flag (off | beta | on).
--
-- Spec: docs/superpowers/specs/2026-10-29-training-catalog-v3-design.md §5.
-- Fem nye hårde sessioner (Lange stigninger, Lead-out, Korte og Lange
-- enkeltstarter, Brostensklassiker), Tærskel træner ikke længere enkeltstart,
-- Spurt giver en fuld hård dag. Startstadiet er `off`: intet ændrer sig før
-- ejeren flytter flaget fra admin-fladen. off = dagens katalog, bit-identisk.
--
-- Additiv: kun en app_config-række. `training_plans.focus` og
-- `training_week_plans.days` er tekst/jsonb, så ingen tabel ændres. Gemte
-- threshold-planer for enkeltstarts- og klassementsryttere flyttes af
-- scripts/5319-migrate-threshold-plans.mjs (dry-run default) ved tænding,
-- som et separat ejer-go.
-- Evalueres af backend/lib/trainingCatalogV3.js (motoren pr. hold, API'et pr.
-- viewer) og af GET /api/feature-flags (sessionsvælgerne og Hjælp). Står i
-- STAGE_FLAGS + PLAYER_VISIBLE_FLAG_KEYS (backend/lib/stageFlagCatalog.js).
--
-- Idempotent (ON CONFLICT DO NOTHING): overskriver aldrig et stadie ejeren
-- allerede har flyttet. Apply sker post-merge (auto-migrate.yml, #2642).
--
-- Post-verify (read-only):
--   SELECT key, value FROM public.app_config WHERE key = 'training_catalog_v3';

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_catalog_v3',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for training catalog v3 (#5319): five new hard sessions (long climbs, lead-out, short and long time trials, cobbled classic), threshold without time trial, sprint as a full hard day. beta = beta testers only (engine: team owner).'
)
ON CONFLICT (key) DO NOTHING;
