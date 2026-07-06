import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_TRAINING_CONFIG, DEFAULT_PROGRAM, resolveProgram,
  growthFractionForAge, abilityMult, dailyAbilityDelta, applyDailyTick,
  computeAcademySeasonCeiling,
} from "./dailyTraining.js";
import { TRAINING_CONFIG } from "./training.js";
import { youthMultiplier } from "./academyFlag.js";
import { youthRateForPotential } from "./riderProgression.js";
import { deriveStaffAbilities } from "./staffAbilityDerivation.js";
import { staffTrainingBonus } from "./staffTrainingBonus.js";

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

// ── #2082/#1938: sæson-budget-cap + hård dags-cap (ejer-godkendt 5/7) ────────

test("computeAcademySeasonCeiling: loft = seasonStart + gap×frac pr. evne", () => {
  const ceiling = computeAcademySeasonCeiling({
    seasonStartAbilities: { climbing: 50, sprint: 30 },
    lifetimeCaps: { climbing: 80, sprint: 20 }, // sprint: cap < current → gap clampes til 0
    frac: 0.16,
  });
  assert.equal(ceiling.climbing, 50 + (80 - 50) * 0.16);
  assert.equal(ceiling.sprint, 30); // intet negativt gap — uændret loft
});

test("computeAcademySeasonCeiling: manglende evne i seasonStart/lifetimeCaps giver ingen NaN", () => {
  const ceiling = computeAcademySeasonCeiling({
    seasonStartAbilities: { climbing: 50 },
    lifetimeCaps: {},
    frac: 0.11,
  });
  assert.equal(ceiling.climbing, 50);
});

test("applyDailyTick: hardDailyCap=1 begrænser én evnes dags-gevinst til +1 uanset delta-størrelse", () => {
  // Stort gap (1→99) + akademi-alder + pot6 + bonus giver en rå delta langt over 1 —
  // uden cap ville flere hele point kunne akkumuleres på ÉN dag (se kontrol-test nedenfor).
  const input = {
    riderId: "cap1", dateStr: "2026-07-05", age: 17,
    abilities: { climbing: 1 },
    caps: { climbing: 99 },
    progress: { climbing: 0 },
    program: { focus: "vo2max", intensity: "hard" },
    conditionMult: 1, bonus: true, potentiale: 6, hardDailyCap: 1,
  };
  const out = applyDailyTick(input);
  assert.equal(out.gains.climbing, 1, "maks +1 selvom rå delta ville give mere");
  assert.equal(out.abilities.climbing, 2);
});

test("applyDailyTick: uden hardDailyCap (default) kan samme scenarie give mere end +1 (kontrol)", () => {
  const input = {
    riderId: "nocap1", dateStr: "2026-07-05", age: 17,
    abilities: { climbing: 1 },
    caps: { climbing: 99 },
    progress: { climbing: 0 },
    program: { focus: "vo2max", intensity: "hard" },
    conditionMult: 1, bonus: true, potentiale: 6,
  };
  const out = applyDailyTick(input);
  assert.ok(out.gains.climbing > 1, `forventede >1 uden cap, fik ${out.gains.climbing}`);
});

// ── #2216 A4 (Task 7): staff-trænings-bonus (dimension×niveau, kun under caps, no-op uden staff) ──

// En ren fysisk-ungdoms-coach (physical stærk, mental svag; youth stærk, senior svag).
const PHYS_YOUTH_COACH = deriveStaffAbilities({ role: "training", tier: 5, name: "Karel Novotny" });

test("dailyAbilityDelta: uden staff (default-params) = bit-identisk med den gamle kæde", () => {
  // Regressions-vagt: den EKSPLICITTE gamle formel (uden staffBonus) skal give præcis
  // samme tal som dailyAbilityDelta uden staff-params. Ét bevis for nul regression.
  const program = { focus: "sprint", intensity: "normal" };
  const args = { ability: "sprint", current: 40, cap: 85, age: 19, program, conditionMult: 0.97, bonus: true, noise: 1.07, potentiale: 5 };
  const cfg = DAILY_TRAINING_CONFIG;
  const gap = 85 - 40;
  const base = (gap * growthFractionForAge(19) * cfg.dailyBudgetBoost) / cfg.daysPerSeason;
  const mult = abilityMult("sprint", program);
  const expected = base * mult * 0.97 * youthMultiplier(19) * youthRateForPotential(5) * cfg.bonusMult * 1.07;
  const got = dailyAbilityDelta(args); // ingen staff/facilityTier/riderLevel → staffBonus = 1.0
  assert.ok(Math.abs(got - expected) < 1e-12, `bit-identisk: got ${got}, expected ${expected}`);
});

