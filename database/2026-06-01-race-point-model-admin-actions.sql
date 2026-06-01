-- R2 (#894): tilføj 'race_point_model_edited' + 'race_points_regenerated' til admin_log.action_type.
-- ============================================================
-- Matcher economyConstants.js ADMIN_ACTION_TYPE.RACE_POINT_MODEL_EDITED / RACE_POINTS_REGENERATED.
-- Bruges af PUT /api/admin/race-point-model/{master,factor} og POST .../generate.
-- Replikerer mønstret fra 2026-05-21-team-frozen-admin-action.sql.
--
-- Idempotent: DROP IF EXISTS før ADD.
-- Rollback:   ALTER TABLE admin_log DROP CONSTRAINT admin_log_action_type_check;
--             og genindfør den gamle CHECK fra team-frozen migration.

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
    'race_edited',
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
    'race_points_edited',
    'team_frozen',
    'team_unfrozen',
    'race_point_model_edited',   -- #894 (2026-06-01)
    'race_points_regenerated'    -- #894 (2026-06-01)
  ));
