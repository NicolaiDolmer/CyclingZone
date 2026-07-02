// Drift guard for the /rules page numbers (#1604).
//
// The frontend and backend are separate npm packages and can't share a build-time
// import, so lib/rulesNumbers.js duplicates the economy constants. This test pins
// every PINNED value to the backend single-source-of-truth modules (same git repo,
// importable from a node --test). If a backend constant changes, this fails until
// rulesNumbers.js is updated — so the /rules page can't silently drift, exactly the
// failure mode docs/GAME_INVARIANTS.md warns about.
//
// Runtime-configurable values (auction window hours, min-bid step) live in the DB
// and are intentionally NOT asserted here — they're listed in
// RULES_NUMBERS_RUNTIME_CONFIG_KEYS and presented as prose on the page.

import { test } from "node:test";
import assert from "node:assert/strict";

import { RULES_NUMBERS, RULES_NUMBERS_RUNTIME_CONFIG_KEYS } from "./rulesNumbers.js";
import {
  INITIAL_BALANCE,
  SPONSOR_INCOME_BY_DIVISION,
  FINAL_SPONSOR_PAYOUT_CEILING,
  SALARY_RATE,
  NEGATIVE_BALANCE_INTEREST_RATE,
  DEBT_CEILING_BY_DIVISION,
  PRIZE_PER_POINT,
  STAR_RIDER_MARKET_VALUE,
  MIN_DIVISION,
  MAX_DIVISION,
  DIVISION_CAPACITY,
  FIRST_PROMOTION_RELEGATION_SEASON,
} from "../../../backend/lib/economyConstants.js";
import {
  MAX_SQUAD_SIZE,
  MIN_RIDERS_FOR_RACE,
  TRANSFER_WINDOW_SOFT_CAP_BUFFER,
} from "../../../backend/lib/marketUtils.js";
import {
  SQUAD_FINE_AMOUNT,
  SQUAD_PENALTY_POINTS,
} from "../../../backend/lib/squadEnforcement.js";
import { ACADEMY } from "../../../backend/lib/academyFlag.js";

// DIVISION_BONUSES is module-private in economyEngine.js (not exported). Mirror the
// literal here; the values below are the same array structure asserted by the
// engine's own season-end tests. If the engine table changes, update both.
const DIVISION_BONUSES = {
  1: [300_000, 200_000, 100_000, 50_000],
  2: [150_000, 100_000, 50_000, 25_000],
  3: [75_000, 50_000, 25_000],
};

test("squad numbers match backend constants", () => {
  assert.equal(RULES_NUMBERS.squadCap, MAX_SQUAD_SIZE);
  assert.equal(RULES_NUMBERS.windowBuffer, TRANSFER_WINDOW_SOFT_CAP_BUFFER);
  assert.equal(RULES_NUMBERS.squadFine, SQUAD_FINE_AMOUNT);
  assert.equal(RULES_NUMBERS.squadPenaltyPoints, SQUAD_PENALTY_POINTS);
  // starterSquadAllocator.STARTER_SQUAD.TOTAL_SIZE = MIN_RIDERS_FOR_RACE + TAIL_SIZE(4).
  // That module pulls in supabase/generator deps that don't load under a frontend
  // node --test, so we mirror the +4 tail here (same approach as DIVISION_BONUSES
  // below). If TAIL_SIZE changes in starterSquadAllocator.js, update both.
  assert.equal(RULES_NUMBERS.initialSquadSize, MIN_RIDERS_FOR_RACE + 4);
});

