import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_TRAINING_CONFIG, DEFAULT_PROGRAM, resolveProgram,
  growthFractionForAge, abilityMult, dailyAbilityDelta, applyDailyTick,
  computeAcademySeasonCeiling, applyRaceDevelopmentTick, RACE_PROFILE_ABILITY_MAP, RACE_DEV_CONFIG,
} from "./dailyTraining.js";
import { TRAINING_CONFIG } from "./training.js";
import { youthMultiplier } from "./academyFlag.js";
import { youthRateForPotential } from "./riderProgression.js";
import { staffTrainingBonus, facilityTrainingMultiplier } from "./staffTrainingBonus.js";

test("default-program bruges når plan mangler OG type ukendt (spec 6.3: følger ALTID program)", () => {
  assert.deepEqual(resolveProgram(null), DEFAULT_PROGRAM);
  assert.deepEqual(resolveProgram(undefined), DEFAULT_PROGRAM);
  assert.equal(resolveProgram({ focus: "sprint", intensity: "hard" }).focus, "sprint");
});

// #1894: ryttere UDEN plan trænede tidligere ALTID endurance uanset type (44% af
// trup — fejludvikling for fx sprintere). resolveProgram(null, primaryType) skal nu
// give et type-matchet fokus via smartDefaultFocus (backend/lib/training.js).
test("resolveProgram: ingen plan + kendt type → smart default-fokus (#1894)", () => {
  const program = resolveProgram(null, "sprinter");
  assert.equal(program.focus, "sprint");
  assert.equal(program.intensity, "normal");
});

test("resolveProgram: eksisterende plan vinder ALTID over smart default", () => {
  const program = resolveProgram({ focus: "endurance", intensity: "hard" }, "sprinter");
  assert.equal(program.focus, "endurance");
  assert.equal(program.intensity, "hard");
});

test("resolveProgram: ukendt/manglende primary_type falder tilbage til endurance (bagudkompatibel)", () => {
  assert.equal(resolveProgram(null, null).focus, "endurance");
  assert.equal(resolveProgram(null, undefined).focus, "endurance");
  assert.equal(resolveProgram(null).focus, "endurance");
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

// En ren fysisk-ungdoms-coach (physical stærk, mental svag; u23 stærk, senior svag).
// #2529: LEVEL_BANDS = u23/senior (youth+junior kollapset til ét u23-bånd).
// Håndbygget (IKKE deriveStaffAbilities): specializationMatch kræver kun
// { overall, dimensions, levels }, og et fast fixture holder testen uafhængig
// af PRNG-hash-tilfældighed (en navngivet kandidats akse-fordeling kan skifte
// hvilken akse der ender øverst, når LEVEL_BANDS' længde ændres — som her).
const PHYS_YOUTH_COACH = {
  overall: 70,
  dimensions: { physical: 95, mental: 20, technical: 50 },
  levels: { u23: 95, senior: 20 },
  roleSkills: {},
};

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
  const withStaff = dailyAbilityDelta({ ...base, staff: PHYS_YOUTH_COACH, facilityTier: 5, riderLevel: "u23" });
  const factor = staffTrainingBonus({ facilityTier: 5, staff: PHYS_YOUTH_COACH, ability: "climbing", riderLevel: "u23" })
    // Plan B (#1441): facilitets-magnitude (effectiveBonus) ganges også ind i kæden.
    * facilityTrainingMultiplier({ facilityTier: 5, staff: PHYS_YOUTH_COACH });
  assert.ok(factor > 1.0, "fixture skal give en ægte bonus");
  // Delta'en er skaleret PRÆCIST med staff-bonus × facilitets-multiplikator.
  assert.ok(Math.abs(withStaff - withoutStaff * factor) < 1e-12, `got ${withStaff}, expected ${withoutStaff * factor}`);
  assert.ok(withStaff > withoutStaff, "bonus skal hæve delta");
});

