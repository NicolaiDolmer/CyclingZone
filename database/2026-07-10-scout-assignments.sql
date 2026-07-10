-- Talentspejder Fase 3 (#2244): job-model. Afløser slots-modellen (scout_actions bevares som rapport-ledger).
CREATE TABLE IF NOT EXISTS scout_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES team_staff(id) ON DELETE SET NULL, -- NULL = default-spejder
  kind TEXT NOT NULL CHECK (kind IN ('target','mission')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  -- target-jobs
  rider_id UUID REFERENCES riders(id) ON DELETE CASCADE,
  target_level SMALLINT CHECK (target_level BETWEEN 1 AND 3),
  -- missions
  mission_criteria JSONB, -- {scope:'division'|'country'|'u23'|'nm', value:...}
  -- fælles
  travel_cost BIGINT NOT NULL DEFAULT 0,
  started_on DATE NOT NULL,
  ready_on DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  result JSONB, -- mission: {shortlist:[rider_id,...], top_rider_id}; target: {level}
  season_id UUID REFERENCES seasons(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scout_assignments_target_shape CHECK (
    (kind = 'target' AND rider_id IS NOT NULL AND target_level IS NOT NULL)
    OR (kind = 'mission' AND mission_criteria IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_scout_assignments_team_active
  ON scout_assignments (team_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_scout_assignments_ready
  ON scout_assignments (ready_on) WHERE status = 'active';

ALTER TABLE scout_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY scout_assignments_owner_select ON scout_assignments
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
-- Alle writes = service_role (ingen insert/update-policy for authenticated).

-- Twin-guard: ny finance-type i SAMME migration som koden der bruger den.
-- Listen kopieret uændret fra database/2026-07-05-facilities-staff-foundation.sql (nyeste CHECK pr. 2026-07-10) + tilføjet 'scout_travel'.
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  'sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget',
  'loan_received','loan_repayment','loan_interest','emergency_loan','admin_adjustment',
  'auto_squad_purchase','auto_squad_sale','squad_violation_fine',
  'academy_signing','academy_drift','upkeep','forced_debt_sale',
  'facility_purchase','facility_upkeep','staff_salary','staff_severance',
  'scout_travel'
));

-- Sweep-dedup (mirror af training_day_runs)
CREATE TABLE IF NOT EXISTS scout_sweep_runs (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tick_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, tick_date)
);
ALTER TABLE scout_sweep_runs ENABLE ROW LEVEL SECURITY;
