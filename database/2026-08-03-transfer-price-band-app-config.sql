-- database/2026-08-03-transfer-price-band-app-config.sql
-- #3133 (fair-play/B): gulv- og loft-konfiguration for spiller-til-spiller
-- prisbånd (transfer_offers-accept, swap_offers-accept inkl. cash_adjustment,
-- auktioners starting_price ved oprettelse). Håndhævelsen bor i
-- backend/lib/transferPriceBand.js.
--
-- DEFAULT = DEAKTIVERET (floor_pct=0, cap_multiple=null): denne migration
-- ændrer INTET spilbart før ejeren selv skriver reelle værdier, når #3136
-- (empirisk rekalibrering) har leveret dem.
--
-- Flip til live (eksempel — 25% gulv / 3x loft, issue-forslaget):
--   UPDATE public.app_config SET value = '0.25'::jsonb WHERE key = 'transfer_price_floor_pct';
--   UPDATE public.app_config SET value = '3'::jsonb    WHERE key = 'transfer_price_cap_multiple';
-- Slå fra igen:
--   UPDATE public.app_config SET value = '0'::jsonb    WHERE key = 'transfer_price_floor_pct';
--   UPDATE public.app_config SET value = 'null'::jsonb WHERE key = 'transfer_price_cap_multiple';
--
-- Idempotent (ON CONFLICT DO NOTHING) — sikker at køre flere gange.

INSERT INTO public.app_config (key, value, description)
VALUES
  ('transfer_price_floor_pct', '0'::jsonb,
   'Fair-play prisgulv (#3133): mindste tilladte pris for en spiller-til-spiller-handel, som andel af rytterens market_value (fx 0.25 = 25%). 0 = deaktiveret (default, ingen adfærdsændring). Håndhæves i transferPriceBand.js ved transfer_offers-accept, swap_offers-accept (samlet værdi inkl. cash_adjustment) og auktioners starting_price for EGEN rytter. Kandidatværdi afventer #3136 (empirisk rekalibrering).'),
  ('transfer_price_cap_multiple', 'null'::jsonb,
   'Fair-play prisloft (#3133): højeste tilladte pris for en spiller-til-spiller-handel, som multiplum af rytterens market_value (fx 3 = 3×). null = deaktiveret (default, ingen adfærdsændring). Samme håndhævelsespunkter som transfer_price_floor_pct. Kandidatværdi afventer #3136.')
ON CONFLICT (key) DO NOTHING;