test("dailyAbilityDelta: dimension-miss (mental) + niveau-miss (senior) → uændret delta (= uden staff)", () => {
  const program = { focus: "endurance", intensity: "normal" };
  // aggression = mental-evne; coachens mental-akse er under baseline → ingen
  // SPECIALISERINGS-bonus. Plan B: facilitets-MAGNITUDEN gælder dog stadig (den er
  // evne-uafhængig), så delta = uden-staff × facilityTrainingMultiplier præcist.
  const mentalBase = { ability: "aggression", current: 40, cap: 85, age: 18, program: { focus: "aggression", intensity: "normal" }, conditionMult: 1, bonus: false, noise: 1, potentiale: 4 };
  const facMult = facilityTrainingMultiplier({ facilityTier: 5, staff: PHYS_YOUTH_COACH });
  const mentalWith = dailyAbilityDelta({ ...mentalBase, staff: PHYS_YOUTH_COACH, facilityTier: 5, riderLevel: "u23" });
  const mentalWithout = dailyAbilityDelta(mentalBase);
  assert.ok(
    Math.abs(mentalWith - mentalWithout * facMult) < 1e-12,
    "mental-evne (dimension-miss) → KUN facilitets-magnitude, ingen specialiserings-bonus"
  );
  // En senior rytters fysiske evne løftes MINDRE end en ungdoms (niveau-target).
  const physBase = { ability: "climbing", current: 40, cap: 85, age: 30, program, conditionMult: 1, bonus: false, noise: 1, potentiale: 4 };
  const senior = dailyAbilityDelta({ ...physBase, staff: PHYS_YOUTH_COACH, facilityTier: 5, riderLevel: "senior" });
  const youth = dailyAbilityDelta({ ...physBase, age: 18, staff: PHYS_YOUTH_COACH, facilityTier: 5, riderLevel: "u23" });
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
    // Stor bonus: fysisk-ungdoms-coach + fuld facilitet + u23-rytter.
    staff: PHYS_YOUTH_COACH, facilityTier: 5, riderLevel: "u23",
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
  const withNullStaff = applyDailyTick({ ...base, abilities: { ...base.abilities }, progress: { ...base.progress }, staff: null, facilityTier: 0, riderLevel: "u23" });
  assert.deepEqual(withNullStaff, withoutParams, "null staff → identisk tick-output");
});

// ── #2437: academyRateMult (interim-knap, VALGFRI, default 1.0) ─────────────

test("dailyAbilityDelta: academyRateMult udeladt = bit-identisk med eksplicit 1.0", () => {
  const args = {
    ability: "sprint", current: 50, cap: 85, age: 17,
    program: { focus: "sprint", intensity: "normal" },
    conditionMult: 1, bonus: false, noise: 1, potentiale: 4,
  };
  const omitted = dailyAbilityDelta(args);
  const explicit1 = dailyAbilityDelta({ ...args, academyRateMult: 1.0 });
  assert.equal(omitted, explicit1);
  assert.ok(omitted > 0, "sanity: skal give en ægte positiv delta");
});

test("dailyAbilityDelta: academyRateMult=1/3 giver præcis en tredjedel af delta", () => {
  const args = {
    ability: "sprint", current: 50, cap: 85, age: 17,
    program: { focus: "sprint", intensity: "normal" },
    conditionMult: 1, bonus: false, noise: 1, potentiale: 4,
  };
  const full = dailyAbilityDelta(args);
  const third = dailyAbilityDelta({ ...args, academyRateMult: 1 / 3 });
  assert.ok(Math.abs(third - full / 3) < 1e-12, `got ${third}, expected ${full / 3}`);
});

test("applyDailyTick: academyRateMult udeladt = bit-identisk regression mod samme tick uden parameteren", () => {
  const base = {
    riderId: "r-rateMult", dateStr: "2026-07-10", age: 17,
    abilities: { sprint: 50, climbing: 55, endurance: 60 },
    caps: { sprint: 85, climbing: 80, endurance: 78 },
    progress: { sprint: 0.3, climbing: 0.6 },
    program: { focus: "sprint", intensity: "normal" },
    conditionMult: 1, bonus: true, potentiale: 5,
  };
  const withoutParam = applyDailyTick({ ...base, abilities: { ...base.abilities }, progress: { ...base.progress } });
  const withExplicit1 = applyDailyTick({ ...base, abilities: { ...base.abilities }, progress: { ...base.progress }, academyRateMult: 1.0 });
  assert.deepEqual(withExplicit1, withoutParam, "academyRateMult=1.0 → identisk tick-output (nul regression)");
});

test("applyDailyTick: academyRateMult=1/3 skalerer progress-akkumulering præcist ift. mult=1", () => {
  // score-feltet er afrundet til 2 decimaler (afrundings-kollisioner ved meget små
  // deltaer) — sammenlign i stedet det UAFRUNDEDE progress-felt. Gap=5 giver en delta
  // der garanteret forbliver under +1 hele-tal-terskel for begge kørsler (heller ikke
  // ved øvre noise-grænse), så progress = 0 + delta eksakt (ingen while-loop-afrunding).
  // Samme (riderId,dateStr) → samme seeded noise i begge kørsler, uafhængigt af mult.
  const base = {
    riderId: "r-rateMult2", dateStr: "2026-07-10", age: 17,
    abilities: { sprint: 50 },
    caps: { sprint: 55 },
    progress: { sprint: 0 },
    program: { focus: "sprint", intensity: "normal" },
    conditionMult: 1, bonus: false, potentiale: 4,
  };
  const full = applyDailyTick({ ...base, abilities: { ...base.abilities }, progress: { ...base.progress } });
  const third = applyDailyTick({ ...base, abilities: { ...base.abilities }, progress: { ...base.progress }, academyRateMult: 1 / 3 });
  assert.equal(Object.keys(full.gains).length, 0, "sanity: gap er for lille til +1 selv uden mult");
  assert.ok(full.progress.sprint > 0, "sanity: skal give ægte positiv progress");
  assert.ok(
    Math.abs(third.progress.sprint - full.progress.sprint / 3) < 1e-9,
    `got ${third.progress.sprint}, expected ${full.progress.sprint / 3}`,
  );
});

