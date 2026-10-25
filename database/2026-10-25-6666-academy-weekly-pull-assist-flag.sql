-- #6666: flag for ugens akademi-sweep: AI-hold henter selv ugens kuld, og
-- menneskehold der ikke har hentet faar een paamindelse soendag.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender (sweep'en er en cron uden viewer, saa beta
-- taeller som slukket). Taendes kun paa ejerens go.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'academy_weekly_pull_assist_enabled',
  '"off"'::jsonb,
  'Stage flag (off|on) for #6666: AI teams pull the weekly academy batch themselves, and human teams with an academy that have not pulled get one inbox reminder on Sunday (Europe/Copenhagen). Idempotent per team and week. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
