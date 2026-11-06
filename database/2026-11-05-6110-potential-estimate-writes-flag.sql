-- #7685 (Udvikling 2.0 trin 5, epic #6110): kontakten for skrivningen af gemte potentiale-skoen.
--
-- Taendt: soendagskoerslen, holdskifte-sweepet og nye kig skriver i
-- public.rider_potential_estimates. Slukket: ingen af dem laeser eller skriver noget.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender (beta taeller som slukket: skrivningen gaelder alle hold).
-- Ikke spiller-synlig: ingen flade laeser tabellen endnu. Kalibreringen ligger IKKE her, men i
-- private_config-noeglen potential_estimate_params (hard rule 17), og uden den skrives intet.
-- Ryttere uden talent_ceiling springes over, saa flaget goer intet foer omregningen (byggetrin 12).
-- Laeses af backend/lib/potentialEstimateWritesFlag.js.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.
--
-- Post-verify (read-only):
--   SELECT key, value FROM public.app_config WHERE key = 'potential_estimate_writes';

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'potential_estimate_writes',
    '"off"'::jsonb,
    'Stage flag (off|on) for #7685/#6110: the Sunday run, the team change sweep and new scout looks write stored potential estimates to rider_potential_estimates. Needs private_config potential_estimate_params and riders.talent_ceiling. Off = nothing is read or written. Not player-visible. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
