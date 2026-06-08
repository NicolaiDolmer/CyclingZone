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

// Divisions-struktur. Div 1 = toppen (bedst), MAX_DIVISION = bunden.
// Centraliseret her (#962) så fyld-fra-toppen og op/nedrykning deler samme bounds.
export const MIN_DIVISION = 1;
export const MAX_DIVISION = 3;

// Mål-antal "rigtige" hold pr. division for fyld-fra-toppen (#962). Kun aktive,
// ikke-test menneske-hold tæller med — samme filter som ranglisten (AI, test og
// frosne hold ignoreres). Div 1..MAX_DIVISION-1 har hård cap; bund-divisionen
// (MAX_DIVISION) er overflow og må vokse forbi dette tal (blød cap), så der altid
// er plads til nye hold.
export const DIVISION_CAPACITY = 20;

// Første sæson-slut hvor op/nedrykninger må ske. Aktiveret 2026-05-21 for at give
// open-beta tid til at finde en sund langtids-fordeling af hold i divisioner før
// vi flytter rundt på dem. Med værdi 3 betyder det: sæson 1 og 2 slutter uden
// division-skifte; først når sæson 2 slutter (transition 2→3) sker oprykninger.
// Hævelse her kræver ingen migration — gate er ren applikationskode i
// economyEngine.processDivisionEnd.
export const FIRST_PROMOTION_RELEGATION_SEASON = 3;

// -- Saeson-skift kontrol-flags (#1155, ejer-beslutning 2026-06-08) ------------
// Tre bevidste produktbeslutninger for det foerste rigtige saeson-skift (S1->S2).
// Alle er rene applikationskode-gates (ingen migration) og taendes igen ved at
// saette true + deploy. Holdt som flags frem for slettet kode saa de er trivielle
// at genaktivere naar systemerne er klar.

// Saeson-transition skal vaere en BEVIDST manuel admin-handling -- aldrig en cron.
// Sat false efter at den automatiske cron 2026-05-21 fyrede 4 skift i traek
// (0->1->2->3->4). Vindue-luk, final whistle og squad-tjek forbliver automatiske;
// kun selve skiftet til ny saeson kraever nu et eksplicit admin-tryk.
export const SEASON_AUTO_TRANSITION_ENABLED = false;

// Rytter-vaerdi-genberegning (prize_earnings_bonus /3, #1156) ved saeson-slut.
// Slaaet fra indtil vaerdimodellen giver mening at koere ved transition (ejeren
// haandterer vaerdier separat indtil da). Naar true: processSeasonEnd kalder
// updateRiderValues som foer.
export const SEASON_VALUE_RECALC_ENABLED = false;

// Passiv rytterudvikling (#1137) ved saeson-start (kun saeson >= 2). Slaaet fra
// indtil progressions-systemet er faerdigbygget. Naar true: processSeasonStart
// koerer developRidersForSeason som foer.
export const SEASON_RIDER_PROGRESSION_ENABLED = false;

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
  RACE_EDITED: "race_edited",
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
  SEASON_TRANSITION: "season_transition",
  RACE_POINTS_EDITED: "race_points_edited",
  RACE_POINT_MODEL_EDITED: "race_point_model_edited",
  RACE_POINTS_REGENERATED: "race_points_regenerated",
  TEAM_FROZEN: "team_frozen",
  TEAM_UNFROZEN: "team_unfrozen",
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
