-- Sæson-loop-incident 2026-05-21 forward-guard på DB-niveau
-- ============================================================
--
-- Cron-loopen kunne kun ske fordi de tre crons (deadlineDay, squad-enforcement,
-- season auto-transition) kunne sætte timestamps på et "racing-window" (status='closed'
-- men closed_at=null). Selv om kode-fixet i v3.86 sikrer at de tre eksisterende crons
-- filtrerer racing-windows ud, gør denne CHECK constraint det STRUKTURELT umuligt
-- at lave en lignende bug i fremtiden — uanset om en ny cron tilføjes eller en
-- eksisterende ændres.
--
-- Invariant:
--   final_whistle_sent_at og squad_enforcement_completed_at må KUN være sat hvis
--   closed_at også er sat. Racing-vinduer (closed_at IS NULL) kan derfor aldrig
--   nogensinde få disse felter populeret af et bug.
--
-- Idempotent: ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS pattern via separate
-- DROP + ADD.
--
-- Rollback:
--   ALTER TABLE transfer_windows DROP CONSTRAINT IF EXISTS transfer_windows_final_whistle_requires_closed;
--   ALTER TABLE transfer_windows DROP CONSTRAINT IF EXISTS transfer_windows_squad_enforcement_requires_closed;

-- 1. final_whistle_sent_at kræver closed_at IS NOT NULL
ALTER TABLE transfer_windows
  DROP CONSTRAINT IF EXISTS transfer_windows_final_whistle_requires_closed;
ALTER TABLE transfer_windows
  ADD CONSTRAINT transfer_windows_final_whistle_requires_closed
    CHECK (final_whistle_sent_at IS NULL OR closed_at IS NOT NULL);

-- 2. squad_enforcement_completed_at kræver closed_at IS NOT NULL
ALTER TABLE transfer_windows
  DROP CONSTRAINT IF EXISTS transfer_windows_squad_enforcement_requires_closed;
ALTER TABLE transfer_windows
  ADD CONSTRAINT transfer_windows_squad_enforcement_requires_closed
    CHECK (squad_enforcement_completed_at IS NULL OR closed_at IS NOT NULL);

COMMENT ON CONSTRAINT transfer_windows_final_whistle_requires_closed ON transfer_windows IS
  'Racing-windows (closed_at IS NULL) må aldrig få final_whistle_sent_at sat. Forward-guard mod sæson-loop-bug 2026-05-21.';
COMMENT ON CONSTRAINT transfer_windows_squad_enforcement_requires_closed ON transfer_windows IS
  'Racing-windows (closed_at IS NULL) må aldrig få squad_enforcement_completed_at sat. Forward-guard mod sæson-loop-bug 2026-05-21.';
