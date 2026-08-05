-- database/2026-08-04-pool-reseed-flag.sql
-- #2557 (spor B): app_config-nøgler for STYRKE-BALANCERET PULJE-RESEED ved
-- sæsonovergangen. Logikken bor i backend/lib/economyEngine.js
-- (reseedTierPools) + backend/lib/poolBalance.js (planRealTeamReseed), og
-- gaten i backend/lib/poolReseedFlag.js.
--
-- DENNE MIGRATION ER INERT. Værdien er 'off', og koden er allerede fail-safe
-- (manglende nøgle ⇒ slukket), så den ændrer INTET i spillet. Den findes for at
-- gøre kontakten synlig i app_config med en beskrivelse, i stedet for at kræve
-- en håndskrevet INSERT den dag ejeren vil teste den.
--
-- Slå TIL (kræver ejer-go + sim-harness-kørsel, simulér-før-ship):
--   UPDATE public.app_config SET value = '"on"'::jsonb  WHERE key = 'season_end_pool_reseed';
-- Slå FRA igen:
--   UPDATE public.app_config SET value = '"off"'::jsonb WHERE key = 'season_end_pool_reseed';
-- Kalibrér tærsklen (uden deploy):
--   UPDATE public.app_config SET value = '8'::jsonb     WHERE key = 'season_end_pool_reseed_threshold';
--
-- Idempotent (ON CONFLICT DO NOTHING) — sikker at køre flere gange, og
-- overskriver ALDRIG en værdi ejeren allerede har sat.

INSERT INTO public.app_config (key, value, description)
VALUES
  ('season_end_pool_reseed', '"off"'::jsonb,
   'Styrke-balanceret pulje-reseed ved sæson-slut (#2557 spor B). ''on'' = economyEngine.reseedTierPools kører EFTER op/nedrykningen og FØR AI-fyld-sweepen: hver tier hvis dominans-margin overstiger season_end_pool_reseed_threshold får sine ÆGTE hold snake-fordelt på styrke over tierens puljer (AI-hold flyttes ikke, de regenereres af reconcileAiTeamsForPool). Kun league_division_id skrives, aldrig division. En plan der ikke sænker skævheds-indekset droppes automatisk. ''off'' (default) = motorens nuværende, styrke-blinde adfærd, ingen læsninger og ingen skrivninger.'),
  ('season_end_pool_reseed_threshold', '10'::jsonb,
   'Tærskel for pulje-reseed (#2557 spor B): en tier re-seedes kun hvis dens skævheds-indeks (det mest stakkede holds 4.-bedste rytter minus puljens 10.-bedste rival-rytter) er STØRRE end denne værdi. 10 er sat mellem de målte regimer 3/8 (margin <= 7 gav share4PlusSameTeamTop10 0,000; margin >= 11 gav 0,357-0,571) og er IKKE harness-verificeret. Ugyldig eller manglende værdi falder tilbage til 10 i koden. Læses kun når season_end_pool_reseed er ''on''.')
ON CONFLICT (key) DO NOTHING;
