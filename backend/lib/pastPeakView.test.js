// #7947 / #8476 punkt 5: "Efter peak, i tilbagegang" følger sæsonskiftets aldring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agingCfgForXp, loadPastPeakAging, pastPeakFromAging } from "./pastPeakView.js";
import { AGING_V2_CONFIG, PROGRESSION_CONFIG, agingV2BaseDrop } from "./riderProgression.js";

test("#7947 XP slukket: efter peak = præcis de aldre, hvor dagens skifte giver et fald", () => {
  const plateau = AGING_V2_CONFIG.plateauThroughAge;
  for (let age = 16; age <= plateau + 8; age++) {
    assert.equal(pastPeakFromAging(age), agingV2BaseDrop(age) > 0, `alder ${age}`);
  }
  assert.equal(pastPeakFromAging(plateau), false, "plateauets sidste år er ikke tilbagegang");
  assert.equal(pastPeakFromAging(plateau + 1), true);
});

test("#7947 den gamle peak-alder siger ikke længere 'tilbagegang' på plateauet", () => {
  // Rod-årsagen: PROGRESSION_CONFIG.peakAge lå under plateauet, så fladen sagde
  // "i tilbagegang" om ryttere, motoren ikke ældede.
  const oldFirst = PROGRESSION_CONFIG.peakAge + 1;
  if (oldFirst <= AGING_V2_CONFIG.plateauThroughAge) assert.equal(pastPeakFromAging(oldFirst), false);
});

test("#7947 XP tændt: grænsen er talfilens aldring, samme cfg som skiftet", () => {
  const plateau = AGING_V2_CONFIG.plateauThroughAge - 2;
  const xpParams = { aging: { plateauThroughAge: plateau, declineByYearsPastPlateau: AGING_V2_CONFIG.declineByYearsPastPlateau } };
  const cfg = agingCfgForXp(xpParams);
  assert.equal(cfg.plateauThroughAge, plateau);
  assert.equal(pastPeakFromAging(plateau, cfg), false);
  assert.equal(pastPeakFromAging(plateau + 1, cfg), true);
  for (let age = 16; age <= plateau + 8; age++) {
    assert.equal(pastPeakFromAging(age, cfg), agingV2BaseDrop(age, cfg) > 0, `alder ${age}`);
  }
  // Talfil uden aldring eller XP slukket: dagens regel.
  assert.equal(agingCfgForXp({}), AGING_V2_CONFIG);
  assert.equal(agingCfgForXp(null), AGING_V2_CONFIG);
});

test("#7947 ukendt alder er aldrig 'efter peak'", () => {
  for (const age of [null, undefined, Number.NaN, "x"]) assert.equal(pastPeakFromAging(age), false);
});

test("#7947 en fejlet XP-læsning giver dagens regel (best effort)", async () => {
  const broken = { from() { throw new Error("db nede"); } };
  const cfg = await loadPastPeakAging(broken, { log: null, now: new Date("2026-11-19T12:00:00Z") });
  assert.equal(cfg, AGING_V2_CONFIG);
});
