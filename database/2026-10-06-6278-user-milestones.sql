-- #6278 (del af #4321) · user_milestones: server-skrevne kerne-rejse-milepaele
-- (foerst `first_race_with_own_squad`), ADSKILT fra player_events.
--
-- Hvorfor ikke player_events: alle aktivitets- og retention-RPC'er
-- (get_sprint_metrics, get_cohort_retention, retention-scorecard v2 og
-- compute_growth_snapshot) laeser ENHVER player_events-raekke som brugeraktivitet
-- (DAU/WAU/MAU og kohorte-D1/D3/D7 via MAX(player_events.created_at)). Milepaelen
-- skrives af loebsfinaliseringen, ofte mens manageren er offline. Laa den i
-- player_events, ville en ny manager der aldrig kom tilbage taelle som returneret
-- paa D1/D7 naar holdets foerste loeb blev koert, og growth_snapshots ville gemme
-- de oppustede tal permanent. Her roerer den ingen af de RPC'er.
--
-- Raekkens betydning: (user_id, milestone) findes = brugeren har naaet milepaelen.
-- PRIMARY KEY er de-dup'en: to loeb der finaliseres samtidig for samme nye
-- manager giver én raekke (backend skriver med ON CONFLICT DO NOTHING).
--
-- ADDITIV OG IDEMPOTENT: CREATE TABLE IF NOT EXISTS, ingen eksisterende raekke
-- aendres, intet slettes. Applies post-merge af auto-migrate.yml (#2642).
-- DEPLOY-RAEKKEFOELGE: backend kan naa prod foer tabellen; den springer da
-- milepaelen stille over (42P01/PGRST205, ingen Sentry) til migrationen er koert.
--
-- RLS: enabled, INGEN policy, kun service_role (samme moenster som
-- race_entry_generator_runs). Klienten laeser/skriver aldrig tabellen.
--
-- FK'er: user_id -> auth.users ON DELETE CASCADE (som player_events);
-- team_id -> teams ON DELETE SET NULL (milepaelen tilhoerer brugeren, ikke holdet).
-- Ingen blokerende FK for betaReset.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT column_name, data_type FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='user_milestones' ORDER BY ordinal_position;
--   2. SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema='public' AND table_name='user_milestones';  -- kun service_role (+ postgres)
--   3. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_milestones'::regclass;  -- true
--
-- Rollback: DROP TABLE IF EXISTS public.user_milestones;
--
-- Refs #6278 #4321
-- data-api-access: {"table":"public.user_milestones","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Server-written analytics milestones; only the backend reads and writes them"}

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_milestones (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  milestone  text NOT NULL,
  team_id    uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, milestone)
);

CREATE INDEX IF NOT EXISTS user_milestones_milestone_created_at_idx
  ON public.user_milestones (milestone, created_at);

ALTER TABLE public.user_milestones ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_milestones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_milestones TO service_role;

COMMENT ON TABLE public.user_milestones IS
  '#6278: server-written core-journey milestones (first_race_with_own_squad), one row per (user, milestone). '
  'Deliberately NOT in player_events: activity/retention RPCs treat every player_events row as user activity. '
  'service_role only.';

COMMIT;
