-- #5259: tilfoej 'beta_tester_changed' + 'feature_flag_changed' til
-- admin_log.action_type.
-- ============================================================
-- De to nye admin-handlinger i #5259 skal have samme revisionsspor som
-- 'role_changed' — ellers fejler INSERTet tavst paa constrainten (samme
-- fejlklasse som #5112).
--
-- Basislisten er kopieret uaendret fra
-- 2026-09-13-5112-admin-log-retirement-notice-freeze.sql (seneste
-- redefinition). NB: 'retirement_notice_freeze' findes i den liste men mangler
-- stadig i ADMIN_ACTION_TYPE (backend/lib/economyConstants.js) — den drift er
-- IKKE rettet her, kun baaret uaendret videre, saa denne migration ikke
-- stiltiende laaser en kode-aendring der hoerer til #5112.
--
-- Idempotent: DROP IF EXISTS foer ADD.
-- Rollback:   genindfoer 2026-09-13-listen uden de to nye vaerdier.

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
    'retirement_notice_freeze',   -- #5112 (2026-09-13)
    'beta_tester_changed',        -- #5259 (2026-09-18)
    'feature_flag_changed'        -- #5259 (2026-09-18)
  ));

-- Post-verify (koer efter apply):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'admin_log_action_type_check';
--   Forventet: listen indeholder 'beta_tester_changed' og 'feature_flag_changed'.
