-- Daglig træning v1 (#1305) + form/træthed-spine (#1306, datamodel her)
-- Spec: docs/superpowers/specs/2026-06-11-kernesystemer-design.md afsnit 5-6
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + ON CONFLICT.
-- Politiknavne i citationstegn, drop-guard FØR create — følger projektkonventionen
-- (se 2026-06-04-race-engine-physiology-schema.sql og 2026-06-08-training-l2-teaser.sql).

-- ── rider_condition ───────────────────────────────────────────────────────────
-- Form/Træthed pr. rytter (0-100). Default: neutral form, frisk.
CREATE TABLE IF NOT EXISTS public.rider_condition (
  rider_id      UUID PRIMARY KEY REFERENCES public.riders(id) ON DELETE CASCADE,
  form          SMALLINT NOT NULL DEFAULT 50 CHECK (form BETWEEN 0 AND 100),
  fatigue       SMALLINT NOT NULL DEFAULT 0  CHECK (fatigue BETWEEN 0 AND 100),
  injured_until DATE,
  injury_cause  TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.rider_condition ENABLE ROW LEVEL SECURITY;

-- Læsning: alle autentificerede (stats er transparente per spec afsnit 1).
DROP POLICY IF EXISTS "rider_condition_select" ON public.rider_condition;
CREATE POLICY "rider_condition_select" ON public.rider_condition
  FOR SELECT TO authenticated USING (true);
-- Skrivning: kun service-role (ingen authenticated-policy for INSERT/UPDATE/DELETE).

COMMENT ON TABLE public.rider_condition IS
  'Daglig træning v1 (#1305 / #1306): form (0-100) + træthed (0-100) pr. rytter. '
  'Default: neutral form (50), frisk (0). Muteres af daglig-trænings-engine (service-role). '
  'Læsning = authenticated (transparente stats); skrivning = service-role only.';

-- ── training_day_runs ─────────────────────────────────────────────────────────
-- Én trænings-eksekvering pr. hold pr. dag (dansk dato). Idempotens-anker.
CREATE TABLE IF NOT EXISTS public.training_day_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  tick_date     DATE NOT NULL,
  executed_by   TEXT NOT NULL CHECK (executed_by IN ('manager', 'assistant')),
  bonus_applied BOOLEAN NOT NULL DEFAULT false,
  report        JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, tick_date)
);

CREATE INDEX IF NOT EXISTS idx_training_day_runs_team_date
  ON public.training_day_runs (team_id, tick_date DESC);

ALTER TABLE public.training_day_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_day_runs_select" ON public.training_day_runs;
CREATE POLICY "training_day_runs_select" ON public.training_day_runs
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM public.teams WHERE user_id = auth.uid()));

COMMENT ON TABLE public.training_day_runs IS
  'Daglig træning v1 (#1305): idempotens-anker — UNIQUE(team_id, tick_date) sikrer '
  'at hvert hold kun kører ét dagligt trænings-tick. executed_by skelner manager- '
  'vs. assistent-sweep (cron). report = JSONB-resume til frontend-visning.';

-- ── rider_derived_abilities: ability_progress ─────────────────────────────────
-- Progress-barer pr. evne (0..1 fraktion mod næste +1), samme mønster som ability_caps.
ALTER TABLE public.rider_derived_abilities
  ADD COLUMN IF NOT EXISTS ability_progress JSONB;

COMMENT ON COLUMN public.rider_derived_abilities.ability_progress IS
  'Daglig træning v1 (#1305): progress pr. evne (0.0..1.0 fraktion mod næste +1). '
  'Samme JSONB-mønster som ability_caps. Nulstilles ved ability-bump.';

-- ── app_config: feature-flag ──────────────────────────────────────────────────
-- Flag (samme mønster som race_engine_v2_enabled): OFF indtil relaunch-dagen.
INSERT INTO public.app_config (key, value, description)
  VALUES (
    'daily_training_enabled',
    'false'::jsonb,
    'When true, daily training tick runs for all human teams and form/fatigue mutations are active. Flip on relaunch day (#1305).'
  )
  ON CONFLICT (key) DO NOTHING;
