-- [epic #4592 del 3] "Tilmeld dig næste sæson"-knap (#452, ejer-design 2/9).
--
-- teams.next_season_signup_at: sættes af POST /api/season/signup når en
-- manager bekræfter at hun vil beholde sin plads til næste sæson. Ryddes
-- IKKE automatisk af denne migration eller af backend endnu — det er en
-- fast-follow når transition-engine-respekten (#4592 del 3, sidste punkt)
-- bygges, som en del af selve cutover-flowet.
--
-- app_config-nøglen season_signup_enabled styrer BÅDE dette endpoint OG
-- parkerings-forberedelsen (managerParking.js, del 2) — se
-- backend/lib/seasonSignupFlag.js. Seedes 'off': fail-safe = ingen ændring.
--
-- Idempotent. Applies af Claude POST-merge under #2642-rammerne.
--
-- Post-verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'teams' AND column_name = 'next_season_signup_at';
--   SELECT key, value FROM public.app_config WHERE key = 'season_signup_enabled';

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS next_season_signup_at timestamptz;

INSERT INTO public.app_config (key, value, description) VALUES
  ('season_signup_enabled', '"off"'::jsonb,
   '[epic #4592 del 3] Fælles gate for "Tilmeld dig næste sæson"-knappen (#452, dashboard-kort + POST /api/season/signup) OG parkerings-forberedelsen ved sæsonskifte-cutover (managerParking.js, del 2). off|beta|on. off (default) = ingen ændring: knappen er skjult, og cutoveren parkerer ingen hold. Flippes først efter ejeren har godkendt S3-dry-run-parkeringslisten (#4592-checkliste).')
ON CONFLICT (key) DO NOTHING;
