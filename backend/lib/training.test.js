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
  // #1305: "rest" er nu gyldig daglig intensitet
  assert.ok(isValidIntensity("rest"));
});

// ── deriveTrainingState ─────────────────────────────────────────────────────────

test("deriveTrainingState: ubegrænsede slots (unlimitedSlots=true) — total/remaining er null", () => {
  // #1305: default config har unlimitedSlots=true
  const s = deriveTrainingState([], "s2");
  assert.equal(s.slots.total, null);
  assert.equal(s.slots.used, 0);
  assert.equal(s.slots.remaining, null);
  assert.deepEqual(s.plans, {});
  assert.deepEqual(s.focuses, TRAINING_FOCUS_KEYS);
});

test("deriveTrainingState: kun aktiv-sæson-planer tæller (ubegrænset)", () => {
  const rows = [
    { rider_id: "r1", season_id: "s1", focus: "vo2max", intensity: "hard" }, // gammel sæson
    { rider_id: "r2", season_id: "s2", focus: "sprint", intensity: "normal" },
    { rider_id: "r3", season_id: "s2", focus: "aero", intensity: "easy" },
  ];
  const s = deriveTrainingState(rows, "s2");
  assert.equal(s.slots.used, 2);
  assert.equal(s.slots.remaining, null); // ubegrænset → null
  assert.deepEqual(s.plans.r2, { focus: "sprint", intensity: "normal" });
  assert.deepEqual(s.plans.r3, { focus: "aero", intensity: "easy" });
  assert.equal(s.plans.r1, undefined); // gammel sæson vises ikke som aktiv plan
});

test("deriveTrainingState: begrænset cfg (slotsPerSeason=3) — remaining bunder ud i 0", () => {
  // Explicit begrænset cfg for backward-compat test
  const limitedCfg = { ...TRAINING_CONFIG, unlimitedSlots: false };
  const rows = Array.from({ length: 9 }, (_, i) => ({ rider_id: `r${i}`, season_id: "s2", focus: "vo2max", intensity: "normal" }));
  const s = deriveTrainingState(rows, "s2", limitedCfg);
  assert.equal(s.slots.total, TRAINING_CONFIG.slotsPerSeason);
  assert.equal(s.slots.remaining, 0);
});

// ── canTrain ────────────────────────────────────────────────────────────────────

test("canTrain: ubegrænset (default) — altid ok uanset hasPlan/remaining", () => {
  // #1305: unlimitedSlots=true i default config
  assert.deepEqual(canTrain(false, null), { ok: true, reason: null });
  assert.deepEqual(canTrain(false, 0), { ok: true, reason: null });
  assert.deepEqual(canTrain(true, 0), { ok: true, reason: null });
});

test("canTrain: begrænset cfg — ny plan kræver ledigt slot, om-målretning koster ikke", () => {
  const limitedCfg = { ...TRAINING_CONFIG, unlimitedSlots: false };
  assert.deepEqual(canTrain(false, 1, limitedCfg), { ok: true, reason: null });
  assert.deepEqual(canTrain(false, 0, limitedCfg), { ok: false, reason: "no_slots" });
  assert.deepEqual(canTrain(true, 0, limitedCfg), { ok: true, reason: null });
});

// ── resolveTrainingModifier ─────────────────────────────────────────────────────

test("resolveTrainingModifier: null plan → null modifier", () => {
  assert.equal(resolveTrainingModifier(null, "r1", 2), null);
  assert.equal(resolveTrainingModifier({ focus: "x", intensity: "hard" }, "r1", 2), null);
  // "x" er stadig ugyldig — men "rest" er nu gyldig
  assert.equal(resolveTrainingModifier({ focus: "vo2max", intensity: "x" }, "r1", 2), null);
});

test("resolveTrainingModifier: rest giver easy-lignende multiplier + aldrig setback", () => {
  for (let i = 0; i < 50; i++) {
    const m = resolveTrainingModifier({ focus: "endurance", intensity: "rest" }, `r-rest-${i}`, 3);
    assert.ok(m !== null, "rest + gyldig fokus → ikke null");
    assert.equal(m.setbackHit, false, "rest giver aldrig setback");
    // focusMult skal svare til easy (ingen dampening)
    assert.equal(m.focusMult, TRAINING_CONFIG.focusGrowthMult.easy);
    assert.equal(m.offFocusMult, TRAINING_CONFIG.offFocusMult);
  }
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
