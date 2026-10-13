-- #1140 Pakke A: "Your first race"-kort paa dashboardet for nye hold, bag et
-- stadie-flag. Ejer-go 12/10.
--
-- Startstadiet er `off`: ingen spiller ser noget nyt, foer ejeren flytter flaget
-- fra admin-fladen (STAGE_FLAGS, backend/lib/stageFlagCatalog.js). Ejer og
-- beta-testere kan se kortet FOER flaget aendres via ?preview=first-race paa
-- dashboardet (laest server-side, aldrig for andre).
--
-- Evalueres af backend/lib/firstRaceCardFlag.js via evaluateFlagStage
-- (off | beta | on, featureStage.js) og leveres til klienten som bare booleans
-- af GET /api/me/first-race-card.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et stadie
-- ejeren allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'first_race_card',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the "Your first race" card at the top of the dashboard for teams with no result yet (#1140, owner go 2026-10-12). Shows the race, the start time in the player''s own time zone and what happens next. While it shows, the "Pick your race squad" card is hidden and "Get started" moves below it. beta = beta testers and admins only. ?preview=first-race shows it to beta testers and admins whatever the stage.'
)
ON CONFLICT (key) DO NOTHING;
