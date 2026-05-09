-- 07d Fase A: Komplet finance audit-log + admin_log foundation
-- Sub-issue: #82 (Slice 07 Economy Overhaul)
--
-- ADDITIVT ONLY: ingen UPDATE/DELETE på eksisterende rows.
-- Spillere mærker intet — kun nye nullable kolonner + indices + CHECK på admin_log.action_type
-- (verificeret 2026-05-09: 0 eksisterende admin_log-rows ligger uden for action_type-listen,
--  finance_transactions har 69 rows, alle 'transfer_in'/'transfer_out', ingen audit-kolonne-population
--  fra cron endnu fordi sæson 1 ikke har lukket).
--
-- Bemærk: admin_log-tabellen + 2 RLS-policies eksisterede allerede pre-migration (oprettet ad-hoc
-- 2026-04-29). Master-planen [docs/slices/07-economy-overhaul-MASTER.md] CREATE TABLE er derfor
-- erstattet af ADD INDEX/CONSTRAINT-only her. 7d Fase B (07c-RPC + finance-audit-population) følger.
--
-- Rollback (testet idempotent):
--   DROP INDEX IF EXISTS idx_admin_log_user, idx_admin_log_action, idx_admin_log_target_team, idx_admin_log_created;
--   ALTER TABLE admin_log DROP CONSTRAINT IF EXISTS admin_log_action_type_check;
--   DROP INDEX IF EXISTS uniq_finance_idempotency_key, idx_finance_actor, idx_finance_reason, idx_finance_related;
--   ALTER TABLE finance_transactions DROP COLUMN IF EXISTS actor_type, DROP COLUMN IF EXISTS actor_id,
--     DROP COLUMN IF EXISTS source_path, DROP COLUMN IF EXISTS reason_code,
--     DROP COLUMN IF EXISTS before_balance, DROP COLUMN IF EXISTS after_balance,
--     DROP COLUMN IF EXISTS related_entity_type, DROP COLUMN IF EXISTS related_entity_id,
--     DROP COLUMN IF EXISTS idempotency_key;

-- ============================================================
-- 1. admin_log: indices + action_type CHECK constraint
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_admin_log_user
  ON admin_log(admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_log_action
  ON admin_log(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_log_target_team
  ON admin_log(target_team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_log_created
  ON admin_log(created_at DESC);

ALTER TABLE admin_log
  DROP CONSTRAINT IF EXISTS admin_log_action_type_check;

ALTER TABLE admin_log
  ADD CONSTRAINT admin_log_action_type_check CHECK (action_type IN (
    -- I brug i kode pr. 2026-05-09 (verificeret via grep + DB-distinct):
    'auction_cancel',
    'transfer_offer_admin_cancel',
    'swap_offer_admin_cancel',
    'loan_agreement_admin_cancel',
    'auction_config_update',
    'market_pause',
    'market_resume',
    'balance_adjustment',
    'user_deleted',
    'role_changed',
    'race_deleted',
    -- Reserveret til 07e/07f/07h og fremtidige admin-features:
    'race_results_imported',
    'race_results_approved',
    'beta_reset',
    'prize_force_paid',
    'season_repaired',
    'season_started',
    'season_ended',
    'discord_webhook_added',
    'discord_webhook_removed',
    'manual_override',
    'economy_export',
    'team_data_edited',
    'rider_data_edited'
  ));

-- ============================================================
-- 2. finance_transactions: 9 audit-kolonner (alle nullable, NULL-default)
-- ============================================================

ALTER TABLE finance_transactions
  ADD COLUMN IF NOT EXISTS actor_type TEXT,
  ADD COLUMN IF NOT EXISTS actor_id UUID,
  ADD COLUMN IF NOT EXISTS source_path TEXT,
  ADD COLUMN IF NOT EXISTS reason_code TEXT,
  ADD COLUMN IF NOT EXISTS before_balance BIGINT,
  ADD COLUMN IF NOT EXISTS after_balance BIGINT,
  ADD COLUMN IF NOT EXISTS related_entity_type TEXT,
  ADD COLUMN IF NOT EXISTS related_entity_id UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- CHECK-constraints adskilt fra ADD COLUMN for at understøtte IF NOT EXISTS-pattern
ALTER TABLE finance_transactions
  DROP CONSTRAINT IF EXISTS finance_transactions_actor_type_check;
ALTER TABLE finance_transactions
  ADD CONSTRAINT finance_transactions_actor_type_check
    CHECK (actor_type IS NULL OR actor_type IN ('cron','api','admin','system','migration'));

ALTER TABLE finance_transactions
  DROP CONSTRAINT IF EXISTS finance_transactions_related_entity_type_check;
ALTER TABLE finance_transactions
  ADD CONSTRAINT finance_transactions_related_entity_type_check
    CHECK (related_entity_type IS NULL OR related_entity_type IN
      ('auction','loan','transfer','swap','race','season','manual'));

-- ============================================================
-- 3. finance_transactions: indices til 07e dashboard-queries + idempotency
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uniq_finance_idempotency_key
  ON finance_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_actor
  ON finance_transactions(actor_type, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_reason
  ON finance_transactions(reason_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_related
  ON finance_transactions(related_entity_type, related_entity_id);
