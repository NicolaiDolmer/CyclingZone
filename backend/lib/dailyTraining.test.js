import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_TRAINING_CONFIG, DEFAULT_PROGRAM, resolveProgram,
  growthFractionForAge, dailyAbilityDelta, applyDailyTick,
} from "./dailyTraining.js";
import { TRAINING_CONFIG } from "./training.js";

test("default-program bruges når plan mangler (spec 6.3: følger ALTID program)", () => {
  assert.deepEqual(resolveProgram(null), DEFAULT_PROGRAM);
  assert.deepEqual(resolveProgram(undefined), DEFAULT_PROGRAM);
  assert.equal(resolveProgram({ focus: "sprint", intensity: "hard" }).focus, "sprint");
});

test("rest-dag giver nul progress", () => {
  const d = dailyAbilityDelta({
    ability: "sprint", current: 70, cap: 80, age: 20,
    program: { focus: "sprint", intensity: "rest" },
    conditionMult: 1, bonus: false, noise: 1,
  });
  assert.equal(d, 0);
});

test("fokus-evne vokser hurtigere end off-fokus ved samme gap; bonus = ×1.25", () => {
  const base = { current: 70, cap: 80, age: 20, program: { focus: "sprint", intensity: "normal" }, conditionMult: 1, noise: 1 };
  const focusDelta = dailyAbilityDelta({ ...base, ability: "sprint", bonus: false });   // sprint er i sprint-fokus
  const offDelta = dailyAbilityDelta({ ...base, ability: "climbing", bonus: false });   // climbing er ikke
  const boosted = dailyAbilityDelta({ ...base, ability: "sprint", bonus: true });
  assert.ok(focusDelta > 0 && offDelta > 0);
  assert.ok(focusDelta > offDelta);
  // forholdet = focusGrowthMult.normal / offFocusMult (samme gap, samme alder) — brug reelle config-værdier
  const expectedRatio = TRAINING_CONFIG.focusGrowthMult.normal / TRAINING_CONFIG.offFocusMult;
  assert.ok(Math.abs(focusDelta / offDelta - expectedRatio) < 1e-9);
  assert.ok(Math.abs(boosted / focusDelta - DAILY_TRAINING_CONFIG.bonusMult) < 1e-9);
});

test("evne på cap giver nul", () => {
  const d = dailyAbilityDelta({
    ability: "sprint", current: 80, cap: 80, age: 20,
    program: { focus: "sprint", intensity: "hard" }, conditionMult: 1, bonus: false, noise: 1,
  });
  assert.equal(d, 0);
});

test("growthFractionForAge interpolerer L0-tabellen (yngre vokser hurtigere)", () => {
  assert.ok(growthFractionForAge(19) > growthFractionForAge(25));
  assert.ok(growthFractionForAge(25) > growthFractionForAge(30));
});

test("applyDailyTick: fuld bar giver +1, remainder bevares, clamp ved cap, deterministisk", () => {
  const input = {
    riderId: "r1", dateStr: "2026-06-20", age: 19,
    abilities: { sprint: 70, climbing: 55, endurance: 65 },
    caps: { sprint: 80, climbing: 60, endurance: 75 },
    progress: { sprint: 0.995 },
    program: { focus: "sprint", intensity: "hard" },
    conditionMult: 1, bonus: true,
  };
  const out = applyDailyTick({ ...input, abilities: { ...input.abilities }, progress: { ...input.progress } });
  // Robust for ALLE noise-værdier i [0.85, 1.15]: delta ∈ [0.2125, 0.2875] og bar=0.995+delta ⇒ præcis ét +1.
  assert.equal(out.abilities.sprint, 71);
  assert.equal(out.gains.sprint, 1);
  assert.ok(out.progress.sprint >= 0 && out.progress.sprint < 1);
  assert.ok(out.score > 0);
  assert.ok(["over", "normal", "under"].includes(out.status));
  const out2 = applyDailyTick({ ...input, abilities: { ...input.abilities }, progress: { ...input.progress } });
  assert.deepEqual(out, out2); // samme input + samme (rider,dato)-seed → identisk output
});

test("applyDailyTick muterer ikke input", () => {
  const abilities = { sprint: 70 };
  const progress = { sprint: 0.5 };
  applyDailyTick({
    riderId: "r2", dateStr: "2026-06-21", age: 22,
    abilities, caps: { sprint: 80 }, progress,
    program: { focus: "sprint", intensity: "normal" }, conditionMult: 1, bonus: false,
  });
  assert.equal(abilities.sprint, 70);
  assert.equal(progress.sprint, 0.5);
});

test("ukendt intensitet giver neutral multiplikator, aldrig NaN", () => {
  const d = dailyAbilityDelta({
    ability: "sprint", current: 70, cap: 80, age: 20,
    program: { focus: "sprint", intensity: "extreme" },
    conditionMult: 1, bonus: false, noise: 1,
  });
  assert.ok(Number.isFinite(d) && d > 0);
});
