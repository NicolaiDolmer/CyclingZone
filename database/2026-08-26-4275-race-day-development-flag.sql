-- Løbsdags-UDVIKLINGEN udskilt til eget flag (#4275).
--
-- COMMITTES SOM .sql. Idempotent (INSERT ... ON CONFLICT (key) DO NOTHING), så
-- den kan køres flere gange uden effekt. Applies post-merge under #2642-rammerne.
--
-- BAGGRUND. #3459 lagde fire ting bag race_day_engine_enabled:
--   D1  løbsdags-gaten (racende ryttere springer dagens pas over)
--   D2  løbet udvikler rytteren (~15 % af det erstattede pas, i etapens evner)
--   D3  recoveryBase 4→4.5, recoveryFraction 0.13→0.15
--   D4  AI-hold kører samme dailyTrainingEngine som menneskehold
--
-- Ejer-beslutning 26/8: D1+D2 skal SLUKKES for sæson 3 og først genindføres til
-- sæson 4 — modellen er ikke god nok endnu (enten-eller kom bag på spillerne,
-- træthed/udbytte føles skævt, og reglerne kunne ikke forklares). D3+D4 skal
-- BLIVE on: recovery-konstanterne er kalibreret mod hele populationens
-- træthedsfordeling (median 57 mod 67 med de gamle tal), og D4 er det eneste der
-- holder de 137 AI-hold i udvikling.
--
-- Med ét fælles flag var det umuligt at gøre det ene uden det andet. Derfor:
--   race_day_engine_enabled       → D3 + D4   (uændret, står 'on')
--   race_day_development_enabled  → D1 + D2   (nyt, seedes 'off')
--
-- Fail-safe: manglende række → off. Seeden nedenfor er derfor ops-synlighed, ikke
-- selve slukningen — koden er allerede slukket i det øjeblik den deployes.
--
-- Flip til sæson 4 (kør manuelt, ejer/orkestrator):
--   UPDATE public.app_config SET value = '"on"'::jsonb  WHERE key = 'race_day_development_enabled';
--   UPDATE public.app_config SET value = '"off"'::jsonb WHERE key = 'race_day_development_enabled';

INSERT INTO public.app_config (key, value, description) VALUES
  ('race_day_development_enabled', '"off"'::jsonb,
   'Løbsdags-udvikling (#4275, udskilt fra race_day_engine_enabled): D1 (løbsdage erstatter dagens træningspas) + D2 (løbet udvikler etapens evner, ~15% af det erstattede pas). off|beta|on. off (default) = sæson 2-adfærd: en racende rytter kører sit normale træningspas, og løbstræthed lægges oven i træningstrætheden. Slukket for S3 pr. ejer-beslutning 26/8; planlagt genindførsel til S4. D3 (recovery-konstanter) og D4 (AI-paritet) hænger fortsat på race_day_engine_enabled og er IKKE påvirket af dette flag.')
ON CONFLICT (key) DO NOTHING;
