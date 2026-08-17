-- #3750 / #3449 / #3645 · Konfigurations-håndtag for det markedsdrevne
-- værdi-eftersyn. INGEN adfærdsændring ved merge.
--
-- ⚠️ LIVSCYKLUS - LÆS FØR MERGE: filer i database/2026-*.sql KØRER AUTOMATISK
--    mod prod ved merge til main (.github/workflows/auto-migrate.yml, AGENTS.md
--    hard rule 9). Merge ER applikationen. Derfor er denne fil skrevet til at
--    være INERT PÅ TRE MÅDER, ikke én:
--
--      1. market_value_sweep_enabled seedes 'off'.
--      2. market_value_global_weight seedes 0 - selv hvis flaget ved en fejl
--         blev flippet til 'on', er w_rider = global_weight x Z = 0, og hver
--         rytters nye værdi er dermed identisk med hans nuværende.
--      3. Sweep-koden findes slet ikke på main endnu (den ligger på PR #3449's
--         branch). Nøglerne er i dag rene data uden læser.
--
--    Målt read-only mod prod 17/8 FØR denne fil: `select key from app_config
--    where key like 'market_value%'` returnerede 0 rækker. Migrationen opretter
--    dem altså, den overskriver ingen eksisterende værdi (ON CONFLICT DO
--    NOTHING), og en senere kørsel af #3449's egen
--    database/2026-08-06-3448-market-value-sweep.sql vil derfor IKKE kunne
--    hæve global_weight til 0.5 bagefter - dens INSERT rammer konflikt og gør
--    intet. Rækkefølgen er bevidst.
--
-- Hvorfor global_weight er 0 og ikke 0.5 (som #3449's udkast foreslog):
-- ejer-beslutning 15/8 (beslutning 3, docs/audits/2026-08-15-oekonomi-
-- beslutninger-1-3.md) afskaffede den globale 75/25-blanding. Vægten er nu pr.
-- rytter: Z = n/(n+12), hvor n er antallet af KVALIFICEREDE handler med
-- sammenlignelige ryttere. global_weight er derfor degraderet fra "modellens
-- halve indflydelse" til en ren hovedafbryder/skalering oven på Z. Ved
-- aktivering er den tiltænkte værdi 1.0 - men det er en ejer-handling, ikke en
-- migration.
--
-- AKTIVERING (ejer-gated, IKKE en del af denne PR - se #3645's cutover-drejebog):
--   UPDATE public.app_config SET value = '1'::jsonb    WHERE key = 'market_value_global_weight';
--   UPDATE public.app_config SET value = '"on"'::jsonb WHERE key = 'market_value_sweep_enabled';
-- Deaktivering:
--   UPDATE public.app_config SET value = '"off"'::jsonb WHERE key = 'market_value_sweep_enabled';
--
-- Rollback:
--   DELETE FROM public.app_config WHERE key IN
--     ('market_value_sweep_enabled', 'market_value_global_weight', 'market_value_weekly_cap');
--
-- Post-apply-verifikation (påkrævet):
--   SELECT key, value FROM public.app_config WHERE key LIKE 'market_value%' ORDER BY key;
--   -- forventet: enabled="off", global_weight=0, weekly_cap=0.25

INSERT INTO public.app_config (key, value, description)
VALUES
  ('market_value_sweep_enabled', '"off"'::jsonb,
   'Markedsdrevet værdi-eftersyn (#3448/#3449). ''on'' = søndags-sweepen blander riders.base_value mod markedsmodellens pris-gæt, vægtet med hver rytters egen handelsevidens (Z = n/(n+K), beslutning 3 af 15/8) og loftet af market_value_weekly_cap. ''off'' (default) = ingen ændring. Aktivering er ejer-gated og kræver at et godkendt modelartefakt er promoveret; pr. 17/8 målte refittet (#3750) DÅRLIGERE end den kørende v4 - se docs/audits/2026-08-17-vaerdimodel-refit-scorecard.md.'),
  ('market_value_global_weight', '0'::jsonb,
   'Hovedafbryder/skalering oven på den pr.-rytter-evidensvægt Z: w_rider = market_value_global_weight x Z_rider. Seedet til 0 så migrationen er inert selv hvis kill-switchen flippes ved en fejl. Beslutning 3 (15/8) afskaffede den globale 75/25-blanding - evidensen vejer nu pr. rytter, så den tiltænkte værdi ved aktivering er 1. Ugyldig/manglende værdi skal af koden behandles som 0 (fail-safe).'),
  ('market_value_weekly_cap', '0.25'::jsonb,
   'Ugentligt pr.-rytter ændrings-loft: |ny − nuværende| / nuværende <= denne værdi, hver søndag. 0.25 (±25 %) er ejer-besluttet 6/8. BEMÆRK auditten 14/8, grund 3: et uniformt loft bider hver uge på præcis de dyreste ryttere og virker som et handicap frem for en struktur. Tallet skal revurderes FØR flaget flippes; det står her fordi håndtaget skal være synligt, ikke fordi 0.25 er bekræftet.')
ON CONFLICT (key) DO NOTHING;
