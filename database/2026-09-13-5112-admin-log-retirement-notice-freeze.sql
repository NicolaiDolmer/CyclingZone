-- #5112 (kommentar 10/9): tilføj 'retirement_notice_freeze' til admin_log.action_type.
-- ============================================================
-- scripts/ops/retirement-notice-freeze-5073.mjs:343 fik constraint-fejl under
-- den ellers vellykkede #5073-koersel (froes pensionsvarslet for saeson N) -
-- action_type-vaerdien 'retirement_notice_freeze' mangler i CHECK-constrainten.
-- Basislisten er kopieret uaendret fra 2026-06-01-race-point-model-admin-actions.sql
-- (seneste redefinition; matcher ADMIN_ACTION_TYPE i backend/lib/economyConstants.js).
--
-- Idempotent: DROP IF EXISTS foer ADD.
-- Rollback:   ALTER TABLE admin_log DROP CONSTRAINT admin_log_action_type_check;
--             og genindfoer 2026-06-01-listen uden 'retirement_notice_freeze'.

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
    'race_point_model_edited',
    'race_points_regenerated',
    'retirement_notice_freeze'   -- #5112 (2026-09-13)
  ));
