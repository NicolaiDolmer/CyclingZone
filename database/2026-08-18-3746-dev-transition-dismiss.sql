-- Overgangs-panelet (trin 7-udrulningen, ejer-design 18/8, #3746/#3803):
-- server-persisteret dismiss af "Udviklingsvisningen er lagt om"-panelet pr.
-- hold (#2439-mønsteret — sessionStorage nulstiller sig selv, localStorage
-- følger ikke spilleren på tværs af devices).
--
-- Idempotent. Applies af Claude POST-merge under #2642-rammerne.
-- Backend læser/skriver kolonnen med graceful degradation (42703) indtil den
-- findes, så rækkefølgen deploy-før-migration er sikker.
--
-- Post-verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'teams' AND column_name = 'dev_transition_dismissed_at';

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS dev_transition_dismissed_at timestamptz;
