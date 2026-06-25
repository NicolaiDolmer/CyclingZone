-- Race Hub S3 (Fase 2 Holdstrategi): stående præferencer der fodrer den proaktive
-- entry-generator. RLS-mønster spejler scouting-l1 (eget-team-read, service_role-write).
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS før CREATE.
-- schema_migrations-insert håndteres af .github/workflows/auto-migrate.yml.

CREATE TABLE IF NOT EXISTS public.team_race_strategy (
  team_id            UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  a_chain            JSONB NOT NULL DEFAULT '[]'::jsonb,
  captain_priorities JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_race_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_rider_role_rules (
  team_id   UUID NOT NULL REFERENCES public.teams(id)  ON DELETE CASCADE,
  rider_id  UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  role_rule TEXT NOT NULL CHECK (role_rule IN ('always_captain','always_sprint_captain_if_present')),
  PRIMARY KEY (team_id, rider_id)
);
CREATE INDEX IF NOT EXISTS idx_team_rider_role_rules_team ON public.team_rider_role_rules(team_id);

ALTER TABLE public.team_race_strategy    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_rider_role_rules ENABLE ROW LEVEL SECURITY;

-- Læs: kun eget team (player-facing strategi-redigering). Skriv: service_role (backend).
DROP POLICY IF EXISTS "team_race_strategy_select_own" ON public.team_race_strategy;
CREATE POLICY "team_race_strategy_select_own" ON public.team_race_strategy
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM public.teams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "team_rider_role_rules_select_own" ON public.team_rider_role_rules;
CREATE POLICY "team_rider_role_rules_select_own" ON public.team_rider_role_rules
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM public.teams WHERE user_id = auth.uid()));

GRANT SELECT ON public.team_race_strategy    TO authenticated;
GRANT SELECT ON public.team_rider_role_rules TO authenticated;

COMMENT ON TABLE public.team_race_strategy IS
  'Race Hub S3: holdets stående strategi (A-kæde, kaptajn-prioriteter pr. terræn-bucket, mål-løb). Fodrer raceEntryGenerator. Read=eget team, write=service_role.';
COMMENT ON TABLE public.team_rider_role_rules IS
  'Race Hub S3: faste rolle-regler pr. rytter (always_captain / always_sprint_captain_if_present). Read=eget team, write=service_role.';
