-- #5519: U23 team- og Junior team-siderne bag et stadie-flag.
--
-- Roadbook-loefte ("U23 team and junior team become real squads. The 'coming
-- soon' card on the Academy page turns into the real thing."). ON = to nye
-- Klubhus-menupunkter efter My Team + en trup-side pr. ungdomstrup, og
-- akademiets "Youth squads / Coming soon"-kort forsvinder. OFF = dagens visning.
--
-- Startstadiet er `off`: ingen spiller ser en aendring naar migrationen er
-- applied. Ejeren flipper selv kontakten efter visuelt go (issue #5519).
--
-- Evalueres af backend/lib/youthSquadPagesFlag.js via evaluateFlagStage
-- (off | beta | on, featureStage.js), leveres som en bar boolean
-- (`youth_squad_pages`) i GET /api/display-flags og gater GET
-- /api/youth-squads. Flaget staar i STAGE_FLAGS
-- (backend/lib/stageFlagCatalog.js), saa ejeren kan flytte det fra
-- admin-fladen. `beta` = kun beta-testere/admin ser siderne.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et stadie
-- ejeren allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'youth_squad_pages',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the U23 team and Junior team pages (#5519): two Clubhouse menu items after My Team, one squad page each (Squad, Calendar, Results, Standings, Development), and the Academy page loses its Youth squads coming-soon card. Display only. Starts off; the owner flips it after visual approval.'
)
ON CONFLICT (key) DO NOTHING;
