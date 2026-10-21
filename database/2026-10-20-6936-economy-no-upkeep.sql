-- database/2026-10-20-6936-economy-no-upkeep.sql
-- #6936: fjern upkeep (rejse og personale + fladt sæsonstart-upkeep),
-- akademi-drift og facilitets-upkeep fra og med sæsonskiftet til sæson 5
-- (ejer-beslutning 20/10, ingen kompensation).
--
-- Én additiv, idempotent ændring: app_config-nøglen 'economy_no_upkeep_v1'
-- (DEFAULT 'off' = UÆNDRET adfærd: alle tre udgifter opkræves som i dag).
-- Læses af backend/lib/economyNoUpkeepFlag.ts. ON CONFLICT DO NOTHING —
-- overskriver ALDRIG en værdi der allerede er sat. Fail-safe hvis nøglen
-- mangler/læsningen fejler: 'off'. 'beta' læses som 'off'.
--
-- Flippet sker på ejer-go EFTER at sæsonens sidste seniorløb er afregnet og
-- FØR "Udfør sæsonskifte" (12c):
--   UPDATE public.app_config SET value='"on"'::jsonb  WHERE key='economy_no_upkeep_v1';
-- Rollback (udgifterne tilbage) bør ske ved et sæsonskifte — midt i en sæson
-- trækker næste afregning rejse og personale for alle sæsonens afsluttede
-- seniorløbsdage på én gang:
--   UPDATE public.app_config SET value='"off"'::jsonb WHERE key='economy_no_upkeep_v1';

BEGIN;

INSERT INTO public.app_config (key, value, description)
VALUES ('economy_no_upkeep_v1', '"off"'::jsonb,
  'Ingen upkeep, akademi-drift eller facilitets-upkeep (#6936). ''off'' (default) = alle tre udgifter opkræves som hidtil. ''on'' = intet upkeep (hverken fladt ved sæsonstart eller rejse og personale pr. seniorløbsdag), ingen akademi-drift og ingen facilitets-upkeep ved sæsonstart; prognose, sæsonskifte-kvittering og Klub-siden viser dem ikke. Facilitetskøb, scout-rejser og lønninger er uændrede. Fail-safe ''off''; ''beta'' læses som ''off''.')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- Post-verify:
--   SELECT value FROM public.app_config WHERE key = 'economy_no_upkeep_v1';   -- "off"
