import test from "node:test";
import assert from "node:assert/strict";
import {
  nextFatigue, nextForm, conditionMultiplier,
  injuryRisk, rollInjury,
} from "./riderCondition.js";

test("træthed: hård dag bygger, rest sænker, clamp 0-100", () => {
  assert.ok(nextFatigue({ fatigue: 50, intensity: "hard", recoveryAbility: 50 }) > 50);
  assert.ok(nextFatigue({ fatigue: 50, intensity: "rest", recoveryAbility: 50 }) < 50);
  assert.equal(nextFatigue({ fatigue: 0, intensity: "rest", recoveryAbility: 99 }), 0);
  assert.ok(nextFatigue({ fatigue: 99, intensity: "hard", recoveryAbility: 0 }) <= 100);
});

test("recovery-evnen hjælper", () => {
  const lo = nextFatigue({ fatigue: 60, intensity: "normal", recoveryAbility: 0 });
  const hi = nextFatigue({ fatigue: 60, intensity: "normal", recoveryAbility: 99 });
  assert.ok(hi < lo);
});

test("raceLoad bygger oveni træningsbelastning", () => {
  const without = nextFatigue({ fatigue: 40, intensity: "easy", recoveryAbility: 50 });
  const withRace = nextFatigue({ fatigue: 40, intensity: "easy", recoveryAbility: 50, raceLoad: 18 });
  assert.ok(withRace > without);
});

test("form: stiger i sweet-zone, falder ved overbelastning, restituerer altid via hvile", () => {
  assert.ok(nextForm({ form: 50, fatigue: 40 }) > 50);
  assert.ok(nextForm({ form: 50, fatigue: 90 }) < 50);
  // død-spiral-garanti (#1306 acceptance): fra værst tænkelige punkt skal hvile bringe form tilbage
  let form = 0, fatigue = 100;
  for (let i = 0; i < 60; i++) {
    fatigue = nextFatigue({ fatigue, intensity: "rest", recoveryAbility: 0 });
    form = nextForm({ form, fatigue });
  }
  assert.ok(form >= 45, `form skal kunne restituere via hvile, fik ${form}`);
});

test("conditionMultiplier er ~1.0 ved neutral og bounded [0.7, 1.2]", () => {
  assert.ok(Math.abs(conditionMultiplier({ form: 50, fatigue: 30 }) - 1) < 0.02);
  assert.ok(conditionMultiplier({ form: 100, fatigue: 0 }) <= 1.2);
  assert.ok(conditionMultiplier({ form: 0, fatigue: 100 }) >= 0.7);
});

test("skaderisiko: 0 under tærskel eller uden hård træning; stiger med træthed", () => {
  assert.equal(injuryRisk({ intensity: "normal", fatigue: 90 }), 0);
  assert.equal(injuryRisk({ intensity: "hard", fatigue: 50 }), 0);
  assert.ok(injuryRisk({ intensity: "hard", fatigue: 80 }) > injuryRisk({ intensity: "hard", fatigue: 71 }));
});

test("rollInjury deterministisk + varighed 1-5 dage", () => {
  const a = rollInjury({ riderId: "r1", dateStr: "2026-06-20", risk: 1.0 }); // 100 % → altid skade
  const b = rollInjury({ riderId: "r1", dateStr: "2026-06-20", risk: 1.0 });
  assert.deepEqual(a, b);
  assert.ok(a.injured && a.days >= 1 && a.days <= 5);
  assert.equal(rollInjury({ riderId: "r1", dateStr: "2026-06-20", risk: 0 }).injured, false);
});

test("NaN/korrupt input falder neutralt tilbage — forgifter aldrig output", () => {
  assert.equal(nextFatigue({ fatigue: NaN, intensity: "hard", recoveryAbility: 50 }), 50);
  assert.equal(nextForm({ form: NaN, fatigue: 50 }), 50);
  assert.equal(nextForm({ form: 50, fatigue: NaN }), 50);
  assert.equal(injuryRisk({ intensity: "hard", fatigue: NaN }), 0);
  assert.equal(conditionMultiplier({ form: NaN, fatigue: 50 }), 1.0);
  assert.equal(conditionMultiplier({ form: 50, fatigue: NaN }), 1.0);
});