test("economy numbers match backend constants", () => {
  assert.equal(RULES_NUMBERS.startingBalance, INITIAL_BALANCE);
  assert.equal(RULES_NUMBERS.sponsorD1, SPONSOR_INCOME_BY_DIVISION[1]);
  assert.equal(RULES_NUMBERS.sponsorD2, SPONSOR_INCOME_BY_DIVISION[2]);
  assert.equal(RULES_NUMBERS.sponsorD3, SPONSOR_INCOME_BY_DIVISION[3]);
  assert.equal(RULES_NUMBERS.sponsorCeilingS1, FINAL_SPONSOR_PAYOUT_CEILING.S1);
  assert.equal(RULES_NUMBERS.sponsorCeilingS2, FINAL_SPONSOR_PAYOUT_CEILING.S2_PLUS);
  // SALARY_RATE is a fraction (0.067); the page shows a percentage.
  assert.equal(RULES_NUMBERS.salaryRatePct, Math.round(SALARY_RATE * 1000) / 10);
  assert.equal(RULES_NUMBERS.negativeInterestPct, NEGATIVE_BALANCE_INTEREST_RATE * 100);
  assert.equal(RULES_NUMBERS.debtD1, DEBT_CEILING_BY_DIVISION[1]);
  assert.equal(RULES_NUMBERS.debtD2, DEBT_CEILING_BY_DIVISION[2]);
  assert.equal(RULES_NUMBERS.debtD3, DEBT_CEILING_BY_DIVISION[3]);
  assert.equal(RULES_NUMBERS.prizePerPoint, PRIZE_PER_POINT);
  assert.equal(RULES_NUMBERS.starValue, STAR_RIDER_MARKET_VALUE);
});

test("season structure matches backend constants", () => {
  assert.equal(RULES_NUMBERS.minDivision, MIN_DIVISION);
  assert.equal(RULES_NUMBERS.maxDivision, MAX_DIVISION);
  assert.equal(RULES_NUMBERS.divisions, MAX_DIVISION - MIN_DIVISION + 1);
  assert.equal(RULES_NUMBERS.divisionCapacity, DIVISION_CAPACITY);
  assert.equal(RULES_NUMBERS.firstPromotionSeason, FIRST_PROMOTION_RELEGATION_SEASON);
});

test("division bonus table matches the season-end payout table", () => {
  assert.equal(RULES_NUMBERS.bonusD1P1, DIVISION_BONUSES[1][0]);
  assert.equal(RULES_NUMBERS.bonusD1P2, DIVISION_BONUSES[1][1]);
  assert.equal(RULES_NUMBERS.bonusD1P3, DIVISION_BONUSES[1][2]);
  assert.equal(RULES_NUMBERS.bonusD1P4, DIVISION_BONUSES[1][3]);
  assert.equal(RULES_NUMBERS.bonusD2P1, DIVISION_BONUSES[2][0]);
  assert.equal(RULES_NUMBERS.bonusD2P2, DIVISION_BONUSES[2][1]);
  assert.equal(RULES_NUMBERS.bonusD2P3, DIVISION_BONUSES[2][2]);
  assert.equal(RULES_NUMBERS.bonusD2P4, DIVISION_BONUSES[2][3]);
  assert.equal(RULES_NUMBERS.bonusD3P1, DIVISION_BONUSES[3][0]);
  assert.equal(RULES_NUMBERS.bonusD3P2, DIVISION_BONUSES[3][1]);
  assert.equal(RULES_NUMBERS.bonusD3P3, DIVISION_BONUSES[3][2]);
});

test("academy numbers match backend constants", () => {
  assert.equal(RULES_NUMBERS.academySlots, ACADEMY.SLOTS);
  assert.equal(RULES_NUMBERS.academyMinAge, ACADEMY.MIN_AGE);
  assert.equal(RULES_NUMBERS.academyMaxAge, ACADEMY.MAX_AGE);
  assert.equal(RULES_NUMBERS.academySalaryPct, ACADEMY.SALARY_RATE * 100);
  assert.equal(RULES_NUMBERS.academyContractLength, ACADEMY.CONTRACT_LENGTH);
  assert.equal(RULES_NUMBERS.academyDrift, ACADEMY.DRIFT_PER_SEASON);
});

test("runtime-configurable keys are excluded from the pinned guard", () => {
  // Sanity: every runtime key exists in RULES_NUMBERS but is not asserted above.
  for (const key of RULES_NUMBERS_RUNTIME_CONFIG_KEYS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(RULES_NUMBERS, key),
      `runtime key ${key} missing from RULES_NUMBERS`
    );
  }
});
