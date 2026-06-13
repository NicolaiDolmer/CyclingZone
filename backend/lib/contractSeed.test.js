import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTRACT,
  computeFrozenSalary,
  pickContractLength,
  computeContractEndSeason,
} from "./contractSeed.js";
import { makeRng } from "./fictionalRiderGenerator.js";

test("computeFrozenSalary spejler den gamle generated formel", () => {
  // GREATEST(1, ROUND((COALESCE(base_value,1000)+prize)*0.10))
  assert.equal(computeFrozenSalary({ base_value: 1_000_000, prize_earnings_bonus: 0 }), 100_000);
  assert.equal(computeFrozenSalary({ base_value: 50_000, prize_earnings_bonus: 5_000 }), 5_500);
  // NULL/0 base_value → fallback 1000 → salary 100
  assert.equal(computeFrozenSalary({ base_value: null, prize_earnings_bonus: 0 }), 100);
  // bundgrænse 1
  assert.equal(computeFrozenSalary({ base_value: 1, prize_earnings_bonus: 0 }), 1);
});

test("pickContractLength giver 1-3, ~1/3 fordeling, deterministisk pr. seed", () => {
  const rng = makeRng(2026);
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 3000; i++) counts[pickContractLength(rng)]++;
  for (const len of [1, 2, 3]) {
    assert.ok(counts[len] >= 850 && counts[len] <= 1150, `len ${len}: ${counts[len]} udenfor ~1/3`);
  }
  // determinisme: samme seed → samme første træk
  assert.equal(pickContractLength(makeRng(7)), pickContractLength(makeRng(7)));
});

test("computeContractEndSeason = start + length - 1", () => {
  assert.equal(computeContractEndSeason(1, 2), 2); // relaunch founder: aktiv sæson 1+2
  assert.equal(computeContractEndSeason(1, 1), 1);
  assert.equal(computeContractEndSeason(3, 3), 5);
});

test("CONTRACT-konstanter", () => {
  assert.equal(CONTRACT.FOUNDER_LENGTH, 2);
  assert.equal(CONTRACT.DEFAULT_ACQUIRE_LENGTH, 2);
  assert.equal(CONTRACT.SALARY_RATE, 0.10);
});
