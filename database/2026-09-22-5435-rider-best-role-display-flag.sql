-- #5435 (D-049, model A) — rating-visningen "bedste rolle nu" bag et stadie-flag.
--
-- EJER-BESLUTNING 22/9: visningen (rating = bedste rolle nu med rollenavn,
-- badge = "Natural role / Naturlig rolle", ingen loft-tal) taendes i SAMME
-- deploy som vaerdiskiftet (#5443/#5497), ikke foer. Startstadiet er derfor
-- `off`: ingen spiller ser en aendring naar migrationen er applied.
--
-- Evalueres af backend/lib/riderBestRoleDisplayFlag.js via evaluateFlagStage
-- (off | beta | on, featureStage.js) og leveres som en bar boolean
-- (`rider_best_role_display`) i GET /api/display-flags. Flaget staar i
-- STAGE_FLAGS (backend/lib/stageFlagCatalog.js), saa ejeren kan flytte det fra
-- admin-fladen. `beta` = kun beta-testere/admin ser den nye visning.
--
-- Rent visning: ingen backend-beregning laeser flaget. riders.best_role/
-- best_role_rating caches uanset flaget (#5487).
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et stadie
-- ejeren allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'rider_best_role_display',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the rider rating display (#5435, D-049 model A): rating = best role now with the role name, type badge labelled Natural role, no ceiling numbers on the profile. Display only. Owner call 2026-09-22: flips in the same deploy as the value change (#5443/#5497).'
)
ON CONFLICT (key) DO NOTHING;
