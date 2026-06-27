// Canonical numbers for the /rules page (#1604).
//
// These mirror the backend single-source-of-truth constants. The frontend and
// backend are separate npm packages and cannot share an import at build time
// (same pattern as marketValues.js / expectedPrizeCalculator.js), so the values
// are duplicated here — but they are PINNED to the code constants by a drift
// guard: frontend/src/lib/rulesNumbers.test.js asserts every value below equals
// the corresponding export in backend/lib (economyConstants.js, marketUtils.js,
// academyFlag.js). If you change a constant in the backend, that test fails until
// you update this file, so the /rules page can't silently drift out of sync.
//
// Numbers that are admin-configurable at RUNTIME (auction window hours, emergency
// loan fee/interest from loan_config) are intentionally NOT pinned — they live in
// the database and can change per season. Those are presented as prose on the page
// and the literal values here are documented as "display defaults" only.

export const RULES_NUMBERS = {
  // --- Squad (backend/lib/marketUtils.js) ---
  squadCap: 30, // MAX_SQUAD_SIZE
  windowBuffer: 2, // TRANSFER_WINDOW_SOFT_CAP_BUFFER
  // --- Squad enforcement (backend/lib/squadEnforcement.js) ---
  squadFine: 100000, // SQUAD_FINE_AMOUNT
  squadPenaltyPoints: 200, // SQUAD_PENALTY_POINTS

  // --- Economy (backend/lib/economyConstants.js) ---
  startingBalance: 500000, // INITIAL_BALANCE (#1717)
  sponsorD1: 600000, // SPONSOR_INCOME_BY_DIVISION[1]
  sponsorD2: 400000, // SPONSOR_INCOME_BY_DIVISION[2]
  sponsorD3: 340000, // SPONSOR_INCOME_BY_DIVISION[3]
  sponsorCeilingS1: 720000, // FINAL_SPONSOR_PAYOUT_CEILING.S1
  sponsorCeilingS2: 900000, // FINAL_SPONSOR_PAYOUT_CEILING.S2_PLUS
  salaryRatePct: 6.7, // SALARY_RATE (0.067) × 100
  negativeInterestPct: 10, // NEGATIVE_BALANCE_INTEREST_RATE (0.10) × 100
  debtD1: 1200000, // DEBT_CEILING_BY_DIVISION[1]
  debtD2: 900000, // DEBT_CEILING_BY_DIVISION[2]
  debtD3: 600000, // DEBT_CEILING_BY_DIVISION[3]
  prizePerPoint: 75, // PRIZE_PER_POINT (#1816: 1500 → 75, ÷20)
  starValue: 8000000, // STAR_RIDER_MARKET_VALUE
  divisions: 4, // MAX_DIVISION - MIN_DIVISION + 1 (#1608 form-frys: 4-tier-pyramide)
  minDivision: 1, // MIN_DIVISION
  maxDivision: 4, // MAX_DIVISION (#1608 form-frys: tier 4 = bunden)
  divisionCapacity: 20, // DIVISION_CAPACITY
  firstPromotionSeason: 1, // FIRST_PROMOTION_RELEGATION_SEASON

  // --- Division bonus (backend/lib/economyEngine.js DIVISION_BONUSES) ---
  bonusD1P1: 300000,
  bonusD1P2: 200000,
  bonusD1P3: 100000,
  bonusD1P4: 50000,
  bonusD2P1: 150000,
  bonusD2P2: 100000,
  bonusD2P3: 50000,
  bonusD2P4: 25000,
  bonusD3P1: 75000,
  bonusD3P2: 50000,
  bonusD3P3: 25000,

  // --- Academy (backend/lib/academyFlag.js ACADEMY) ---
  academySlots: 8, // ACADEMY.SLOTS
  academyMinAge: 16, // ACADEMY.MIN_AGE
  academyMaxAge: 21, // ACADEMY.MAX_AGE
  academySalaryPct: 10, // ACADEMY.SALARY_RATE (0.10) × 100
  academyContractLength: 3, // ACADEMY.CONTRACT_LENGTH
  academyDrift: 5000, // ACADEMY.DRIFT_PER_SEASON

  // --- Admin-configurable display defaults (NOT pinned; from DB config) ---
  minBidStep: 1, // +1 CZ$ minimum step (auctionRules mirror)
  auctionActiveHours: 1, // default auction_config active hours (#1904: 6→1, window 08–24)
  auctionExtensionMinutes: 10, // default last-minute extension
};

// Keys whose values are admin-configurable at runtime and therefore deliberately
// excluded from the backend-equality drift guard.
export const RULES_NUMBERS_RUNTIME_CONFIG_KEYS = [
  "minBidStep",
  "auctionActiveHours",
  "auctionExtensionMinutes",
];