// ── #3459 D2: applyRaceDevelopmentTick (søster-funktion til applyDailyTick) ─

// Fælles fixture: fem evner med lille, ens gap (5) — kun DISSE bidrager til
// "det erstattede pas" (alle andre VISIBLE_ABILITIES har current=0/cap=undefined
// ⇒ gap=0 ⇒ delta=0, jf. dailyAbilityDelta), så testene forbliver håndregnbare.
function raceDevFixture(overrides = {}) {
  return {
    riderId: "race1", dateStr: "2026-08-10", age: 27,
    abilities: { climbing: 50, endurance: 50, durability: 50, sprint: 50, flat: 50 },
    caps: { climbing: 55, endurance: 55, durability: 55, sprint: 55, flat: 55 },
    progress: {},
    program: { focus: "sprint", intensity: "normal" },
    conditionMult: 1, bonus: false, potentiale: 3,
    ...overrides,
  };
}

test("applyRaceDevelopmentTick: kun løbsprofilens relevante evner får gevinst — resten urørt", () => {
  // mountain → ["climbing", "endurance", "durability"] (RACE_PROFILE_ABILITY_MAP).
  const out = applyRaceDevelopmentTick(raceDevFixture({ profileType: "mountain" }));
  for (const a of RACE_PROFILE_ABILITY_MAP.mountain) {
    assert.ok(out.progress[a] > 0, `${a} skal have fået progress (løbsrelevant evne)`);
  }
  // sprint/flat er IKKE i mountain-mappingen — skal forblive urørt.
  assert.equal(out.progress.sprint ?? 0, 0, "sprint er uden for mountain-profilen — ingen progress");
  assert.equal(out.progress.flat ?? 0, 0, "flat er uden for mountain-profilen — ingen progress");
  assert.equal(out.abilities.sprint, 50);
  assert.equal(out.abilities.flat, 50);
});

test("applyRaceDevelopmentTick: ukendt profil-type falder tilbage til 'rolling' (samme fallback som raceFatigueLoad)", () => {
  const known = applyRaceDevelopmentTick(raceDevFixture({ profileType: "rolling" }));
  const unknown = applyRaceDevelopmentTick(raceDevFixture({ profileType: "helt-ukendt-profil-xyz" }));
  assert.deepEqual(unknown.progress, known.progress, "ukendt profil ⇒ identisk output med eksplicit 'rolling'");
  for (const a of RACE_PROFILE_ABILITY_MAP.rolling) {
    assert.ok(unknown.progress[a] > 0, `${a} (rolling-fallback) skal have fået progress`);
  }
});

test("applyRaceDevelopmentTick: devMult skalerer 'det erstattede pas' lineært", () => {
  // Caps hæves til 90 i netop denne test: trin 7's rate-spredning gjorde
  // deltaerne så små at 1,0- og 1,15-scorerne rundede til samme 2-decimals-
  // score (score afrundes i applyRaceDevelopmentTick), og sanity-tjekket
  // nederst blev blindt. Linearitets-målingen bruger progress (uafrundet).
  const base = raceDevFixture({
    profileType: "mountain",
    caps: { climbing: 90, endurance: 90, durability: 90, sprint: 90, flat: 90 },
  });
  const atOne = applyRaceDevelopmentTick({ ...base, devMult: 1.0 });
  const atDefault = applyRaceDevelopmentTick({ ...base, devMult: RACE_DEV_CONFIG.devMult }); // 1.15
  const atDouble = applyRaceDevelopmentTick({ ...base, devMult: 2.0 });
  for (const a of RACE_PROFILE_ABILITY_MAP.mountain) {
    assert.ok(Math.abs(atDefault.progress[a] - atOne.progress[a] * RACE_DEV_CONFIG.devMult) < 1e-9,
      `${a}: devMult=1.15 skal give 1.15× devMult=1.0's progress`);
    assert.ok(Math.abs(atDouble.progress[a] - atOne.progress[a] * 2.0) < 1e-9,
      `${a}: devMult=2.0 skal give 2× devMult=1.0's progress`);
  }
  assert.ok(atDefault.score > atOne.score, "sanity: default devMult (1.15) > devMult 1.0 ⇒ højere score");
});

