-- database/2026-08-03-3232-form-reset-app-config.sql
-- #3232 (design/balance) — ejer-beslutning 2026-08-03: form SKAL nulstilles ved
-- sæsonskifte (hidtil bevidst urørt, se seasonFatigueReset.js:13-15). Målværdien
-- er IKKE valgt endnu, så denne migration leverer KUN konfigurationsrækkerne for
-- alle tre kandidat-modes — mekanismen bor i backend/lib/seasonFormReset.js og
-- kaldes fra seasonStartHooks.js (samme kaldepunkt som #2910/#2911).
--
-- DEFAULT = DEAKTIVERET (season_form_reset_mode = "off"): denne migration
-- ændrer INTET spilbart. Ejeren vælger mode ud fra sim-harnessets sammenligning
-- (docs/audits/2026-08-03-form-reset-sim-3232.md) og flipper KUN config-rækken
-- før S2→S3-skiftet (~23/8).
--
-- Flip til live (eksempler — vælg ÉN mode):
--   UPDATE public.app_config SET value = '"baseline"'::jsonb WHERE key = 'season_form_reset_mode';
--   UPDATE public.app_config SET value = '"band"'::jsonb     WHERE key = 'season_form_reset_mode';
--   UPDATE public.app_config SET value = '"decay"'::jsonb    WHERE key = 'season_form_reset_mode';
-- Slå fra igen (kill-switch):
--   UPDATE public.app_config SET value = '"off"'::jsonb      WHERE key = 'season_form_reset_mode';
-- Justér en parameter (eksempel — smallere bånd):
--   UPDATE public.app_config SET value = '45'::jsonb WHERE key = 'season_form_reset_band_min';
--
-- Idempotent (ON CONFLICT DO NOTHING) — sikker at køre flere gange, og
-- overskriver ALDRIG en værdi ejeren allerede har flippet.

INSERT INTO public.app_config (key, value, description)
VALUES
  ('season_form_reset_mode', '"off"'::jsonb,
   'Fastlægger HVORDAN alle rytteres form nulstilles ved sæsonskiftet (#3232, ejer-beslutning 2026-08-03: form skal nulstilles, målværdi TBD). "off" = ingen ændring (default, nuværende adfærd: form bæres uændret med fra forrige sæson). "baseline" = alle sættes til season_form_reset_baseline_value. "band" = hver rytter får en deterministisk, tilfældig værdi i [season_form_reset_band_min, season_form_reset_band_max], seedet på rytter+sæson (idempotent ved gen-kørsel). "decay" = ny = season_form_reset_decay_target + (gammel - target) × season_form_reset_decay_factor (bevarer et svagt aftryk af slutformen, IKKE idempotent ved gen-kørsel — se seasonFormReset.js). Håndhæves i seasonFormReset.js, kaldt fra seasonStartHooks.js. Ejeren vælger mode ud fra docs/audits/2026-08-03-form-reset-sim-3232.md.'),
  ('season_form_reset_baseline_value', '50'::jsonb,
   '#3232 · mode "baseline": den faste værdi alle rytteres form sættes til ved sæsonskiftet. Bruges kun når season_form_reset_mode = "baseline".'),
  ('season_form_reset_band_min', '40'::jsonb,
   '#3232 · mode "band": nedre grænse for det tilfældige (seedet, deterministiske) sæsonstart-bånd. Bruges kun når season_form_reset_mode = "band".'),
  ('season_form_reset_band_max', '60'::jsonb,
   '#3232 · mode "band": øvre grænse for det tilfældige (seedet, deterministiske) sæsonstart-bånd. Bruges kun når season_form_reset_mode = "band".'),
  ('season_form_reset_decay_target', '50'::jsonb,
   '#3232 · mode "decay": midtpunktet rytterens form henfalder mod. Bruges kun når season_form_reset_mode = "decay".'),
  ('season_form_reset_decay_factor', '0.25'::jsonb,
   '#3232 · mode "decay": andelen af afstanden til target der IKKE henfalder (0 = fuld nulstilling til target, 1 = ingen ændring). Bruges kun når season_form_reset_mode = "decay".')
ON CONFLICT (key) DO NOTHING;
