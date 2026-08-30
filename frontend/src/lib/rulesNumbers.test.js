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
  SALARY_RATE_PRODUCTION,
  NEGATIVE_BALANCE_INTEREST_RATE,
  DEBT_CEILING_BY_DIVISION,
  PRIZE_PER_POINT,
  STAR_RIDER_MARKET_VALUE,
  MIN_DIVISION,
  MAX_DIVISION,
  DIVISION_CAPACITY,
  DIVISION_BONUSES,
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

test("squad numbers match backend constants", () => {
  assert.equal(RULES_NUMBERS.squadCap, MAX_SQUAD_SIZE);
  assert.equal(RULES_NUMBERS.windowBuffer, TRANSFER_WINDOW_SOFT_CAP_BUFFER);
  assert.equal(RULES_NUMBERS.squadFine, SQUAD_FINE_AMOUNT);
  assert.equal(RULES_NUMBERS.squadPenaltyPoints, SQUAD_PENALTY_POINTS);
  // starterSquadAllocator.STARTER_SQUAD.TOTAL_SIZE = MIN_RIDERS_FOR_RACE + TAIL_SIZE(4).
  // That module pulls in supabase/generator deps that don't load under a frontend
  // node --test, so we mirror the +4 tail here. If TAIL_SIZE changes in
  // starterSquadAllocator.js, update both.
  assert.equal(RULES_NUMBERS.initialSquadSize, MIN_RIDERS_FOR_RACE + 4);
});

test("economy numbers match backend constants", () => {
  assert.equal(RULES_NUMBERS.startingBalance, INITIAL_BALANCE);
  assert.equal(RULES_NUMBERS.sponsorD1, SPONSOR_INCOME_BY_DIVISION[1]);
  assert.equal(RULES_NUMBERS.sponsorD2, SPONSOR_INCOME_BY_DIVISION[2]);
  assert.equal(RULES_NUMBERS.sponsorD3, SPONSOR_INCOME_BY_DIVISION[3]);
  assert.equal(RULES_NUMBERS.sponsorCeilingS1, FINAL_SPONSOR_PAYOUT_CEILING.S1);
  assert.equal(RULES_NUMBERS.sponsorCeilingS2, FINAL_SPONSOR_PAYOUT_CEILING.S2_PLUS);
  // #4479: pinned to SALARY_RATE_PRODUCTION, the rate that actually freezes a
  // contract (computeFrozenSalary / resolveRiderSalary), NOT the legacy
  // market_value-based SALARY_RATE. Pinning to a dead constant is a green check
  // that verifies nothing — the /rules page drifted for free behind it.
  // SALARY_RATE_PRODUCTION is a fraction (0.35); the page shows a percentage.
  assert.equal(RULES_NUMBERS.salaryRatePct, Math.round(SALARY_RATE_PRODUCTION * 1000) / 10);
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

// #3100: assert BOTH directions against the real exported table. The old version
// pinned RULES_NUMBERS against a hand-copied literal that stopped at division 3,
// so when #1608 added tier 4 to the engine the guard stayed green while /rules and
// /help silently omitted a whole division that was already being paid out in prod.
// Direction 1 catches a value drifting; direction 2 catches a whole row going missing.
test("division bonus table matches the season-end payout table (every cell)", () => {
  for (const [division, amounts] of Object.entries(DIVISION_BONUSES)) {
    amounts.forEach((amount, index) => {
      const key = `bonusD${division}P${index + 1}`;
      assert.equal(
        RULES_NUMBERS[key],
        amount,
        `${key} must equal DIVISION_BONUSES[${division}][${index}] (${amount})`
      );
    });
  }
});

test("no division bonus cell is missing from or invented in RULES_NUMBERS", () => {
  const expected = Object.entries(DIVISION_BONUSES)
    .flatMap(([division, amounts]) => amounts.map((_, i) => `bonusD${division}P${i + 1}`))
    .sort();
  const actual = Object.keys(RULES_NUMBERS).filter((k) => /^bonusD\d+P\d+$/.test(k)).sort();
  assert.deepEqual(
    actual,
    expected,
    "RULES_NUMBERS bonus keys must cover DIVISION_BONUSES exactly — a new division or " +
      "placement in the engine has to reach /rules and /help, and a removed one has to leave"
  );
});

test("academy numbers match backend constants", () => {
  assert.equal(RULES_NUMBERS.academySlots, ACADEMY.SLOTS);
  assert.equal(RULES_NUMBERS.academyMinAge, ACADEMY.MIN_AGE);
  assert.equal(RULES_NUMBERS.academyMaxAge, ACADEMY.MAX_AGE);
  // #4479: academy signing (academyIntake.js) and promote (academyTransfer.js)
  // both call computeFrozenSalary, i.e. the shared senior formula since #3989.
  // ACADEMY.SALARY_RATE still points at the legacy market_value rate and is not
  // what any signing path charges, so the page number is pinned to the live one.
  assert.equal(RULES_NUMBERS.academySalaryPct, Math.round(SALARY_RATE_PRODUCTION * 1000) / 10);
  assert.equal(RULES_NUMBERS.academySalaryPct, RULES_NUMBERS.salaryRatePct);
  assert.equal(RULES_NUMBERS.academyContractLength, ACADEMY.CONTRACT_LENGTH);
  assert.equal(RULES_NUMBERS.academyDrift, ACADEMY.DRIFT_PER_SEASON);
  assert.equal(RULES_NUMBERS.academySigningFeePct, ACADEMY.SIGNING_FEE_RATE * 100);
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
