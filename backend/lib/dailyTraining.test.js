import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_TRAINING_CONFIG, DEFAULT_PROGRAM, resolveProgram,
  growthFractionForAge, abilityMult, dailyAbilityDelta, applyDailyTick,
} from "./dailyTraining.js";
import { TRAINING_CONFIG } from "./training.js";
import { youthMultiplier } from "./academyFlag.js";
import { youthRateForPotential } from "./riderProgression.js";

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

// ── Akademi: ungdoms-multiplikator (#1308) ────────────────────────────────────

test("dailyAbilityDelta: akademi-alder (17) får youthMultiplier som faktor", () => {
  const program = { focus: "sprint", intensity: "normal" };
  const args = { ability: "sprint", current: 50, cap: 85, age: 17, program, conditionMult: 1, bonus: false, noise: 1, potentiale: 4 };
  const cfg = DAILY_TRAINING_CONFIG;
  const gap = 85 - 50;
  const base = (gap * growthFractionForAge(17) * cfg.dailyBudgetBoost) / cfg.daysPerSeason;
  const mult = abilityMult("sprint", program);
  const expected = base * mult * 1 * youthMultiplier(17) * youthRateForPotential(4) * 1;
  const got = dailyAbilityDelta(args);
  assert.ok(Math.abs(got - expected) < 1e-9, `got ${got}, expected ${expected}`);
});

test("dailyAbilityDelta: senior (age 27) uændret — youthMultiplier(27)===1.0", () => {
  assert.equal(youthMultiplier(27), 1.0);
  const program = { focus: "sprint", intensity: "normal" };
  const args = { ability: "sprint", current: 50, cap: 85, age: 27, program, conditionMult: 1, bonus: false, noise: 1, potentiale: 4 };
  const cfg = DAILY_TRAINING_CONFIG;
  const gap = 85 - 50;
  const base = (gap * growthFractionForAge(27) * cfg.dailyBudgetBoost) / cfg.daysPerSeason;
  const mult = abilityMult("sprint", program);
  const expected = base * mult * 1 * 1 * youthRateForPotential(4) * 1; // youthMultiplier=1.0 for seniorer; potRate(4) for potentiale
  const got = dailyAbilityDelta(args);
  assert.ok(Math.abs(got - expected) < 1e-9, `senior delta: got ${got}, expected ${expected}`);
});

test("potentiale skalerer daglig vækst: pot6 > pot2 ved samme gap/alder/program", () => {
  const base = { ability: "climbing", current: 20, cap: 80, age: 18,
    program: { focus: "vo2max", intensity: "hard" }, conditionMult: 1, bonus: false, noise: 1 };
  const low = dailyAbilityDelta({ ...base, potentiale: 2 });
  const high = dailyAbilityDelta({ ...base, potentiale: 6 });
  assert.ok(high > low, `pot6 ${high} skal > pot2 ${low}`);
});
