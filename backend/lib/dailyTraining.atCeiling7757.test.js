// #7757: en hel træningsdag med næsten ingen fremgang skal have en årsag rapporten kan vise.
// PARAMS er syntetiske testværdier, ikke kalibreringen (den er privat, hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDevelopmentCurveBParams, curveBSoftCeiling } from "./developmentCurveB.ts";
import { applyDailyTick, applyRaceDevelopmentTick, RACE_PROFILE_ABILITY_MAP } from "./dailyTraining.js";
import { buildCapsForRider } from "./riderProgression.js";
import { TRAINING_FOCUSES } from "./training.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

const CURVE = validateDevelopmentCurveBParams({
  rate: 10, levelExponent: 2, capExponent: 0.5,
  load: { fromAge: 16, fullAge: 24, floor: 0.5 },
  potentialCeiling: [0.2, 0.3, 0.4, 0.5, 0.6, 1],
});
const CAP = 80;
const POT = 3;
const SOFT = Math.ceil(curveBSoftCeiling(CAP, POT, CURVE));
const at = (v) => Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, v]));
const focusAt = (focus, v, rest = 20) => ({
  ...at(rest), ...Object.fromEntries(TRAINING_FOCUSES[focus].map((k) => [k, v])),
});

const tick = (over = {}) => ({
  riderId: "rider-A", dateStr: "2026-11-05", age: 26, abilities: at(20), caps: at(CAP), progress: {},
  program: { focus: "vo2max", intensity: "hard" }, conditionMult: 1, potentiale: POT,
  primaryType: "puncheur", secondaryType: null, hardDailyCap: 1, ...over,
});

test("alt passet træner står over det bløde loft: dagen bærer årsagen", () => {
  const out = applyDailyTick(tick({ abilities: focusAt("vo2max", SOFT), curveB: CURVE }));
  assert.equal(out.at_ceiling, true);
});

test("én trænet evne under det bløde loft: ingen årsag, feltet findes ikke", () => {
  const abilities = { ...focusAt("vo2max", SOFT), [TRAINING_FOCUSES.vo2max[0]]: SOFT - 1 };
  assert.equal("at_ceiling" in applyDailyTick(tick({ abilities, curveB: CURVE })), false);
});

test("uden kurve B er det det hårde loft der tæller", () => {
  assert.equal(applyDailyTick(tick({ abilities: focusAt("vo2max", CAP) })).at_ceiling, true);
  assert.equal("at_ceiling" in applyDailyTick(tick({ abilities: focusAt("vo2max", SOFT) })), false);
});

test("off-fokus-evner afgør det ikke: kun det passet træner tæller", () => {
  const out = applyDailyTick(tick({ abilities: focusAt("vo2max", CAP, 5), curveB: CURVE }));
  assert.equal(out.at_ceiling, true);
});

test("hvile og aktiv restitution har deres egen årsag og får aldrig feltet", () => {
  const abilities = at(CAP);
  for (const program of [{ focus: "vo2max", intensity: "rest" }, { focus: "restitution", intensity: "recovery" }]) {
    assert.equal("at_ceiling" in applyDailyTick(tick({ abilities, program, curveB: CURVE })), false);
  }
});

test("ukendt loft: ingen påstand om en årsag", () => {
  const caps = { ...at(CAP) };
  delete caps[TRAINING_FOCUSES.vo2max[0]];
  assert.equal("at_ceiling" in applyDailyTick(tick({ abilities: at(CAP), caps, curveB: CURVE })), false);
});

test("løbsdagens pas tæller etapens egne evner", () => {
  const focusAbilities = RACE_PROFILE_ABILITY_MAP.flat;
  const program = { focus: "race", intensity: "hard", focusAbilities, offFocus: false };
  const abilities = { ...at(20), ...Object.fromEntries(focusAbilities.map((k) => [k, CAP])) };
  assert.equal(applyDailyTick(tick({ abilities, program, curveB: CURVE })).at_ceiling, true);
  assert.equal("at_ceiling" in applyDailyTick(tick({ abilities: at(20), program, curveB: CURVE })), false);
});

test("løbsudviklingens tick bærer samme årsag", () => {
  const relevant = RACE_PROFILE_ABILITY_MAP.mountain;
  const abilities = { ...at(20), ...Object.fromEntries(relevant.map((k) => [k, CAP])) };
  assert.equal(applyRaceDevelopmentTick(tick({ abilities, profileType: "mountain", curveB: CURVE })).at_ceiling, true);
  assert.equal("at_ceiling" in applyRaceDevelopmentTick(tick({ abilities: at(20), profileType: "mountain", curveB: CURVE })), false);
});

test("gruppen fra #7757: en aldret rytter over sit aftrappede loft får intet og får årsagen", () => {
  const abilities = at(60);
  const caps = buildCapsForRider(abilities, { potentiale: POT, age: 42 }, "puncheur", null);
  assert.ok(VISIBLE_ABILITIES.every((k) => caps[k] <= abilities[k]), "loftet er aftrappet under det rytteren kan");
  const out = applyDailyTick(tick({ age: 42, abilities, caps, curveB: CURVE }));
  assert.deepEqual(out.gains, {});
  assert.equal(out.score, 0);
  assert.equal(out.at_ceiling, true);
});
