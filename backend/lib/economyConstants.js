// Single source of truth for økonomi-konstanter brugt på tværs af engines.
// Alle værdier matcher database/schema.sql defaults eller landed migrations.
// Ændring her kræver tilsvarende migration mod prod (se docs/CONVENTIONS.md).

// teams.sponsor_income DEFAULT i database/schema.sql + 2026-04-25-economy-retuning.sql.
export const SPONSOR_INCOME_BASE = 240000;

// teams.balance DEFAULT i database/schema.sql + 2026-04-25-economy-retuning.sql.
// Også brugt som DEFAULT_BETA_BALANCE i betaResetService.js.
export const INITIAL_BALANCE = 800000;

// riders.value = uci_points × MARKET_VALUE_MULTIPLIER (forudsat uci_points ≥ MIN_UCI_POINTS_FOR_VALUE).
// Locked 2026-04-25 i economy-scale-4000x.sql.
export const MARKET_VALUE_MULTIPLIER = 4000;
export const MIN_UCI_POINTS_FOR_VALUE = 5;

// Præmie per UCI-point ved race-import (prizePayoutEngine).
export const PRIZE_PER_POINT = 1500;

// Rente på negativ balance ved sæsonslut.
export const NEGATIVE_BALANCE_INTEREST_RATE = 0.10;

// Loan debt-loft per division (loan_config-tabel + 2026-04-30-economy-light-tune-v176.sql).
// Bruges som soft-tjek; loan_config er kanonisk runtime-værdi.
export const DEBT_CEILING_BY_DIVISION = { 1: 1200000, 2: 900000, 3: 600000 };

// SALARY_RATE = 0.10 lever i database/2026-05-04-salary-generated-column.sql som
// GENERATED-formel og kan ikke skrives fra applikationskode. Defineret her som info-only.
export const SALARY_RATE_INFO = 0.10;

// ============================================================
// 07d Fase A: audit-trail enums.
// MUST matche database/2026-05-09-audit-log-foundation.sql CHECK constraints.
// Tilføjelse her uden migration → INSERT fejler på prod.
// ============================================================

// admin_log.action_type — alle ad-hoc admin-handlinger der skal være sporbare.
export const ADMIN_ACTION_TYPE = Object.freeze({
  AUCTION_CANCEL: "auction_cancel",
  TRANSFER_OFFER_ADMIN_CANCEL: "transfer_offer_admin_cancel",
  SWAP_OFFER_ADMIN_CANCEL: "swap_offer_admin_cancel",
  LOAN_AGREEMENT_ADMIN_CANCEL: "loan_agreement_admin_cancel",
  AUCTION_CONFIG_UPDATE: "auction_config_update",
  MARKET_PAUSE: "market_pause",
  MARKET_RESUME: "market_resume",
  BALANCE_ADJUSTMENT: "balance_adjustment",
  USER_DELETED: "user_deleted",
  ROLE_CHANGED: "role_changed",
  RACE_DELETED: "race_deleted",
  RACE_RESULTS_IMPORTED: "race_results_imported",
  RACE_RESULTS_APPROVED: "race_results_approved",
  BETA_RESET: "beta_reset",
  PRIZE_FORCE_PAID: "prize_force_paid",
  SEASON_REPAIRED: "season_repaired",
  SEASON_STARTED: "season_started",
  SEASON_ENDED: "season_ended",
  DISCORD_WEBHOOK_ADDED: "discord_webhook_added",
  DISCORD_WEBHOOK_REMOVED: "discord_webhook_removed",
  MANUAL_OVERRIDE: "manual_override",
  ECONOMY_EXPORT: "economy_export",
  TEAM_DATA_EDITED: "team_data_edited",
  RIDER_DATA_EDITED: "rider_data_edited",
});

// finance_transactions.actor_type — hvem genererede pengebevægelsen.
export const FINANCE_ACTOR_TYPE = Object.freeze({
  CRON: "cron",
  API: "api",
  ADMIN: "admin",
  SYSTEM: "system",
  MIGRATION: "migration",
});

// finance_transactions.related_entity_type — hvad pengene er knyttet til.
export const FINANCE_RELATED_ENTITY = Object.freeze({
  AUCTION: "auction",
  LOAN: "loan",
  TRANSFER: "transfer",
  SWAP: "swap",
  RACE: "race",
  SEASON: "season",
  MANUAL: "manual",
});

// finance_transactions.reason_code — hvorfor pengene flyttede.
// Klar til 07d Fase B / 07c-RPC der populerer audit-kolonner i alle 16 write-paths.
export const FINANCE_REASON = Object.freeze({
  // Sæson-baserede payouts (cron)
  SEASON_START_SPONSOR: "season_start_sponsor",
  SEASON_END_SALARY: "season_end_salary",
  SEASON_END_DIVISION_BONUS: "season_end_division_bonus",
  SEASON_END_NEGATIVE_INTEREST: "season_end_negative_interest",
  SEASON_END_LOAN_INTEREST: "season_end_loan_interest",
  STARTING_BUDGET: "starting_budget",
  // Race-baserede payouts
  RACE_PRIZE_PAYOUT: "race_prize_payout",
  // Auctions
  AUCTION_WINNER_PAYMENT: "auction_winner_payment",
  AUCTION_SELLER_PAYOUT: "auction_seller_payout",
  AUCTION_GUARANTEED_BANK_SALE: "auction_guaranteed_bank_sale",
  // Transfers
  TRANSFER_PURCHASE: "transfer_purchase",
  TRANSFER_SALE: "transfer_sale",
  SWAP_CASH_DELTA: "swap_cash_delta",
  // Lejeaftaler
  LOAN_FEE_PAID: "loan_fee_paid",
  LOAN_FEE_RECEIVED: "loan_fee_received",
  LOAN_FEE_REFUNDED: "loan_fee_refunded",
  // Lån (debt)
  LOAN_PRINCIPAL_RECEIVED: "loan_principal_received",
  LOAN_REPAYMENT: "loan_repayment",
  LOAN_BUYOUT: "loan_buyout",
  LOAN_ORIGINATION_FEE: "loan_origination_fee",
  EMERGENCY_LOAN_RECEIVED: "emergency_loan_received",
  // Squad-enforcement (cron — window-close)
  SQUAD_AUTO_PURCHASE: "squad_auto_purchase",
  SQUAD_AUTO_SALE: "squad_auto_sale",
  SQUAD_VIOLATION_FINE: "squad_violation_fine",
  // Board (manager-initieret bonus-tilbud)
  BOARD_BONUS_ACCEPTED: "board_bonus_accepted",
  // Admin
  ADMIN_BALANCE_ADJUSTMENT: "admin_balance_adjustment",
  ADMIN_FORCE_PRIZE: "admin_force_prize",
  ADMIN_BETA_RESET: "admin_beta_reset",
});
