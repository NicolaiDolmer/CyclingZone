-- #3550 — ungdomspakken (løn-design-session 19/8, ejer-beslutning). Pull-baseret
-- akademi-intake: erstatter det løbende søndags-drip med et manager-udløst hent-
-- knap-flow (ét kuld pr. hold pr. uge). Idempotent (ON CONFLICT DO NOTHING) — kan
-- replayes uden at overskrive et flag ejeren allerede har flippet.
--
-- Genbruger EKSISTERENDE tabel academy_intake_ticks (team_id, tick_date PK, se
-- database/2026-07-19-sunday-intake-drip.sql) som claim-tabel for pull-mekanikken
-- (tick_date = ugens søndag i stedet for kørselsdagen) — ingen ny tabel.
--
-- EFTER APPLY: academy_intake_pull_enabled = "off" (uændret adfærd — søndags-
-- drippet (sundayIntakeTick.js) fortsætter automatisk indtil flaget flippes til
-- "on" i cutover-drejebogen 23/8, punkt 7).

INSERT INTO app_config (key, value, description)
VALUES
  ('academy_intake_pull_enabled', '"off"'::jsonb,
   '#3550 - pull-baseret akademi-intake (ét kuld/hold/uge, manager-hentet, søndags-drippet slukkes samtidig). off = uændret adfærd indtil cutover-flip 23/8.')
ON CONFLICT (key) DO NOTHING;
