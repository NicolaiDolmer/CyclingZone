-- #5443 · Løngrundlaget får sin EGEN model-nøgle (ejer-beslutning 2, 20/9 aften).
--
-- BAGGRUNDEN, ordret fra ejeren: "Løn skal ikke følge værdi, løn skal følge
-- potentielle resultater + omdømme + evner og den slags ting."
--
-- Løngrundlaget er `riders.current_production_value` (CPV), og lønnen er en fast
-- andel af det (ECONOMY_RULES §2, #3989). CPV regnes af den SAMME modelkæde som
-- prisen, så en tænding af den nye prismodel ville også flytte fremtidige
-- lønkrav — midt i forlængelserne ved sæsonskiftet. Ejeren besluttede at
-- løngrundlaget bliver stående, indtil han selv flipper DENNE nøgle.
--
-- To nøgler, to spilregler:
--   rider_valuation_model         -> base_value (prisen)
--   rider_production_value_model  -> current_production_value (løngrundlaget)
--
-- DENNE MIGRATION ER INERT. Nøglen seedes 'v4' — præcis den model der regner
-- løngrundlaget i dag — og koden er fail-safe (manglende/ukendt værdi eller
-- læsefejl ⇒ v4, se backend/lib/riderValuationModelSelect.js). Merge flytter
-- derfor intet løngrundlag og ingen løn.
--
-- FLYT løngrundlaget over på den nye model (ejer-handling, EFTER at
-- forlængelserne ved sæsonskiftet er overstået):
--   UPDATE public.app_config SET value = '"v5"'::jsonb WHERE key = 'rider_production_value_model';
-- TILBAGE igen:
--   UPDATE public.app_config SET value = '"v4"'::jsonb WHERE key = 'rider_production_value_model';
--
-- Bemærk: nøglen bestemmer hvad der REGNES fra næste værdi-kørsel. Den
-- omskriver ikke allerede signerede kontrakter — kontrakt-løn er frossen ved
-- signering (#1309). Den flytter kun grundlaget for FREMTIDIGE lønkrav.
--
-- ⚠️ LIVSCYKLUS — LÆS FØR MERGE: filer i database/2026-*.sql KØRER AUTOMATISK
--    mod prod ved merge til main (.github/workflows/auto-migrate.yml, AGENTS.md
--    hard rule 9). Ejeren merger derfor PR'en manuelt, og post-apply-
--    verifikationen (nøglen findes og står 'v4') noteres i PR-/issue-tråden.
--    Migrationen er ikke-destruktiv (INSERT ... ON CONFLICT DO NOTHING).
--
-- Rollback:
--   DELETE FROM public.app_config WHERE key = 'rider_production_value_model';

INSERT INTO public.app_config (key, value, description)
VALUES
  ('rider_production_value_model', '"v4"'::jsonb,
   'Hvilken model der regner riders.current_production_value — løngrundlaget, jf. ECONOMY_RULES §2 (#5443, ejer-beslutning 2 den 20/9). Adskilt fra rider_valuation_model, som styrer base_value (prisen). ''v4'' (default, og enhver ukendt værdi) = backend/lib/riderValuationModelV4.json, altså uændrede lønkrav. ''v5'' = backend/lib/riderValuationModelV5.json. Læses én gang pr. værdi-kørsel (søndags-refresh, sæson-transition, backfill), ikke ved boot. Fail-safe: læsefejl ⇒ v4. Flippes først når ejeren siger til — kontraktforlængelserne ved sæsonskiftet skal være overstået.')
ON CONFLICT (key) DO NOTHING;
