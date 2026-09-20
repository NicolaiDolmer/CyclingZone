-- #5443 · Hvilken værdimodel produktionen regner med. ÉN nøgle, ÉT skridt.
--
-- DENNE MIGRATION ER INERT. Nøglen seedes 'v4' — præcis den model der kører i
-- dag — og koden er fail-safe (manglende/ukendt værdi ⇒ v4, se
-- backend/lib/riderValuationModelSelect.js). Merge ændrer derfor INGEN
-- rytterværdi. Den findes for at gøre håndtaget synligt i app_config i stedet
-- for at kræve en håndskrevet INSERT den dag ejeren vil tænde den nye model.
--
-- TÆND den nye model (ejer-handling, ÉT skridt — gør det FØR søndagskørslen
-- kl. 06 dansk tid, så begivenheden ER søndagskørslen):
--   UPDATE public.app_config SET value = '"v5"'::jsonb WHERE key = 'rider_valuation_model';
-- SLUK igen (rul tilbage til nuværende model):
--   UPDATE public.app_config SET value = '"v4"'::jsonb WHERE key = 'rider_valuation_model';
--
-- Bemærk: nøglen bestemmer hvilken model der REGNES med fra næste kørsel. Den
-- ruller ikke allerede skrevne værdier tilbage af sig selv — et tilbageskift
-- får først effekt ved næste værdi-kørsel. Tag en backup af
-- (rider_id, base_value, current_production_value) før tænding, som ved
-- niveaukorrektionen (#3449).
--
-- ⚠️ LIVSCYKLUS — LÆS FØR MERGE: denne fil ligger i database/2026-*.sql og
--    KØRER AUTOMATISK mod prod ved merge til main (.github/workflows/
--    auto-migrate.yml, ~3 min efter push; AGENTS.md hard rule 9). Derfor:
--    EJEREN merger denne PR manuelt (PR'er med database/*.sql må aldrig
--    auto-merges), og post-apply-verifikationen (app_config-nøglen findes og
--    står 'v4') noteres i PR-/issue-tråden.
--    Migrationen er ikke-destruktiv (INSERT ... ON CONFLICT DO NOTHING) og
--    inert. Selve aktiveringen ('v5') er den ejer-gatede handling, ikke
--    migrationen.
--
-- Rollback:
--   DELETE FROM public.app_config WHERE key = 'rider_valuation_model';

INSERT INTO public.app_config (key, value, description)
VALUES
  ('rider_valuation_model', '"v4"'::jsonb,
   'Hvilken rytter-værdimodel produktionen regner med (#5443). ''v4'' (default, og enhver ukendt værdi) = backend/lib/riderValuationModelV4.json — modellen der har kørt siden cutover (#2594): egen værdi-vægttabel, frossen riders.valuation_type (#3345), type-dæmpning (#4000). ''v5'' = backend/lib/riderValuationModelV5.json — værdien regnes på de SAMME evner som rytterens rating (rolle-opskrifterne i backend/lib/weights/displayRecipes.js), den frosne valuation_type indgår ikke, type-dæmpningen er ude, og koefficienterne er genfittet mod den nuværende typefordeling. Læses ved hver værdi-kørsel (søndags-refresh + sæson-transition), ikke ved boot: et skift virker fra næste kørsel uden deploy. Fail-safe: læsefejl ⇒ v4.')
ON CONFLICT (key) DO NOTHING;
