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
