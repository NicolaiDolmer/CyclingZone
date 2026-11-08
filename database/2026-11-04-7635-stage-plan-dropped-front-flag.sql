-- #7635 + #7636 (ejer-go 4/11, loesning A): kontakten for etapeplanens "sat"-regel.
--
-- Taendt: kun en rigtig opdeling af feltet goer en rytter med etapeplan "sat" (grupper
-- opstaaet ved et angreb taeller aldrig som fronten, og afstanden skal vaere reel og holde),
-- og etapeplanens resume krydstjekker rytterens gruppe i loebsfilmen.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender (beta taeller som slukket: kontakten aendrer
-- loebsresultater for alle hold). Virker kun i loeb paa s5_profiles_v3 med etapeplan.
-- Laeses af backend/lib/stagePlanDroppedFront7635Flag.js i raceRunner.resolveRaceEngineV4
-- og af GET /api/feature-flags (resumeet). Tallene ligger IKKE her (hard rule 17).
-- Taendes af ejeren efter at have set foer/efter-genkoerslen af Giro della Penisola etape 8.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.
--
-- Post-verify (read-only):
--   SELECT key, value FROM public.app_config WHERE key = 'stage_plan_dropped_front_7635';

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'stage_plan_dropped_front_7635',
    '"off"'::jsonb,
    'Stage flag (off|on) for #7635/#7636: in the stage plan only a real split of the field makes a rider dropped (a group born from an attack never counts as the front, and the gap must be real and hold), and the stage plan recap checks the rider''s group in the race film. Only races on s5_profiles_v3 with a stage plan. Off = today''s behaviour, bit-identical. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
