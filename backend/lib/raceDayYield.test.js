import test from "node:test";
import assert from "node:assert/strict";
import {
  RACE_DAY_FOCUS,
  RACE_DAY_YIELD_CONFIG,
  raceDayFocusAbilities,
  raceDayProgram,
} from "./raceDayYield.js";
import { abilityMult, applyDailyTick, RACE_PROFILE_ABILITY_MAP } from "./dailyTraining.js";
import { TRAINING_CONFIG, TRAINING_FOCUSES } from "./training.js";
import { trainingScoreFactors } from "./trainingScore.js";
import { dayTypeForProgram } from "./trainingDayTypes.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

// En rytter med god plads til loftet i alle evner, saa ingen evne er "paa cap".
function roomyRider() {
  const abilities = {};
  const caps = {};
  for (const ability of VISIBLE_ABILITIES) {
    abilities[ability] = 50;
    caps[ability] = 90;
  }
  return { abilities, caps };
}

function tick({ program, progress = {}, hardDailyCap = 1, rider = roomyRider() }) {
  return applyDailyTick({
    riderId: "rider-4850",
    dateStr: "2026-09-28",
    age: 21,
    abilities: rider.abilities,
    caps: rider.caps,
    progress,
    program,
    conditionMult: 1,
    bonus: false,
    potentiale: 4,
    hardDailyCap,
    tickSeedKey: "season-4#gd1",
  });
}

test("#4850: loebsdagens program er et mellem-pas med etapens profil-evner", () => {
  const program = raceDayProgram("mountain");
  assert.equal(program.focus, RACE_DAY_FOCUS);
  assert.equal(program.intensity, "normal");
  assert.deepEqual([...program.focusAbilities], RACE_PROFILE_ABILITY_MAP.mountain);
  assert.equal(program.offFocus, undefined);
  assert.ok(Object.isFrozen(program));
  assert.equal(RACE_DAY_YIELD_CONFIG.intensity, "normal");
});

test("#4850: ukendt eller manglende profil falder tilbage til rolling", () => {
  assert.deepEqual([...raceDayFocusAbilities("unknown")], RACE_PROFILE_ABILITY_MAP.rolling);
  assert.deepEqual([...raceDayFocusAbilities(null)], RACE_PROFILE_ABILITY_MAP.rolling);
  assert.deepEqual([...raceDayProgram(undefined).focusAbilities], RACE_PROFILE_ABILITY_MAP.rolling);
});

test("#4850: bakket enkeltstart (itt_hilly) traener time_trial, ikke rolling-fallbacken", () => {
  const abilities = raceDayFocusAbilities("itt_hilly");
  assert.ok(abilities.includes("time_trial"));
  assert.notDeepEqual([...abilities], [...RACE_PROFILE_ABILITY_MAP.rolling]);
});

test("#4850: race_day er ikke en session man kan vaelge i en plan", () => {
  assert.equal(TRAINING_FOCUSES[RACE_DAY_FOCUS], undefined);
});

test("#4850: abilityMult giver mellem-passets fokus-rate paa profil-evner og off-fokus paa resten", () => {
  const program = raceDayProgram("mountain");
  assert.equal(abilityMult("climbing", program), TRAINING_CONFIG.focusGrowthMult.normal);
  assert.equal(abilityMult("sprint", program), TRAINING_CONFIG.offFocusMult);
  const onlyProfile = raceDayProgram("mountain", { includeOffFocus: false });
  assert.equal(onlyProfile.offFocus, false);
  assert.equal(abilityMult("climbing", onlyProfile), TRAINING_CONFIG.focusGrowthMult.normal);
  assert.equal(abilityMult("sprint", onlyProfile), 0);
});

test("#4850: en almindelig plan er bit-identisk (ingen focusAbilities)", () => {
  const plan = { focus: "vo2max", intensity: "hard" };
  assert.equal(abilityMult("climbing", plan), TRAINING_CONFIG.focusGrowthMult.hard);
  assert.equal(abilityMult("sprint", plan), TRAINING_CONFIG.offFocusMult);
  assert.equal(abilityMult("climbing", { focus: "vo2max", intensity: "rest" }), 0);
});

test("#4850: bjergetape giver mest klatring, flad etape mest sprint", () => {
  const mountain = tick({ program: raceDayProgram("mountain") });
  const flat = tick({ program: raceDayProgram("flat") });
  assert.ok(mountain.progress.climbing > mountain.progress.sprint, "bjerg: klatring > sprint");
  assert.ok(flat.progress.sprint > flat.progress.climbing, "flad: sprint > klatring");
});

test("#4850: aldrig +2 samme dag i en evne, og overskud baeres videre (carry-over)", () => {
  // Baren staar allerede paa 2,5 i klatring: uden loft ville dagen give +2 eller mere.
  const result = tick({ program: raceDayProgram("mountain"), progress: { climbing: 2.5 }, hardDailyCap: 1 });
  assert.equal(result.gains.climbing, 1);
  assert.equal(result.abilities.climbing, 51);
  assert.ok(result.progress.climbing >= 1.5, `resten baeres videre, fik ${result.progress.climbing}`);
});

test("#4850: traeningsscoren kan maale loebsdagens pas (dagtype training, ikke skill)", () => {
  const program = raceDayProgram("hilly");
  assert.equal(dayTypeForProgram(program), "training");
  const factors = trainingScoreFactors({ program, age: 23, potentiale: 4, conditionMult: 1, noise: 1 });
  assert.ok(factors, "et mellem-pas har en kvalitet at maale");
});
