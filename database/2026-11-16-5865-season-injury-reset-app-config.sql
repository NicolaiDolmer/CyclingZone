-- database/2026-11-16-5865-season-injury-reset-app-config.sql
-- #5865 — skader ved sæsonskiftet (spillerønske 28/9). Ejeren har ikke valgt
-- adfærd endnu (A helt væk / B afkortet / C kun korte væk), så denne migration
-- leverer KUN konfigurationsrækkerne. Mekanismen bor i backend/lib/seasonInjuryReset.js
-- og kaldes fra seasonStartHooks.js (samme kaldepunkt som træthedens nulstilling).
-- Design: docs/design/reviews/2026-11-16-5865-skader-ved-saesonskiftet.md.
--
-- DEFAULT = SLUKKET (season_injury_reset_mode = "off"): migrationen ændrer INTET
-- spilbart. Ingen eksisterende skade røres af migrationen selv; reglen virker
-- først ved næste sæsonskifte EFTER ejeren har tændt den.
--
-- Tænd (ejer-go, vælg ÉN mode, før sæsonskiftet):
--   UPDATE public.app_config SET value = '"clear"'::jsonb WHERE key = 'season_injury_reset_mode';  -- A
--   UPDATE public.app_config SET value = '"cap"'::jsonb   WHERE key = 'season_injury_reset_mode';  -- B
--   UPDATE public.app_config SET value = '"light"'::jsonb WHERE key = 'season_injury_reset_mode';  -- C
-- Sluk igen (kill-switch):
--   UPDATE public.app_config SET value = '"off"'::jsonb   WHERE key = 'season_injury_reset_mode';
--
-- Idempotent (ON CONFLICT DO NOTHING): sikker at køre flere gange, og overskriver
-- ALDRIG en værdi ejeren allerede har sat.

INSERT INTO public.app_config (key, value, description)
VALUES
  ('season_injury_reset_mode', '"off"'::jsonb,
   '#5865: hvad der sker med aktive skader og sygdomme ved sæsonskiftet. "off" = intet (default, nuværende adfærd: skaden løber videre ind i den nye sæson). "clear" = alle forsvinder. "cap" = afkortes til højst season_injury_reset_cap_dates løbsdatoer ind i den nye sæson. "light" = kun skader der højst rækker season_injury_reset_light_max_dates løbsdatoer ind, forsvinder. Håndhæves i backend/lib/seasonInjuryReset.js, kaldt fra seasonStartHooks.js.'),
  ('season_injury_reset_cap_dates', '1'::jsonb,
   '#5865 · mode "cap": højst så mange løbsdatoer (inkl. den første) rækker en skade ind i den nye sæson. Bruges kun når season_injury_reset_mode = "cap".'),
  ('season_injury_reset_light_max_dates', '2'::jsonb,
   '#5865 · mode "light": skader der højst rækker så mange løbsdatoer ind i den nye sæson, forsvinder; længere skader løber uændret videre. Bruges kun når season_injury_reset_mode = "light".')
ON CONFLICT (key) DO NOTHING;

-- ── POST-VERIFY (read-only, efter auto-migrate.yml) ──────────────────────────
--   SELECT key, value FROM public.app_config WHERE key LIKE 'season_injury_reset_%' ORDER BY key;
--   -- forventet: 3 rækker; season_injury_reset_mode = "off".
