import test from "node:test";
import assert from "node:assert/strict";

import { scoreFinanceHealthGoal, sumActiveLoanDebt, sumRiderSalaries } from "./boardUtils.js";

// #1237 · Ejer-beslutning 4/9: no_outstanding_debt-målet scorer på nettostilling
// (balance minus aktiv gæld) med en buffer mod sæsonens lønudgift, ikke på antal
// lån isoleret. Grænsetest-dækning matcher issue-scopet: net negativ, net = 0,
// net = buffer, 1 lån m. stor formue >= 0.8, 0 lån m. 14k saldo < 0.7.

test("scoreFinanceHealthGoal · net markant negativ scorer lavt (nær gulvet 0.15)", () => {
  const score = scoreFinanceHealthGoal({
    balance: 10_000,
    activeDebt: 400_000,
    activeLoanCount: 2,
    wageBillPerSeason: 200_000,
    isFinalSeason: false,
  });
  assert.ok(score <= 0.2, `forventede score <=0.2, fik ${score}`);
  assert.ok(score >= 0.15, `score skal aldrig gå under gulvet 0.15, fik ${score}`);
});

test("scoreFinanceHealthGoal · net = 0 lander lige på vippepunktet (~0.35)", () => {
  const score = scoreFinanceHealthGoal({
    balance: 250_000,
    activeDebt: 250_000,
    activeLoanCount: 1,
    wageBillPerSeason: 300_000,
    isFinalSeason: false,
  });
  // 0.35 base minus lille lånefradrag (0.05 for 1 lån)
  assert.ok(score >= 0.28 && score <= 0.36, `forventede score omkring 0.30-0.35, fik ${score}`);
});

test("scoreFinanceHealthGoal · net = fuld buffer (0 lån) giver topscore", () => {
  const score = scoreFinanceHealthGoal({
    balance: 500_000,
    activeDebt: 200_000,
    activeLoanCount: 0,
    wageBillPerSeason: 300_000,
    isFinalSeason: false,
  });
  assert.equal(score, 1.0);
});

test("scoreFinanceHealthGoal · 1 aktivt lån + stor formue scorer stadig >= 0.8 (lån kan ikke alene sænke en stærk nettostilling)", () => {
  const score = scoreFinanceHealthGoal({
    balance: 2_000_000,
    activeDebt: 100_000,
    activeLoanCount: 1,
    wageBillPerSeason: 300_000,
    isFinalSeason: false,
  });
  assert.ok(score >= 0.8, `forventede score >=0.8, fik ${score}`);
});

test("scoreFinanceHealthGoal · 3+ lån cap'er lånefradraget på -0.15, men sænker ikke en stærk nettostilling under 0.8", () => {
  const score = scoreFinanceHealthGoal({
    balance: 2_000_000,
    activeDebt: 100_000,
    activeLoanCount: 5,
    wageBillPerSeason: 300_000,
    isFinalSeason: false,
  });
  assert.ok(score >= 0.8, `forventede score >=0.8 selv med 5 lån, fik ${score}`);
});

test("scoreFinanceHealthGoal · 0 lån men kun 14k på kontoen mod en realistisk lønsum scorer under 0.7 (issue-symptomet)", () => {
  const score = scoreFinanceHealthGoal({
    balance: 14_000,
    activeDebt: 0,
    activeLoanCount: 0,
    wageBillPerSeason: 200_000,
    isFinalSeason: false,
  });
  assert.ok(score < 0.7, `forventede score <0.7 (svag buffer trods 0 lån), fik ${score}`);
});

test("scoreFinanceHealthGoal · isFinalSeason + fuld buffer + 0 lån giver den gamle 1.05-topscore", () => {
  const score = scoreFinanceHealthGoal({
    balance: 500_000,
    activeDebt: 100_000,
    activeLoanCount: 0,
    wageBillPerSeason: 300_000,
    isFinalSeason: true,
  });
  assert.equal(score, 1.05);
});

test("scoreFinanceHealthGoal · defaults til 0/0/0/false uden argumenter og scorer lavt, ikke crash", () => {
  const score = scoreFinanceHealthGoal();
  assert.ok(Number.isFinite(score));
  assert.ok(score >= 0.15 && score <= 1.05);
});

test("sumActiveLoanDebt · summerer amount_remaining, ignorerer manglende felt", () => {
  assert.equal(sumActiveLoanDebt([{ amount_remaining: 1000 }, { amount_remaining: 2500 }, {}]), 3500);
  assert.equal(sumActiveLoanDebt([]), 0);
  assert.equal(sumActiveLoanDebt(undefined), 0);
});

test("sumRiderSalaries · summerer salary, ignorerer manglende felt", () => {
  assert.equal(sumRiderSalaries([{ salary: 5000 }, { salary: 7000 }, {}]), 12000);
  assert.equal(sumRiderSalaries([]), 0);
  assert.equal(sumRiderSalaries(undefined), 0);
});
