-- #5950 loesning A (ejer-valg 3/11): underkontakt til race_day_role_yield_enabled.
-- Naar den er on, styrer rytterens rolle paa etapen ogsaa loebsdagens BASIS-dag
-- (ikke kun tillaegget): kaptajn og jaeger uaendret, hjaelperen faar basis-dagen i
-- hjaelpe-evnerne og udvikler ikke etapens afgoerende evne, fri rolle en blanding.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender (beta taeller som slukket: live balance-aendring
-- uden skyggedata). Laeses kun naar race_day_role_yield_enabled er on og params er
-- gyldige. Off = hovedflagets model, bit-identisk. Ingen tal her (hard rule 17).
-- Taendes af ejeren via taendingskort.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'race_day_role_base_day_enabled',
    '"off"'::jsonb,
    'Stage flag (off|on) for #5950 option A, a sub-switch of race_day_role_yield_enabled: the rider''s role on the stage also decides the race day''s base hard day, not only where the extra lands. Captains and hunters unchanged; helpers get the base day in the helper abilities and do not develop the stage''s decisive ability; free role a mix. Same total for every role; max +1 per ability per race day unchanged. Only read when the main flag is on. Off = the main flag''s model, bit-identical. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
