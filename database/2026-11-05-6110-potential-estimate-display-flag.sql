-- #7684 / #6110 byggetrin 4 (spec docs/superpowers/specs/2026-10-23-6110-potentiale-et-tal-samlet-design.md §3, §8, §11).
--
-- `potential_estimate_display` er kontakten for én prognose-kilde: tændt svarer
-- estimates, scouting-rapporten, development-projection og akademiet fra de gemte
-- skøn i rider_potential_estimates. `potential_single_number` kan ikke bruges til
-- det: den er pensioneret og står `on` i prod, så en genbrug ville tænde visningen
-- med det samme.
--
-- Startstadiet er `off`: ingen spiller ser en ændring, når migrationen er applied.
-- Flaget tændes samlet med resten af Udvikling 2.0 (ejer-only).
--
-- Evalueres af backend/lib/potentialEstimateFlag.js via evaluateFlagStage
-- (off | beta | on). Rent visning: ingen motor eller værdi læser flaget.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et
-- stadie ejeren allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'potential_estimate_display',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the single potential source in Development 2.0 (#7684, spec 6110 sections 3, 8, 11): estimates, the scouting report, the development projection and the academy answer from the stored estimate per (rider, team). Display only. Flips together with the rest of Development 2.0.'
)
ON CONFLICT (key) DO NOTHING;
