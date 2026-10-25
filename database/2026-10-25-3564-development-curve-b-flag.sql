-- #3564: flag for kurve B (D-058, Udvikling 2.0): udviklingen styres af niveau og
-- potentiale, ikke alder.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender (beta taeller som slukket: live balance-aendring
-- uden skyggedata). Taendes af ejeren efter en ny 10-saesoners-koersel med den
-- rigtige kurve. Kurvens tal ligger IKKE her (hard rule 17), men i serverens miljoe.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'development_curve_b',
  '"off"'::jsonb,
  'Stage flag (off|on) for #3564 curve B (D-058): daily development is driven by ability level and potential, not age; age only limits how much training the youngest riders can take. Part of Rider Development 2.0 (#6110). Off = today''s model, bit-identical. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
