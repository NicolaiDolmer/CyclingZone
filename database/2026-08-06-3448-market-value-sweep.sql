-- #3448 · Markedsdrevet værdi-eftersyn — søndags-sweep. Kill-switch + config +
-- dedup-log for backend/lib/marketValueSundaySweep.js.
--
-- DENNE MIGRATION ER INERT. market_value_sweep_enabled seedes 'off', og sweepen
-- er allerede fail-safe (manglende/ukendt nøgle ⇒ slukket, se
-- marketValueSweepConfig.js), så den ændrer INTET i spillet ved merge. Den
-- findes for at gøre håndtagene synlige i app_config i stedet for at kræve en
-- håndskrevet INSERT den dag ejeren vil teste den.
--
-- Slå TIL (ejer-go givet 6/8 for søndag 9/8: 50/50-blend + ±25 %-loft,
-- se #3448 kommentar 3):
--   UPDATE public.app_config SET value = '"on"'::jsonb WHERE key = 'market_value_sweep_enabled';
-- Slå FRA igen:
--   UPDATE public.app_config SET value = '"off"'::jsonb WHERE key = 'market_value_sweep_enabled';
-- Justér global markedsvægt/ugentligt loft (uden deploy):
--   UPDATE public.app_config SET value = '0.5'::jsonb  WHERE key = 'market_value_global_weight';
--   UPDATE public.app_config SET value = '0.25'::jsonb WHERE key = 'market_value_weekly_cap';
--
-- market_value_sunday_sweep_log: persisteret dedup-anker (samme mønster som
-- discord_race_digest_log, 2026-08-05) — UNIQUE(sweep_date) forhindrer at
-- sweepen kører to gange samme danske søndag, selv hvis processen genstarter
-- (Railway-redeploy) midt i vinduet. service-role only.
--
-- ⚠️ Denne fil COMMITTES kun — den anvendes ALDRIG af implementerings-agenten
--    mod prod under selve PR'en. Claude applier migrationen som et SEPARAT
--    post-merge-skridt (idempotent + post-verify, #2642-rammer, jf. CLAUDE.md
--    hard rule 9). Ikke-destruktiv (kun CREATE/INSERT ON CONFLICT DO NOTHING)
--    — ingen ejer-gate nødvendig for selve migrationen (kill-switch-værdien
--    'off' er den destruktive-mutation-gaten).
--
-- Rollback:
--   DELETE FROM public.app_config WHERE key IN
--     ('market_value_sweep_enabled', 'market_value_global_weight', 'market_value_weekly_cap');
--   DROP TABLE IF EXISTS public.market_value_sunday_sweep_log;

INSERT INTO public.app_config (key, value, description)
VALUES
  ('market_value_sweep_enabled', '"off"'::jsonb,
   'Markedsdrevet værdi-eftersyn (#3448). ''on'' = marketValueSundaySweep.js kører hver søndag (dansk tid): blander riders.base_value mod markedsmodel v1.1''s pris-gæt (backend/lib/marketValueModelV1.json), vægtet med hver rytters handelsevidens-tæthed (support-guard, K=12/±5 O/±3 år) og loftet af market_value_weekly_cap pr. uge. ''off'' (default) = ingen ændring, sweepen no-op''er stille. Ejer-go givet 6/8 (±25 %-loft); flippes ''on'' ved søndags-aktiveringen 9/8 (#3448).'),
  ('market_value_global_weight', '0.5'::jsonb,
   'Global markedsvægt FØR support-multiplikation (#3448): w_rider = market_value_global_weight × support(rider). 0.5 er tallet #3448''s konvergens-simulering brugte for de to første uger (9/8+16/8) — kalibreret op til 1.0 ved sæsonskiftet (23/8) i simuleringen, IKKE automatisk her (kræver eksplicit ejer-opdatering af denne nøgle). Ugyldig/manglende værdi falder tilbage til 0.5.'),
  ('market_value_weekly_cap', '0.25'::jsonb,
   'Ugentligt pr.-rytter ændrings-loft (#3448): |ny − nuværende| / nuværende <= denne værdi, hver søndag. 0.25 (±25 %) er ejer-besluttet 6/8 ud fra konvergens-simuleringen (50,9 % konvergens ved 23/8, kontrolleret enkelt-uge-chok — se #3448 kommentar 2+3). Ugyldig/manglende værdi falder tilbage til 0.25.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.market_value_sunday_sweep_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_date TEXT NOT NULL,
  scanned INT NOT NULL DEFAULT 0,
  changed INT NOT NULL DEFAULT 0,
  written INT NOT NULL DEFAULT 0,
  global_weight NUMERIC,
  weekly_cap NUMERIC,
  sales_index_size INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sweep_date)
);

ALTER TABLE public.market_value_sunday_sweep_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.market_value_sunday_sweep_log FROM anon, authenticated;
GRANT ALL ON public.market_value_sunday_sweep_log TO service_role;

COMMENT ON TABLE public.market_value_sunday_sweep_log IS
  '#3448: dedupe-anker for den ugentlige markedsdrevne værdi-eftersyns-sweep — UNIQUE(sweep_date) forhindrer dobbelt-kørsel samme danske søndag på tværs af proces-genstarter (mirrors discord_race_digest_log''s mønster). service-role only.';
