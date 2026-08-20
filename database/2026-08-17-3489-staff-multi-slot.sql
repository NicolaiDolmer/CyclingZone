-- #3489 (flere spejdere/trænere samtidigt) — udvider team_staff fra 1 til op til
-- MAX_STAFF_SLOTS_PER_ROLE=2 samtidige AKTIVE staff pr. (team_id, role).
-- Slot-kolonnen erstatter den gamle "1 aktiv pr. rolle"-invariant fra
-- 2026-07-05-facilities-staff-foundation.sql (idx_team_staff_active_role) med en
-- (team_id, role, slot)-invariant: op til 2 forskellige personer kan nu være
-- ansat i samme rolle samtidig (fx en U23- og en senior-træner, eller to
-- spejdere med hver sin specialisering — specialiseringen er allerede afledt
-- pr. staff via staff_derived_abilities/topSpecialization, ingen ny kolonne
-- nødvendig for selve specialet).
--
-- Backend-gate uændret: FACILITIES_ENABLED=false (facilityConstants.js) — denne
-- migration er inert for spillere indtil ejer-flip, præcis som fundament-migrationen.
-- Idempotent (IF EXISTS/IF NOT EXISTS). Rollback: DROP INDEX
-- idx_team_staff_active_role_slot; genskab idx_team_staff_active_role (kræver
-- først at højst 1 aktiv staff pr. rolle findes igen); ALTER TABLE team_staff
-- DROP COLUMN slot.

BEGIN;

ALTER TABLE team_staff ADD COLUMN IF NOT EXISTS slot INTEGER NOT NULL DEFAULT 1;

-- Matcher MAX_STAFF_SLOTS_PER_ROLE i backend/lib/facilityConstants.js — hold de to
-- i sync hvis kapaciteten nogensinde ændres (kræver ny migration for CHECK'et).
ALTER TABLE team_staff DROP CONSTRAINT IF EXISTS team_staff_slot_check;
ALTER TABLE team_staff ADD CONSTRAINT team_staff_slot_check CHECK (slot BETWEEN 1 AND 2);

COMMENT ON COLUMN team_staff.slot IS '#3489: hvilken af de op til MAX_STAFF_SLOTS_PER_ROLE (2) samtidige aktive pladser i (team_id, role) denne staff-række optager. Eksisterende rækker forbliver slot=1 (default), uændret adfærd for hold med kun 1 aktiv staff pr. rolle.';

-- Erstat den gamle "1 aktiv pr. rolle"-invariant med en pr.-slot-invariant.
DROP INDEX IF EXISTS idx_team_staff_active_role;
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_staff_active_role_slot
  ON team_staff(team_id, role, slot) WHERE status = 'active';

COMMENT ON TABLE team_staff IS 'Navngivet staff (op til MAX_STAFF_SLOTS_PER_ROLE=2 aktive pr. rolle pr. hold, se slot). Sæsonløn = løbende sink pr. ansat. salary frosset ved ansættelse.';

COMMIT;
