-- S-02a · Foundation: sekventiel forhandling + sæson-1-baseline
-- Master roadmap: docs/slices/02-board-redesign-MASTER.md
--
-- Tilføjer:
--   1. board_profiles.plan_type = 'baseline' (ny værdi for sæson 1's tomme observations-profil)
--   2. board_profiles.is_baseline (eksplicit flag — sikrer skip i evaluering)
--   3. transfer_windows.board_negotiation_state (global onboarding-fase-lås)
--
-- Q-batch 1A Q6 (full reset): eksisterende managers' planer slettes via betaResetService
-- og erstattes af én baseline-row pr. team. Migration ændrer kun schema; data-flush sker via beta-reset.

BEGIN;

-- 1. Udvid board_profiles.plan_type CHECK med 'baseline'
ALTER TABLE board_profiles
  DROP CONSTRAINT IF EXISTS board_profiles_plan_type_check;

ALTER TABLE board_profiles
  ADD CONSTRAINT board_profiles_plan_type_check
  CHECK (plan_type IN ('1yr', '3yr', '5yr', 'baseline'));

-- 2. board_profiles.is_baseline — eksplicit flag for skip i processTeamSeasonEnd
ALTER TABLE board_profiles
  ADD COLUMN IF NOT EXISTS is_baseline BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. transfer_windows.board_negotiation_state — global onboarding-fase
--    'locked'        = sæson 1 baseline (wizard disabled for alle)
--    'pending_5yr'   = sæson 2 onboarding åbnet, managers signer 5yr først
--    'pending_3yr'   = (samme — per-team-progression styres af row-eksistens i board_profiles)
--    'pending_1yr'   = (samme)
--    'complete'      = onboarding færdig, normal renew-flow
--
--    Per-team-fremdrift udledes af board_profiles-rows (allerede live i api.js:3093 PLAN_SEQUENCE.find).
--    Window-state er kun en global "fase-lås" — ikke per-team-tracker.
ALTER TABLE transfer_windows
  ADD COLUMN IF NOT EXISTS board_negotiation_state TEXT NOT NULL DEFAULT 'locked';

ALTER TABLE transfer_windows
  DROP CONSTRAINT IF EXISTS transfer_windows_board_negotiation_state_check;

ALTER TABLE transfer_windows
  ADD CONSTRAINT transfer_windows_board_negotiation_state_check
  CHECK (board_negotiation_state IN ('locked', 'pending_5yr', 'pending_3yr', 'pending_1yr', 'complete'));

COMMIT;
