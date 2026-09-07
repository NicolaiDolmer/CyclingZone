-- Rigtige flag-raekker for tre "building"-features der IKKE kunne flyttes til
-- state: dormant i registret (#4928/#4938), fordi de kun har en fravaers-baseret
-- fail-safe i koden (raekken findes ikke = off), ikke en eksplicit row (#4951).
--
-- COMMITTES SOM .sql. Idempotent (INSERT ... ON CONFLICT (key) DO NOTHING), saa
-- den kan koeres flere gange uden effekt. Applies post-merge under #2642-rammerne.
--
-- Ingen adfaerdsaendring: fail-safe (raekke mangler) og eksplicit "off" er
-- praecis samme tilstand for al laesende kode (featureStage.js/emailLoopFlag.js).
-- Alle fem raekker seedes/bekraeftes OFF.
--
--   race_engine_v4                 (#3855, backend/lib/raceEngineFlag.js)
--                                   ny raekke - flip planlagt 28/9, ejer-only.
--   race_day_development_enabled   (#4277, backend/lib/raceDayDevelopmentFlag.js)
--                                   raekken findes ALLEREDE i prod (value "off",
--                                   seedet af 2026-08-26-4277-race-day-development-
--                                   flag.sql) - INSERT'et her er en no-op, kun med
--                                   for at dokumentere de fem noegler eet sted.
--   email_loop_welcome/day1/race_digest
--                                   (#2853, backend/lib/emailLoopFlag.js)
--                                   tre nye raekker - dry-run/on-flip styres af
--                                   docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md, ejer-only.

INSERT INTO public.app_config (key, value, description) VALUES
  ('race_engine_v4', '"off"'::jsonb,
   'Loebsmotor v4 (#3855, #4707). off|beta|on ("beta" bruges ikke i praksis - en etape har eet udfald for alle spillere). off (default) = raceRunner bruger v3-scoring uaendret. Kraever race_engine_v3_scoring != off for at koere korrekt hvis den flippes. Flip er ejer-only, planlagt 28/9.'),
  ('race_day_development_enabled', '"off"'::jsonb,
   'Loebsdags-udvikling (#4277). No-op INSERT - raekken findes allerede i prod (seedet 2026-08-26). Medtaget her udelukkende saa alle fem #4951-noegler staar samlet eet sted.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_config (key, value, description) VALUES
  ('email_loop_welcome', '"off"'::jsonb,
   'Email-loop stage - welcome (#2853). off|dry_run|on. off (default) = cron-sweepet no-op''er helt, ingen email_log-raekke. Flip-rutine: docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md.'),
  ('email_loop_day1', '"off"'::jsonb,
   'Email-loop stage - day1 (#2853). off|dry_run|on. off (default) = cron-sweepet no-op''er helt. Flip-rutine: docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md.'),
  ('email_loop_race_digest', '"off"'::jsonb,
   'Email-loop stage - race_digest (#2853). off|dry_run|on. off (default) = cron-sweepet no-op''er helt. Flip-rutine: docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md.')
ON CONFLICT (key) DO NOTHING;
