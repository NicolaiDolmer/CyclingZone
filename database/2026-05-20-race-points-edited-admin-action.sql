-- #505 admin race_points editor: tilføj 'race_points_edited' til admin_log.action_type
-- ============================================================
-- Match til economyConstants.js ADMIN_ACTION_TYPE.RACE_POINTS_EDITED.
-- Replikerer mønstret fra database/2026-05-09-season-transition-admin-action.sql.
--
-- Idempotent: DROP IF EXISTS før ADD.
-- Rollback:   ALTER TABLE admin_log DROP CONSTRAINT admin_log_action_type_check;
--             og genindfør den gamle CHECK fra season-transition-admin-action.sql.

ALTER TABLE admin_log
  DROP CONSTRAINT IF EXISTS admin_log_action_type_check;

ALTER TABLE admin_log
  ADD CONSTRAINT admin_log_action_type_check CHECK (action_type IN (
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
    'rider_data_edited',
    'season_transition',
    'race_points_edited'  -- #505 (2026-05-20)
  ));