test("dailyAbilityDelta: fysisk-ungdoms-coach hæver en ung rytters fysiske delta proportionalt", () => {
  const program = { focus: "vo2max", intensity: "hard" };
  const base = { ability: "climbing", current: 40, cap: 85, age: 18, program, conditionMult: 1, bonus: false, noise: 1, potentiale: 4 };
  const withoutStaff = dailyAbilityDelta(base);
  const withStaff = dailyAbilityDelta({ ...base, staff: PHYS_YOUTH_COACH, facilityTier: 5, riderLevel: "youth" });
  const factor = staffTrainingBonus({ facilityTier: 5, staff: PHYS_YOUTH_COACH, ability: "climbing", riderLevel: "youth" });
  assert.ok(factor > 1.0, "fixture skal give en ægte bonus");
  // Delta'en er skaleret PRÆCIST med staff-bonus-faktoren (proportionalt løft).
  assert.ok(Math.abs(withStaff - withoutStaff * factor) < 1e-12, `got ${withStaff}, expected ${withoutStaff * factor}`);
  assert.ok(withStaff > withoutStaff, "bonus skal hæve delta");
});

test("dailyAbilityDelta: dimension-miss (mental) + niveau-miss (senior) → uændret delta (= uden staff)", () => {
  const program = { focus: "endurance", intensity: "normal" };
  // aggression = mental-evne; coachens mental-akse er under baseline → ingen bonus.
  const mentalBase = { ability: "aggression", current: 40, cap: 85, age: 18, program: { focus: "aggression", intensity: "normal" }, conditionMult: 1, bonus: false, noise: 1, potentiale: 4 };
  assert.equal(
    dailyAbilityDelta({ ...mentalBase, staff: PHYS_YOUTH_COACH, facilityTier: 5, riderLevel: "youth" }),
    dailyAbilityDelta(mentalBase),
    "mental-evne (dimension-miss) → delta uændret"
  );
  // En senior rytters fysiske evne løftes MINDRE end en ungdoms (niveau-target).
  const physBase = { ability: "climbing", current: 40, cap: 85, age: 30, program, conditionMult: 1, bonus: false, noise: 1, potentiale: 4 };
  const senior = dailyAbilityDelta({ ...physBase, staff: PHYS_YOUTH_COACH, facilityTier: 5, riderLevel: "senior" });
  const youth = dailyAbilityDelta({ ...physBase, age: 18, staff: PHYS_YOUTH_COACH, facilityTier: 5, riderLevel: "youth" });
  const youthNoStaff = dailyAbilityDelta({ ...physBase, age: 18 });
  const seniorNoStaff = dailyAbilityDelta(physBase);
  assert.ok((senior / seniorNoStaff) < (youth / youthNoStaff), "senior-løft < youth-løft (niveau-target)");
});

test("KRITISK non-regression: staff-bonus ændrer KUN daglig delta — cap-loopet klipper stadig ved ability_caps", () => {
  // Rytter ét point under cap. Selv med en stor staff-bonus + stort rå-delta må evnen
  // ALDRIG stige forbi cap: cap-loopet i applyDailyTick (current + gains < min(99,cap))
  // klipper uafhængigt af bonussen. Bonussen kan aldrig udvide et cap.
  const input = {
    riderId: "capstaff", dateStr: "2026-07-05", age: 17,
    abilities: { climbing: 84 },
    caps: { climbing: 85 },            // kun 1 point tilbage til cap
    progress: { climbing: 0.999 },     // bar næsten fuld → ét +1 er lige på trapperne
    program: { focus: "vo2max", intensity: "hard" },
    conditionMult: 1, bonus: true, potentiale: 6,
    // Stor bonus: fysisk-ungdoms-coach + fuld facilitet + youth-rytter.
    staff: PHYS_YOUTH_COACH, facilityTier: 5, riderLevel: "youth",
  };
  const out = applyDailyTick(input);
  assert.ok(out.abilities.climbing <= 85, `cap sprængt: ${out.abilities.climbing} > 85`);
  assert.equal(out.abilities.climbing, 85, "må ramme cap men aldrig overstige");
  assert.ok(out.gains.climbing <= 1, "maks +1 op til cap uanset bonus-størrelse");
});

test("applyDailyTick: uden staff (default) = bit-identisk med samme tick uden staff-params", () => {
  const base = {
    riderId: "r-noStaff", dateStr: "2026-06-22", age: 20,
    abilities: { sprint: 55, climbing: 60, endurance: 62 },
    caps: { sprint: 80, climbing: 78, endurance: 75 },
    progress: { sprint: 0.4, climbing: 0.7 },
    program: { focus: "sprint", intensity: "hard" },
    conditionMult: 0.95, bonus: true, potentiale: 5,
  };
  const withoutParams = applyDailyTick({ ...base, abilities: { ...base.abilities }, progress: { ...base.progress } });
  const withNullStaff = applyDailyTick({ ...base, abilities: { ...base.abilities }, progress: { ...base.progress }, staff: null, facilityTier: 0, riderLevel: "junior" });
  assert.deepEqual(withNullStaff, withoutParams, "null staff → identisk tick-output");
});
