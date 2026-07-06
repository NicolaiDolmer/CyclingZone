-- #2216 A4 — staff-evner (spejler rider_derived_abilities). Idempotent.
-- Staff-evne-profil persisteret ved ansættelse (facilityService.hireStaff):
--   overall + dimensions {physical,mental,technical} + levels {youth,junior,senior}
--   + role_skills (rolle-specifikke akser). Deterministisk afledt (staffAbilityDerivation.js).
-- Gated bag FACILITIES_ENABLED — tabellen er inert indtil staff faktisk kan ansættes.
-- RLS: authenticated må SELECT'e egne rækker (via team_staff→teams.user_id); skriv = service_role.
-- Rollback: DROP TABLE staff_derived_abilities.

BEGIN;

CREATE TABLE IF NOT EXISTS staff_derived_abilities (
  staff_id UUID PRIMARY KEY REFERENCES team_staff(id) ON DELETE CASCADE,
  overall SMALLINT NOT NULL CHECK (overall BETWEEN 1 AND 99),
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { physical, mental, technical } 1..99
  levels JSONB NOT NULL DEFAULT '{}'::jsonb,        -- { youth, junior, senior } 1..99
  role_skills JSONB NOT NULL DEFAULT '{}'::jsonb,   -- rolle-specifikke akser
  formula_version SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE staff_derived_abilities IS 'Deterministisk afledt staff-evne-profil pr. ansat (spejler rider_derived_abilities). Persisteret ved hire.';
COMMENT ON COLUMN staff_derived_abilities.dimensions IS '{ physical, mental, technical } coaching-dimensioner 1..99 (kun training-rollen udfyldt).';
COMMENT ON COLUMN staff_derived_abilities.levels IS '{ youth, junior, senior } niveau-affiniteter 1..99.';
COMMENT ON COLUMN staff_derived_abilities.role_skills IS 'Rolle-specifikke akser for ikke-training-roller (scouting/medical/academy/commercial).';

ALTER TABLE staff_derived_abilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_abilities_select_own ON staff_derived_abilities;
CREATE POLICY staff_abilities_select_own ON staff_derived_abilities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM team_staff s JOIN teams t ON t.id = s.team_id
                 WHERE s.id = staff_derived_abilities.staff_id AND t.user_id = (select auth.uid())));
GRANT SELECT ON staff_derived_abilities TO authenticated;
-- Skrivning: KUN service_role (backend). Ingen INSERT/UPDATE-policies til authenticated.

COMMIT;
