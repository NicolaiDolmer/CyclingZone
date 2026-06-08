import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAINING_CONFIG, TRAINING_FOCUSES, TRAINING_FOCUS_KEYS,
  deriveTrainingState, canTrain, resolveTrainingModifier,
  isValidFocus, isValidIntensity,
} from "./training.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

// ── Taksonomi-integritet ────────────────────────────────────────────────────────

test("alle fokus-evner er gyldige synlige abilities", () => {
  const visible = new Set(VISIBLE_ABILITIES);
  for (const [focus, abilities] of Object.entries(TRAINING_FOCUSES)) {
    for (const a of abilities) {
      assert.ok(visible.has(a), `fokus ${focus} peger på ukendt ability: ${a}`);
    }
  }
});

test("validatorer afviser ukendte fokus/intensiteter", () => {
  assert.ok(isValidFocus("vo2max"));
  assert.ok(!isValidFocus("nonsense"));
  assert.ok(isValidIntensity("hard"));
  assert.ok(!isValidIntensity("brutal"));
});

// ── deriveTrainingState ─────────────────────────────────────────────────────────

test("deriveTrainingState: tomme rows → fulde slots, ingen planer", () => {
  const s = deriveTrainingState([], "s2");
  assert.equal(s.slots.total, TRAINING_CONFIG.slotsPerSeason);
  assert.equal(s.slots.used, 0);
  assert.equal(s.slots.remaining, TRAINING_CONFIG.slotsPerSeason);
  assert.deepEqual(s.plans, {});
  assert.deepEqual(s.focuses, TRAINING_FOCUS_KEYS);
});

test("deriveTrainingState: kun aktiv-sæson-planer tæller mod slots/plans", () => {
  const rows = [
    { rider_id: "r1", season_id: "s1", focus: "vo2max", intensity: "hard" }, // gammel sæson
    { rider_id: "r2", season_id: "s2", focus: "sprint", intensity: "normal" },
    { rider_id: "r3", season_id: "s2", focus: "aero", intensity: "easy" },
  ];
  const s = deriveTrainingState(rows, "s2");
  assert.equal(s.slots.used, 2);
  assert.equal(s.slots.remaining, TRAINING_CONFIG.slotsPerSeason - 2);
  assert.deepEqual(s.plans.r2, { focus: "sprint", intensity: "normal" });
  assert.deepEqual(s.plans.r3, { focus: "aero", intensity: "easy" });
  assert.equal(s.plans.r1, undefined); // gammel sæson vises ikke som aktiv plan
});

test("deriveTrainingState: remaining bunder ud i 0", () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ rider_id: `r${i}`, season_id: "s2", focus: "vo2max", intensity: "normal" }));
  const s = deriveTrainingState(rows, "s2");
  assert.equal(s.slots.remaining, 0);
});

// ── canTrain ────────────────────────────────────────────────────────────────────

test("canTrain: ny plan kræver et ledigt slot", () => {
  assert.deepEqual(canTrain(false, 1), { ok: true, reason: null });
  assert.deepEqual(canTrain(false, 0), { ok: false, reason: "no_slots" });
});

test("canTrain: om-målretning af eksisterende plan koster ikke slot", () => {
  assert.deepEqual(canTrain(true, 0), { ok: true, reason: null });
});

// ── resolveTrainingModifier ─────────────────────────────────────────────────────

test("resolveTrainingModifier: null plan → null modifier", () => {
  assert.equal(resolveTrainingModifier(null, "r1", 2), null);
  assert.equal(resolveTrainingModifier({ focus: "x", intensity: "hard" }, "r1", 2), null);
  assert.equal(resolveTrainingModifier({ focus: "vo2max", intensity: "x" }, "r1", 2), null);
});

test("resolveTrainingModifier: fokus-evner får focusMult, resten offFocusMult", () => {
  const m = resolveTrainingModifier({ focus: "sprint", intensity: "easy" }, "r1", 2);
  assert.ok(m.focusAbilities.has("sprint"));
  assert.ok(m.focusAbilities.has("acceleration"));
  assert.ok(!m.focusAbilities.has("climbing"));
  // easy har 0 % risiko → ingen dampening
  assert.equal(m.setbackHit, false);
  assert.equal(m.focusMult, TRAINING_CONFIG.focusGrowthMult.easy);
  assert.equal(m.offFocusMult, TRAINING_CONFIG.offFocusMult);
});

test("resolveTrainingModifier: deterministisk pr. (rytter, sæson, plan)", () => {
  const a = resolveTrainingModifier({ focus: "vo2max", intensity: "hard" }, "rider-x", 3);
  const b = resolveTrainingModifier({ focus: "vo2max", intensity: "hard" }, "rider-x", 3);
  assert.equal(a.setbackHit, b.setbackHit);
  assert.equal(a.focusMult, b.focusMult);
});

test("resolveTrainingModifier: tilbageslag dæmper vækst-multiplikatorerne", () => {
  // Find et rider-seed hvor hård intensitet rammer tilbageslag, og bekræft dampening.
  let hitSeed = null;
  for (let i = 0; i < 200 && !hitSeed; i++) {
    const m = resolveTrainingModifier({ focus: "vo2max", intensity: "hard" }, `seed-${i}`, 2);
    if (m.setbackHit) hitSeed = { i, m };
  }
  assert.ok(hitSeed, "forventede mindst ét tilbageslag på tværs af 200 seeds (18 % chance)");
  const { m } = hitSeed;
  assert.equal(m.focusMult, TRAINING_CONFIG.focusGrowthMult.hard * TRAINING_CONFIG.setbackGrowthMult);
  assert.equal(m.offFocusMult, TRAINING_CONFIG.offFocusMult * TRAINING_CONFIG.setbackGrowthMult);
});

test("resolveTrainingModifier: easy rammer aldrig tilbageslag", () => {
  for (let i = 0; i < 100; i++) {
    const m = resolveTrainingModifier({ focus: "endurance", intensity: "easy" }, `s-${i}`, 5);
    assert.equal(m.setbackHit, false);
  }
});
