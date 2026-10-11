-- #6499/#6500 — Udvikling 2.0 del 1: flaget for tilbagegang D4 + D6 (ejer-beslutninger 11/10).
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender (beta taeller som slukket: live balance-aendring
-- uden skyggedata). Taendes af ejeren foer saesonskiftet 25/10, efter proevekoersel.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'development_v2_aging_enabled',
  '"off"'::jsonb,
  'Stage flag (off|on) for Rider Development 2.0 part 1 (#6110): at the season change only physical abilities + cobblestone decline from age 31, braked by own race days (and hard training days for manager riders), no season growth; riders outside manager teams get no daily ability gains. Owner-only flip, before the season change.'
)
ON CONFLICT (key) DO NOTHING;
