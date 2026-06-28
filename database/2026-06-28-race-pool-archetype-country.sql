-- ============================================================
-- race_pool: terræn-arketype + land (realisme-anker)
-- ============================================================
-- terrain_archetype driver stage-profil-generatoren (jf.
-- backend/lib/raceStageProfileGenerator.js ARCHETYPE_PROFILES). country er
-- display-metadata. Begge nullable + additive (IF NOT EXISTS). NULL archetype →
-- generatoren falder tilbage til generiske vægte (bagudkompatibelt).
--
-- Spec: docs/superpowers/specs/2026-06-28-realistic-race-parcours-archetype-design.md
-- Værdierne forfattes i database/seed/race_pool_archetypes.json og anvendes via
-- backend/scripts/applyRacePoolArchetypes.js (idempotent).
--
-- EJEREN MERGER (migration auto-applies i prod, jf. AGENTS.md). Additiv — rører
-- ingen eksisterende race_pool-rækker.

ALTER TABLE public.race_pool
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS terrain_archetype text;

-- pgrst_ddl_watch reloader normalt ved DDL; eksplicit NOTIFY koster intet.
NOTIFY pgrst, 'reload schema';