test("applyRaceDevelopmentTick: caps respekteres — evne allerede på cap får INTET, ingen evne overstiger cap", () => {
  // climbing er ÉT point under cap med næsten fuld progress-bar — stort devMult-
  // budget skal presse den PRÆCIST til cap, aldrig forbi (samme cap-loop-mekanik
  // som applyDailyTick).
  const out = applyRaceDevelopmentTick(raceDevFixture({
    profileType: "mountain",
    abilities: { climbing: 54, endurance: 50, durability: 50 },
    caps: { climbing: 55, endurance: 90, durability: 90 }, // endurance/durability: stort gap → stort devTotal-bidrag
    progress: { climbing: 0.99 },
    devMult: 3.0,
  }));
  assert.ok(out.abilities.climbing <= 55, `cap sprængt: ${out.abilities.climbing} > 55`);
  assert.equal(out.abilities.climbing, 55, "climbing skal ramme cap men aldrig overstige");

  // Evne PÅ cap fra start (endurance) — separat scenarie: intet gap ⇒ intet i
  // "det erstattede pas" for endurance selv, MEN endurance er stadig i relevant-
  // listen og skal ikke få nogen progress-akkumulering af de ANDRE evners budget.
  const capped = applyRaceDevelopmentTick(raceDevFixture({
    profileType: "mountain",
    abilities: { climbing: 50, endurance: 55, durability: 50 },
    caps: { climbing: 55, endurance: 55, durability: 55 }, // endurance: current===cap
    progress: {},
  }));
  assert.equal(capped.abilities.endurance, 55, "endurance var allerede på cap — uændret");
  assert.equal(capped.progress.endurance ?? 0, 0, "på cap ⇒ ingen progress-akkumulering, budget tabes (ikke omfordelt)");
});

test("applyRaceDevelopmentTick: conditionMult skalerer proportionalt (samme led som dailyAbilityDelta)", () => {
  const full = applyRaceDevelopmentTick(raceDevFixture({ profileType: "mountain", conditionMult: 1.0 }));
  const half = applyRaceDevelopmentTick(raceDevFixture({ profileType: "mountain", conditionMult: 0.5 }));
  for (const a of RACE_PROFILE_ABILITY_MAP.mountain) {
    assert.ok(Math.abs(half.progress[a] - full.progress[a] * 0.5) < 1e-9,
      `${a}: conditionMult=0.5 skal halvere progress ift. conditionMult=1.0`);
  }
});

test("applyRaceDevelopmentTick: staff/facility/academyRateMult-kæden ganger ind PRÆCIST som dailyAbilityDelta", () => {
  const withoutBoost = applyRaceDevelopmentTick(raceDevFixture({ profileType: "mountain" }));
  const withAcademyBoost = applyRaceDevelopmentTick(raceDevFixture({ profileType: "mountain", academyRateMult: 2.0 }));
  for (const a of RACE_PROFILE_ABILITY_MAP.mountain) {
    assert.ok(Math.abs(withAcademyBoost.progress[a] - withoutBoost.progress[a] * 2.0) < 1e-9,
      `${a}: academyRateMult=2.0 skal fordoble progress (samme led som applyDailyTick sender til dailyAbilityDelta)`);
  }
});

test("applyRaceDevelopmentTick: samme kontrakt-form som applyDailyTick (abilities/gains/progress/score/noise/status)", () => {
  const out = applyRaceDevelopmentTick(raceDevFixture({ profileType: "flat" }));
  assert.deepEqual(Object.keys(out).sort(), ["abilities", "gains", "noise", "progress", "score", "status"]);
  assert.ok(["over", "normal", "under"].includes(out.status));
});

test("applyRaceDevelopmentTick: muterer ikke input, deterministisk pr. (rider,dato)", () => {
  const abilities = { climbing: 50, endurance: 50, durability: 50 };
  const progress = { climbing: 0.2 };
  const input = raceDevFixture({ profileType: "mountain", abilities, progress });
  const out1 = applyRaceDevelopmentTick(input);
  assert.deepEqual(abilities, { climbing: 50, endurance: 50, durability: 50 }, "input-abilities urørt");
  assert.deepEqual(progress, { climbing: 0.2 }, "input-progress urørt");
  const out2 = applyRaceDevelopmentTick(raceDevFixture({ profileType: "mountain", abilities: { ...abilities }, progress: { ...progress } }));
  assert.deepEqual(out1, out2, "samme (rider,dato)-seed ⇒ identisk output");
});
