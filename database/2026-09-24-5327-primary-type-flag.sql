-- #5327 — kontakten for rytter-generatorens PRIMAERE type-kilde.
--
-- on  = nye ryttere traekker primaer type tier-uafhaengigt fra
--       DEFAULT_DISTRIBUTION (archetypeDistribution.js).
-- off = dagens adfaerd (tier-aware TIER_TYPE_WEIGHTS).
--
-- Startstadiet er `off`: ingen spiller ser en aendring naar migrationen er
-- applied. Kontakten flyttes foerst efter ejer-go, naar preview af
-- populationen, vaerdi-baand-gaten, race:gate og AI-truppens loft er koert i
-- distribution-mode.
--
-- Evalueres af backend/lib/primaryTypeModeFlag.js via evaluateFlagStage
-- (off | beta | on, featureStage.js). `beta` taender IKKE kontakten: en genereret
-- rytter er synlig for alle, saa der er ingen beta-gruppe at begraense til.
-- Laeses ved de tre kaldesteder der skaber ryttere (starterSquadAllocator.js,
-- aiTeamGenerator.js, relaunchOrchestrator.js). Flytter kun NYE ryttere,
-- eksisterende ryttere roeres ikke.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et stadie
-- ejeren allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'rider_primary_type_from_distribution',
  '"off"'::jsonb,
  'Stage flag (off|on) for the rider generator primary type source (#5327): on = new riders draw their primary type from DEFAULT_DISTRIBUTION instead of the tier weights. Affects new riders only (starter squads, new AI teams, relaunch population). beta has no effect. Owner-gated flip.'
)
ON CONFLICT (key) DO NOTHING;
