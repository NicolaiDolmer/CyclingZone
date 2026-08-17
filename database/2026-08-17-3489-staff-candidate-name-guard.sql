-- #3489/#3658 (kandidatflow-stramning FØR merge, ejer-godkendt 17/8, PR #3851) —
-- race-safe DB-guard mod at ansætte SAMME kandidat-navn ind i begge slots for
-- samme (team_id, role) samtidigt.
--
-- App-laget (backend/lib/facilityService.js hireStaff) udelukker allerede
-- holdets aktive staff-navne fra den regenererede kandidatpulje OG afviser
-- eksplicit med candidate_already_hired FØR insert (sekventiel guard). Denne
-- migration er andet lag: lukker den ægte samtidigheds-race hvor to hires
-- BEGGE læser "ingen aktiv med dette navn" FØR nogen skriver — samme mønster
-- som idx_team_staff_active_role_slot i database/2026-08-17-3489-staff-multi-slot.sql.
--
-- Backend-gate uændret: FACILITIES_ENABLED=false (facilityConstants.js) — denne
-- migration er inert for spillere indtil ejer-flip, præcis som fundament-migrationen.
-- Idempotent (IF NOT EXISTS). Rollback: DROP INDEX idx_team_staff_active_role_name.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_staff_active_role_name
  ON team_staff(team_id, role, name) WHERE status = 'active';

COMMENT ON INDEX idx_team_staff_active_role_name IS '#3489 kandidatflow-stramning: forhindrer at samme kandidat-navn ansættes i begge slots for (team_id, role) samtidigt. App-laget afviser allerede sekventielt via candidate_already_hired (facilityService.hireStaff); dette indeks lukker den ægte samtidigheds-race (23505 mappes til candidate_already_hired i facilityService.js, matchet på indeksnavnet i fejlbeskeden).';

COMMIT;
