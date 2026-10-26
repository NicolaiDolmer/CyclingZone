-- #6210/#7075: flag for "maks +1 pr. evne pr. rytter pr. dato" (Udvikling 2.0, ejer 23/10).
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender (beta taeller som slukket: live balance-aendring
-- uden skyggedata). Taendes af ejeren samme soendag som resten af Udvikling 2.0.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'ability_cap_per_date_enabled',
  '"off"'::jsonb,
  'Stage flag (off|on) for #6210: a rider gains at most +1 per ability per calendar date, across all race-day ticks and paths (Train now, evening sweep, calendar-day fallback). Clipped progress carries over to the next date. Part of Rider Development 2.0 (#6110). Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
