-- #6950 (Udvikling 2.0, epic #6110): flag for Udviklingsscore B i motoren og for
-- catch-up via loeb.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender (beta taeller som slukket: live balance-aendring
-- uden skyggedata). Begge kraever ability_cap_per_date_enabled; uden det koerer
-- motoren dagens model. Tallene ligger IKKE her (hard rule 17), men i serverens
-- miljoe. Taendes af ejeren samme soendag som resten af Udvikling 2.0.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'development_score_v2',
    '"off"'::jsonb,
    'Stage flag (off|on) for #6110/#6950 Development Score B: the daily development follows one score per day (training and race days), without condition, fatigue or age. Requires ability_cap_per_date_enabled. Part of Rider Development 2.0. Off = today''s model, bit-identical. Owner-only flip.'
  ),
  (
    'race_day_catchup_enabled',
    '"off"'::jsonb,
    'Stage flag (off|on) for #6950 catch-up via racing: coaches and facilities lift training days only, and the race-day extra in the stage abilities is the same for every team. Requires ability_cap_per_date_enabled. Part of Rider Development 2.0. Off = today''s model, bit-identical. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
