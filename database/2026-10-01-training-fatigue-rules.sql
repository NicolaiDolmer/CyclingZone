-- #4854 + #5620 — spillerens egne traeningsregler: traethedsgraense (holdregel +
-- undtagelse pr. rytter) og "dagen efter en etape: foerste felt = restitution".
-- Spec: docs/superpowers/specs/2026-09-29-traen-nu-og-prognose-design.md beslutning 5.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
-- Applies post-merge (auto-migrate.yml, #2642). Indtil da svarer motoren og
-- API'et som om ingen hold har regler (42P01/PGRST205 → ingen regler).
--
-- G7: default er SLUKKET. Et hold uden raekke her har ingen automatik. Kun
-- spillerens eget klik opretter en raekke.
--
-- Raekkens betydning:
--   rider_id NULL  = holdreglen (hoejst én pr. hold).
--   rider_id sat   = undtagelse for én rytter (hoejst én pr. hold+rytter).
--   fatigue_threshold + fallback: "over denne traethed: koer <fallback> i stedet".
--     Begge NULL paa holdet  = ingen traethedsgraense.
--     Begge NULL paa rytteren = foelg holdet.
--     fallback 'off' (kun rytter, uden graense) = ingen graense for denne rytter.
--   recovery_after_stage: NULL paa rytteren = foelg holdet.

CREATE TABLE IF NOT EXISTS public.team_training_rules (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  rider_id             uuid NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  fatigue_threshold    integer NULL CHECK (fatigue_threshold BETWEEN 0 AND 100),
  fallback             text NULL CHECK (fallback IN ('light', 'recovery', 'rest', 'off')),
  recovery_after_stage boolean NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Graense og erstatning hoerer sammen; 'off' kun som rytter-undtagelse uden graense.
  CONSTRAINT team_training_rules_pair CHECK (
    (fallback IS NULL AND fatigue_threshold IS NULL)
    OR (fallback IN ('light', 'recovery', 'rest') AND fatigue_threshold IS NOT NULL)
    OR (fallback = 'off' AND fatigue_threshold IS NULL AND rider_id IS NOT NULL)
  )
);

-- To partielle unikke index (samme moenster som training_week_plans): NULL ≠ NULL
-- i en almindelig UNIQUE ville tillade flere holdregler.
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_training_rules_team_only
  ON public.team_training_rules (team_id) WHERE rider_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_training_rules_team_rider
  ON public.team_training_rules (team_id, rider_id) WHERE rider_id IS NOT NULL;
-- FK-index paa rider_id (cascade-sletning af en rytter).
CREATE INDEX IF NOT EXISTS idx_team_training_rules_rider
  ON public.team_training_rules (rider_id) WHERE rider_id IS NOT NULL;

COMMENT ON TABLE public.team_training_rules IS
  'Player-set training rules (#4854/#5620): fatigue limit (team rule + per-rider exception) and recovery on the first slot the day after a stage. Never changes the training plan; the engine swaps only the session that runs. No row = no automation (G7).';

-- RLS: et hold ser/skriver kun egne regler. Backend bruger service-role; policy'erne
-- holder direkte klient-adgang sikker. initplan-form ((SELECT auth.uid())), én
-- permissive policy pr. kommando (#2677).
ALTER TABLE public.team_training_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_training_rules_own_select ON public.team_training_rules;
CREATE POLICY team_training_rules_own_select ON public.team_training_rules
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS team_training_rules_own_insert ON public.team_training_rules;
CREATE POLICY team_training_rules_own_insert ON public.team_training_rules
  FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS team_training_rules_own_update ON public.team_training_rules;
CREATE POLICY team_training_rules_own_update ON public.team_training_rules
  FOR UPDATE TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())))
  WITH CHECK (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS team_training_rules_own_delete ON public.team_training_rules;
CREATE POLICY team_training_rules_own_delete ON public.team_training_rules
  FOR DELETE TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

REVOKE ALL ON public.team_training_rules FROM anon;

-- Stadie-flaget oprettes i 'beta' (moenster: 2026-09-26-4629-training-programs.sql).
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.
-- Flip til 'on' er ejer-only.
INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_fatigue_rules',
  '"beta"'::jsonb,
  'Stage flag (off|beta|on) for player-set training rules (#4854/#5620): fatigue limit with team rule + per-rider exception, and recovery on the first slot the day after a stage. beta = beta testers see and set rules, and the engine applies rules only for teams whose owner is a beta tester. off = no rule is applied.'
)
ON CONFLICT (key) DO NOTHING;
