-- #5950 (Udvikling 2.0, epic #6110): flag for loebsdag = haard dag + tillaeg i
-- etapens evner, vaegtet efter rytterens rolle paa etapen.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender (beta taeller som slukket: live balance-aendring
-- uden skyggedata). Kraever race_day_development_enabled (loebsdagen udvikler
-- overhovedet). Tallene ligger IKKE her (hard rule 17), men i den lukkede tabel
-- private_config (noegle race_day_role_yield_params). Flag on uden gyldige params =
-- dagens loebsdag. Taendes af ejeren via taendingskort.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'race_day_role_yield_enabled',
    '"off"'::jsonb,
    'Stage flag (off|on) for #5950 race-day development: a race day is a hard training day in the stage abilities plus an extra, and the rider''s role on the stage decides where the extra lands (captains in the decisive ability, helpers in the helper abilities, free role a mix). Same total for every role; max +1 per ability per race day unchanged. Senior, U23 and junior. Part of Rider Development 2.0. Off = today''s race day, bit-identical. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
