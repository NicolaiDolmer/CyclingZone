-- Squad enforcement partial-failure recovery (#606)
-- ====================================================
--
-- Cron-audit 2026-05-24 P1-A: processSquadEnforcementCron satte
-- squad_enforcement_completed_at FØR per-team loop, så crash mid-loop
-- (Railway SIGTERM ved deploy, OOM, dropped DB-connection) efterlod claim
-- sat men halvdelen af teams ikke-enforced. Næste tick filtrerede windowet
-- ud → permanent state-leak (teams forblev outside squad-limits uden bøde).
--
-- Fix: split window-claim i to faser.
--   - squad_enforcement_started_at:   sat FØR loop (atomic claim mod 2-instans-race)
--   - squad_enforcement_completed_at: sat EFTER loop (alle teams done)
--
-- Recovery-semantik:
--   started_at NOT NULL AND completed_at IS NULL AND started_at < NOW() - 10 min
--   → tick re-claimer windowet (overwrite started_at = NOW()) og kører loopen igen
--   Per-team structural self-idempotency i enforceTeamSquadCompliance + per-team
--   idempotency_key på squad_violation_fine (squad_fine:${windowId}:${teamId})
--   sikrer at replay ikke double-fine'r.
--
-- Restrisiko (kendt + accepted): single-team mid-crash mellem purchase og fine
-- vil få team within_limits ved replay → ingen fine. ~50-200ms vindue per team.
-- Forward-guard: TODO + B-pattern reference i squadEnforcement.js.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS pattern.
--
-- Rollback:
--   ALTER TABLE transfer_windows DROP CONSTRAINT IF EXISTS transfer_windows_squad_enforcement_started_requires_closed;
--   ALTER TABLE transfer_windows DROP CONSTRAINT IF EXISTS transfer_windows_squad_enforcement_completed_requires_started;
--   ALTER TABLE transfer_windows DROP COLUMN IF EXISTS squad_enforcement_started_at;

-- 1. Started_at column
ALTER TABLE transfer_windows
  ADD COLUMN IF NOT EXISTS squad_enforcement_started_at TIMESTAMPTZ;

-- 2. Backfill: eksisterende windows med completed_at sat skal også have started_at
-- (= completed_at som rimeligt estimat — historisk fyrede claim-update'en disse samtidigt).
-- Uden backfill fejler completed_requires_started constraint på eksisterende rows.
UPDATE transfer_windows
  SET squad_enforcement_started_at = squad_enforcement_completed_at
  WHERE squad_enforcement_completed_at IS NOT NULL
    AND squad_enforcement_started_at IS NULL;

-- 3. Racing-window guard (samme mønster som final_whistle / completed_at).
ALTER TABLE transfer_windows
  DROP CONSTRAINT IF EXISTS transfer_windows_squad_enforcement_started_requires_closed;
ALTER TABLE transfer_windows
  ADD CONSTRAINT transfer_windows_squad_enforcement_started_requires_closed
    CHECK (squad_enforcement_started_at IS NULL OR closed_at IS NOT NULL);

-- 4. Completed kræver started (cannot complete what was never started).
ALTER TABLE transfer_windows
  DROP CONSTRAINT IF EXISTS transfer_windows_squad_enforcement_completed_requires_started;
ALTER TABLE transfer_windows
  ADD CONSTRAINT transfer_windows_squad_enforcement_completed_requires_started
    CHECK (squad_enforcement_completed_at IS NULL OR squad_enforcement_started_at IS NOT NULL);

COMMENT ON COLUMN transfer_windows.squad_enforcement_started_at IS
  'Atomic claim sat ved start af processSquadEnforcementCron loop. Lavt-niveau race-guard mod 2-instans-collision. Stale claims (>10min uden completed_at) overwrites for recovery. Indført 2026-05-24 (#606).';
COMMENT ON CONSTRAINT transfer_windows_squad_enforcement_started_requires_closed ON transfer_windows IS
  'Racing-windows (closed_at IS NULL) må aldrig få squad_enforcement_started_at sat. Konsistent med final_whistle/completed_at racing-guard fra 2026-05-21.';
COMMENT ON CONSTRAINT transfer_windows_squad_enforcement_completed_requires_started ON transfer_windows IS
  'Completed_at kræver started_at — sikrer at fase-rækkefølge er korrekt og at completed_at ikke kan sættes uden at have claim'et.';
