-- Slice A bølge A1 (#1441 Fase 3, spec 2026-07-05-economy-fase3-empire-design.md §2.6).
-- Faciliteter (5 spor × tier 0-5) + navngivet staff (1 pr. spor) + finance-typer.
-- Gated bag FACILITIES_ENABLED=false i backend — tabellerne er inerte indtil A2/A3.
-- Idempotent. Rollback: DROP TABLE team_staff, team_facilities; re-declare CHECK uden de 4 nye typer.

BEGIN;

CREATE TABLE IF NOT EXISTS team_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  track TEXT NOT NULL CHECK (track IN ('training','scouting','medical','academy','commercial')),
  tier INTEGER NOT NULL DEFAULT 0 CHECK (tier BETWEEN 0 AND 5),
  purchased_season INTEGER,
  -- NB: updated_at vedligeholdes af app-koden (repo-konvention: ingen update-triggers) — backend-UPDATEs SKAL sætte den eksplicit.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, track)
);
COMMENT ON TABLE team_facilities IS 'Facilitets-tier pr. spor pr. hold (Slice A gold-sink). tier 0 = ikke bygget.';
COMMENT ON COLUMN team_facilities.purchased_season IS 'season_number for seneste tier-køb (audit/UI).';

CREATE TABLE IF NOT EXISTS team_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('training','scouting','medical','academy','commercial')),
  name TEXT NOT NULL,
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
  salary BIGINT NOT NULL CHECK (salary >= 0),
  hired_season INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','fired')),
  fired_season INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN team_staff.fired_season IS 'season_number hvor staff blev fyret (audit trail); NULL mens active.';
COMMENT ON TABLE team_staff IS 'Navngivet staff (1 aktiv pr. rolle pr. hold). Sæsonløn = løbende sink. salary frosset ved ansættelse.';
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_staff_active_role
  ON team_staff(team_id, role) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_team_staff_team_id ON team_staff(team_id);

-- Finance-typer (twin-guard mod #1463/#1465-fælden: type SKAL i CHECK'et i SAMME PR som koden).
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  'sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget',
  'loan_received','loan_repayment','loan_interest','emergency_loan','admin_adjustment',
  'auto_squad_purchase','auto_squad_sale','squad_violation_fine',
  'academy_signing','academy_drift','upkeep','forced_debt_sale',
  'facility_purchase','facility_upkeep','staff_salary','staff_severance'
));

-- RLS: authenticated må SELECT'e egne rækker (mønster: database/2026-05-11-player-events.sql).
ALTER TABLE team_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_facilities_owner_select ON team_facilities;
CREATE POLICY team_facilities_owner_select ON team_facilities FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = (select auth.uid())));
DROP POLICY IF EXISTS team_staff_owner_select ON team_staff;
CREATE POLICY team_staff_owner_select ON team_staff FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = (select auth.uid())));
GRANT SELECT ON team_facilities TO authenticated;
GRANT SELECT ON team_staff TO authenticated;
-- Skrivning: KUN service_role (backend). Ingen INSERT/UPDATE-policies til authenticated.

COMMIT;
