-- Board test-mode: åbn bestyrelsen for test med frosset økonomi (#805)
-- ====================================================================
--
-- Board-feature ("bestyrelsen") er fuldt bygget men skjult: sæson 1's
-- transfer_window står board_negotiation_state='locked', hvilket via én
-- boolean (isBaselinePhase i api.js) BÅDE skjuler UI'et OG fryser økonomien.
--
-- Denne kolonne kløver de to: aktivering sætter window-state til 'pending_5yr'
-- (genåbner UI + crons via den eksisterende onboarding-sti) MENS board_test_mode
-- udelukkende styrer ØKONOMI-neutralisering:
--   - Lag 1 sponsor-modifier (processSeasonStart)      → tvunget 1.0
--   - Lag 4 tvangssalg (evaluateAndApplyConsequences)   → feedback vises, salg udføres ikke
--   - Lag 5 sponsor-pullout (-10%)                       → oprettes ikke (effektiv 1.0)
--   - Lag 6 bonus +200K (acceptBonusOffer)              → ingen finance_transactions-kreditering
-- Lag 2-3 hard-blocks (salary cap / signing restriction) håndhæves bevidst FULDT (B2).
--
-- Invariant: 0 board-relaterede finance_transactions + effektiv sponsor-modifier=1.0
-- i hele test-perioden. Test-mode gælder kun den aktive sæson; ryddes ved sæson-skift.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
--
-- Rollback:
--   ALTER TABLE transfer_windows DROP COLUMN IF EXISTS board_test_mode;

BEGIN;

ALTER TABLE transfer_windows
  ADD COLUMN IF NOT EXISTS board_test_mode BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN transfer_windows.board_test_mode IS
  'Når true: board-UI + crons kører (via board_negotiation_state), men økonomi-laget '
  'neutraliseres (sponsor-modifier tvunget 1.0, ingen board-finance_transactions, '
  'tvangssalg/pullout suppress). Gælder kun aktiv sæson; ryddes ved sæson-skift. Indført 2026-05-30 (#805).';

COMMIT;
