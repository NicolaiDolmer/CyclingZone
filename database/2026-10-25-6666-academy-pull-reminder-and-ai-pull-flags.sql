-- #6666 / #7177: to separate flag for ugens akademi-kuld (ejer 25/10: "Kun
-- paamindelsen"; de to dele har hver sit flag).
--   academy_pull_reminder_enabled   paamindelser til menneskehold der ikke har
--                                   hentet: soendag fra kl. 10 og loerdag fra kl. 18.
--   academy_ai_weekly_pull_enabled  AI-hold henter selv ugens kuld (en senere,
--                                   separat beslutning).
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Begge oprettes 'off'. Kun 'on' taender (begge er cron-jobs uden viewer, saa beta
-- taeller som slukket). Taendes kun paa ejerens go.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'academy_pull_reminder_enabled',
    '"off"'::jsonb,
    'Stage flag (off|on) for #6666/#7177: human teams with an academy that have not pulled this week''s intake get an inbox reminder on Sunday from 10:00 (new candidates are ready) and on Saturday from 18:00 (the intake expires tonight), Europe/Copenhagen. At most one of each per team per week. Owner-only flip.'
  ),
  (
    'academy_ai_weekly_pull_enabled',
    '"off"'::jsonb,
    'Stage flag (off|on) for #6666: AI teams pull the weekly academy intake themselves, via the same claim as human teams, on Sunday (Europe/Copenhagen). Idempotent per team and week. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
