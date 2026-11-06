// #7584: faste, syntetiske scenarier for loebsdagens rolle-tillaeg. Delt af
// raceDayRoleYield7584.test.js og generatoren af den frosne fixture
// (raceDayRoleYield7584Base.json). Samme fil koeres i merge-basen (foer rettelsen) og i
// den nye kode; kun hashes forlader modulet (hard rule 17). Ingen prod-data, ingen rng.

import { createHash } from "node:crypto";

import { applyDailyTick, RACE_PROFILE_ABILITY_MAP } from "../dailyTraining.js";
import { VISIBLE_ABILITIES } from "../abilityDerivation.js";
import { VALID_RACE_ROLES } from "../raceRoles.js";
import { raceDayRoleBaseProgram, raceDayRoleYieldMultipliers, withRaceDayRoleYield } from "../raceDayRoleYield5950.js";

// Syntetiske params, IKKE kalibreringen.
// Flere saet med skaeve vaerdier: to regnemaader der er ens paa papiret, kan afvige i sidste
// decimal, og "bit-identisk" skal kunne se det.
const PARAM_SETS = Object.freeze([
  Object.freeze({ stageBonus: 0.5, leadShare: 0.6 }),
  Object.freeze({ stageBonus: 0.37, leadShare: 0.43 }),
  Object.freeze({ stageBonus: 0.213, leadShare: 0.71 }),
]);
const PROFILES = [...Object.keys(RACE_PROFILE_ABILITY_MAP), null, "unknown_profile"];
const ROLES = [...VALID_RACE_ROLES, null, "unknown_role"];
const SCORE_B_CASES = Object.freeze([
  Object.freeze({ score: 50, devMult: 1, kind: "race", offFocusDevMult: 1 }),
  Object.freeze({ score: 50, devMult: 1.3, kind: "race", offFocusDevMult: 0.8 }),
  Object.freeze({ score: 50, devMult: 0.9, kind: "training" }),
]);

function rider(seed) {
  return {
    riderId: `r${seed}`, dateStr: "2026-11-05", age: 21 + seed, potentiale: 3 + (seed % 3),
    abilities: Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, 35 + ((seed * 13 + i * 7) % 40)])),
    caps: Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, 80 + ((seed + i) % 15)])),
    progress: Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, ((seed + i) % 5) / 6])),
    conditionMult: 1, hardDailyCap: 1,
  };
}

const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function eachCase(fn) {
  const out = [];
  for (const params of PARAM_SETS.flatMap((p) => [p, Object.freeze({ ...p, roleDrivesBaseDay: true })])) {
    for (const profileType of PROFILES) {
      for (const role of ROLES) out.push(fn({ params, profileType, role }));
    }
  }
  return out;
}

/** Score B slukket: programmet, multiplikatorerne og hele tick'et, ogsaa med catch-up oven i. */
export function scoreBOffDigest7584() {
  return sha(eachCase(({ params, profileType, role }) => {
    const plain = withRaceDayRoleYield({}, { params, profileType, role });
    const catchUp = withRaceDayRoleYield(
      { staff: null, abilityYieldMult: { climbing: 1.25, sprint: 1.5 } }, { params, profileType, role },
    );
    const direct = raceDayRoleYieldMultipliers({ params, profileType, role });
    const ticks = [1, 2].map((seed) => {
      const result = applyDailyTick({ ...rider(seed), ...plain, program: plain.program });
      return { abilities: result.abilities, progress: result.progress, gains: result.gains, score: result.score };
    });
    return { plain, catchUp, direct, ticks };
  }));
}

/** Score B taendt: fokus-evnernes multiplikatorer og programmet. De var rigtige foer #7584 og maa ikke flytte sig. */
export function scoreBFocusDigest7584() {
  return sha(eachCase(({ params, profileType, role }) => SCORE_B_CASES.map((developmentScore) => {
    const { program, abilityYieldMult } = withRaceDayRoleYield({ developmentScore }, { params, profileType, role });
    const focus = program.focusAbilities.filter((a) => a in abilityYieldMult).map((a) => [a, abilityYieldMult[a]]);
    return { program, focus };
  })));
}

/** Basis-programmet alene, som kontrol af at rettelsen ikke roerer basis-dagen. */
export function baseProgramDigest7584() {
  return sha(eachCase(({ params, profileType, role }) => [null, ...SCORE_B_CASES].map((developmentScore) => (
    raceDayRoleBaseProgram(profileType, { role, roleDrivesBaseDay: params.roleDrivesBaseDay === true, developmentScore })
  ))));
}

export function computeDigests7584() {
  return {
    scoreBOff: scoreBOffDigest7584(),
    scoreBFocus: scoreBFocusDigest7584(),
    baseProgram: baseProgramDigest7584(),
  };
}
