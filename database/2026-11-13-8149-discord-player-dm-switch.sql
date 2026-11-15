-- #8149 trin 1: hovedafbryder for bottens PRIVATE Discord-beskeder til spillere.
--
-- Startværdien er `on`: præcis som i dag, ingen spiller mærker noget, når
-- migrationen er applied. Ejeren slukker den først med sit kør, når browser-
-- notifikationerne har overtaget (trin 2 til 4 i planen for #8149).
--
-- `off` stopper sendDM, udbakkens gentagelser, testknappen og løbsresuméet kl. 20.
-- Kanal-opslag via webhooks, ejerens alarmer, bottens læsning og divisionsrollerne
-- røres ikke. Læses af backend/lib/discordPlayerDmSwitch.js (husket i op til et minut).
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive en værdi,
-- ejeren allerede har sat.
--
-- POST-VERIFY (read-only): SELECT value FROM public.app_config WHERE key = 'discord_player_dm';  -- "on"
-- Sluk:  UPDATE public.app_config SET value = '"off"'::jsonb WHERE key = 'discord_player_dm';  (kun på ejerens kør)
-- Tænd:  UPDATE public.app_config SET value = '"on"'::jsonb WHERE key = 'discord_player_dm';
-- Rollback: DELETE FROM public.app_config WHERE key = 'discord_player_dm';  (manglende række = on)
--
-- Refs #8149

INSERT INTO public.app_config (key, value, description)
VALUES (
  'discord_player_dm',
  '"on"'::jsonb,
  'Master switch (on|off) for the Discord bot''s private messages to players (#8149). off stops sendDM, the DM outbox retries, the test DM and the 20:00 race digest. Channel webhooks, owner alerts and division roles are not affected.'
)
ON CONFLICT (key) DO NOTHING;
