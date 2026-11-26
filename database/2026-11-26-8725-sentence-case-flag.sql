-- #8725 (TASTE v2 M1): små labels i sentence case i stedet for VERSALER med
-- spærring i de fælles komponenter (tabeloverskrifter, kort-meta, stat-labels,
-- felt-labels, mærker, rytterkortet og menuens grupper).
--
-- Startstadiet er `off`: ingen spiller ser en ændring, når migrationen er applied.
-- Ejeren flytter flaget fra admin-fladen (off | beta | on), beta-testere først.
--
-- Rent visning: flaget læses af GET /api/feature-flags. Motoren læser det ikke.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et
-- stadie ejeren allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'sentence_case_8725',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for sentence case in small labels (#8725, TASTE v2 M1): table headers, card meta, stat labels, field labels, badges, the rider card and the menu groups drop the spaced capitals. Display only.'
)
ON CONFLICT (key) DO NOTHING;
