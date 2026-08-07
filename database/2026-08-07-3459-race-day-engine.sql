-- Løbsdags-motoren (#3459 fase 2a) — kill-switch for D1+D3+D4.
-- Spec: docs/superpowers/specs/2026-08-06-loebsdags-model-design.md
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER/ORKESTRATOR MANUELT POST-MERGE
-- (jf. feedback_migrations_never_auto_apply_via_mcp). Ingen apply_migration/psql
-- er kørt af agenten. Idempotent (INSERT ... ON CONFLICT (key) DO NOTHING).
--
-- Tre-tilstands-skema (off|beta|on), samme mønster som race_engine_v3_scoring
-- (2026-07-12-race-v3-s1-work-cost.sql) / daily_training_enabled. Ejer-politik:
-- kill-switch, ingen reel beta-gate i praksis.
--
-- Flag OFF (default, seedet her) = BIT-FOR-BIT nuværende adfærd:
--   D1 — dailyTrainingEngine.js kender ikke løbskalenderen, ingen løbsdags-gate.
--   D3 — riderCondition.js's recovery-konstanter er uændrede (recoveryBase 4,
--        recoveryFraction 0.13); raceFatigue.js's GT-hviledags-restitution følger
--        samme uændrede konstanter.
--   D4 — trainingSweep.js filtrerer stadig is_ai=false; aiRecoverySweep.js
--        (#3015-særtilfældet) kører videre uændret.
--
-- Flag ON (planlagt flip: sæsonskiftet 23/8, sammen med markedsmodel-100% +
-- løn-genberegning — ét nulpunkt, jf. ejer-beslutning 6/8):
--   D1 — racede ryttere springer dagens træningspas over (intet trænings-load,
--        ingen ability-progress, normal recovery).
--   D3 — recoveryBase 4→4.5 + recoveryFraction 0.13→0.15 (empirisk valgt pakke,
--        se PR #3459 fase 2a-body for sim-scorecard).
--   D4 — AI-hold kører gennem samme dailyTrainingEngine som menneskehold;
--        aiRecoverySweep.js no-op'er (filen slettes IKKE i denne PR).
--
-- Eksempler på flip (kør manuelt post-merge, ejer/orkestrator):
--   UPDATE public.app_config SET value = '"on"'::jsonb  WHERE key = 'race_day_engine_enabled';   -- fuld aktivering
--   UPDATE public.app_config SET value = '"beta"'::jsonb WHERE key = 'race_day_engine_enabled';   -- kun beta-testere
--   UPDATE public.app_config SET value = '"off"'::jsonb  WHERE key = 'race_day_engine_enabled';   -- tilbage til nuværende adfærd

INSERT INTO public.app_config (key, value, description) VALUES
  ('race_day_engine_enabled', '"off"'::jsonb,
   'Løbsdags-motoren (#3459 fase 2a): D1 (løbsdage erstatter dagens træningspas, intet dobbelt-load) + D3 (recoveryBase 4→4.5, recoveryFraction 0.13→0.15) + D4 (AI-hold kører samme dailyTrainingEngine, aiRecoverySweep no-op''er). off|beta|on. off (default) = motoren opfører sig bit-identisk med i dag. Planlagt flip: sæsonskiftet 23/8 sammen med markedsmodel-100% + løn-genberegning.')
ON CONFLICT (key) DO NOTHING;
