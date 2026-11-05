-- #7686 (Udvikling 2.0 trin 6, epic #6110): flag for at Hjaelp beskriver potentialet
-- som tal + ord. Selve visningen styres af om serveren sender `potentialView`; dette
-- flag holder Hjaelp-teksten i takt med den. `potential_single_number` kan ikke bruges:
-- den staar on i prod og styrer ikke laengere noget.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Taendes af ejeren samlet med resten af Udvikling 2.0 (spec §8, D7).
-- Laeses af frontend/src/pages/helpFlagGates.js via GET /api/feature-flags.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.
--
-- Post-verify (read-only):
--   SELECT key, value FROM public.app_config WHERE key = 'potential_estimate_view';

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'potential_estimate_view',
    '"off"'::jsonb,
    'Stage flag (off|beta|on) for #7686 under Development 2.0 (spec 6110): Help describes potential as one estimated number plus a certainty word instead of a range. Owner-only flip, together with the rest of Development 2.0.'
  )
ON CONFLICT (key) DO NOTHING;
