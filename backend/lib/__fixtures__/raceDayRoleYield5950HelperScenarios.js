// #5950: faste, syntetiske scenarier for rettelsen "tempo ud af hjaelperens evner".
// Delt af raceDayRoleYield5950.test.js og generatoren af den frosne fixture
// (raceDayRoleYield5950HelperBase.json). Samme fil koeres i merge-basen (foer rettelsen) og
// i den nye kode; kun hashes forlader modulet (hard rule 17). Ingen prod-data, ingen rng.
//
// Det der SKAL vaere uroert af rettelsen:
//   · flagOff: hovedflaget slukket (params null), loebsdagen er dagens model
//   · mainModel: hovedflaget taendt, underkontakten slukket (det der koerer i dag), alle
//     roller, alle profiler, med og uden Udviklingsscore B, hele tick'et
//   · leadersWithSubswitch: underkontakten taendt for kaptajner og jaegeren (deres
//     basis-dag og tillaeg afhaenger ikke af hjaelperens evner)
// Kun hjaelper, luksushjaelper og fri rolle MED underkontakten taendt maa flytte sig.

import { createHash } from "node:crypto";

import { applyDailyTick, RACE_PROFILE_ABILITY_MAP } from "../dailyTraining.js";
import { VISIBLE_ABILITIES } from "../abilityDerivation.js";
import { VALID_RACE_ROLES } from "../raceRoles.js";
import { raceDayProgram } from "../raceDayYield.js";
import {
  raceDayRoleAbilityGroups, raceDayRoleBaseProgram, raceDayRoleBonusWeights, raceDayRoleGroup,
  raceDayRoleYieldMultipliers, withRaceDayRoleYield,
} from "../raceDayRoleYield5950.js";

// Syntetiske params, IKKE kalibreringen. Skaeve vaerdier, saa en aendret regnemaade kan ses
// i sidste decimal.
const PARAM_SETS = Object.freeze([
  Object.freeze({ stageBonus: 0.5, leadShare: 0.6 }),
  Object.freeze({ stageBonus: 0.37, leadShare: 0.43 }),
  Object.freeze({ stageBonus: 0.213, leadShare: 0.71 }),
]);
const PROFILES = [...Object.keys(RACE_PROFILE_ABILITY_MAP), null, "unknown_profile"];
const ROLES = [...VALID_RACE_ROLES, null, "unknown_role"];
const GROUPS = ["leader", "hunter", "helper", "free"];
const SCORE_B_CASES = Object.freeze([
  null,
  Object.freeze({ score: 50, devMult: 1, kind: "race", offFocusDevMult: 1 }),
  Object.freeze({ score: 50, devMult: 1.3, kind: "race", offFocusDevMult: 0.8 }),
  Object.freeze({ score: 50, devMult: 1.2, kind: "race" }),
]);

function rider(seed) {
  return {
    riderId: `r${seed}`, dateStr: "2026-11-26", age: 20 + seed, potentiale: 2 + (seed % 4),
    abilities: Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, 33 + ((seed * 11 + i * 5) % 42)])),
    caps: Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, 78 + ((seed + i) % 17)])),
    progress: Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, ((seed + i) % 7) / 8])),
    conditionMult: 1, hardDailyCap: 1,
  };
}

const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function tickResult(extra, program) {
  return [1, 2, 3].map((seed) => {
    const r = applyDailyTick({ ...rider(seed), ...extra, program });
    return { abilities: r.abilities, progress: r.progress, gains: r.gains, score: r.score };
  });
}

function roleCase(params, profileType, role) {
  return SCORE_B_CASES.map((developmentScore) => {
    const base = developmentScore ? { developmentScore } : {};
    const plain = withRaceDayRoleYield(base, { params, profileType, role });
    const catchUp = withRaceDayRoleYield(
      { ...base, staff: null, abilityYieldMult: { climbing: 1.25, sprint: 1.5, tempo: 1.1 } },
      { params, profileType, role },
    );
    const direct = raceDayRoleYieldMultipliers({ params, profileType, role, developmentScore });
    return { plain, catchUp, direct, ticks: tickResult(plain, plain.program) };
  });
}

/** Hovedflaget slukket: loebsdagen er dagens model, uden rolle-opslag. */
export function flagOffDigest5950() {
  return sha(PROFILES.flatMap((profileType) => ROLES.map((role) => {
    const extra = withRaceDayRoleYield({ staff: null }, { params: null, profileType, role });
    return { extra, ticks: tickResult(extra, raceDayProgram(profileType)) };
  })));
}

/** Hovedflaget taendt, underkontakten slukket: det der koerer i dag. */
export function mainModelDigest5950() {
  return sha(PARAM_SETS.flatMap((params) => PROFILES.flatMap((profileType) => {
    const groups = GROUPS.map((group) => raceDayRoleAbilityGroups(profileType, group));
    const roles = ROLES.map((role) => ({
      weights: raceDayRoleBonusWeights(profileType, role, params.leadShare),
      program: raceDayRoleBaseProgram(profileType, { role }),
      cases: roleCase(params, profileType, role),
    }));
    return { groups, roles };
  })));
}

/** Underkontakten taendt, kun kaptajner og jaegeren. */
export function leadersWithSubswitchDigest5950() {
  const leaders = ROLES.filter((role) => ["leader", "hunter"].includes(raceDayRoleGroup(role)));
  return sha(PARAM_SETS.flatMap((p) => {
    const params = Object.freeze({ ...p, roleDrivesBaseDay: true });
    return PROFILES.flatMap((profileType) => ({
      groups: ["leader", "hunter"].map((group) => raceDayRoleAbilityGroups(profileType, group, { roleDrivesBaseDay: true })),
      roles: leaders.map((role) => ({
        weights: raceDayRoleBonusWeights(profileType, role, params.leadShare, { roleDrivesBaseDay: true }),
        program: raceDayRoleBaseProgram(profileType, { role, roleDrivesBaseDay: true }),
        cases: roleCase(params, profileType, role),
      })),
    }));
  }));
}

export function computeDigests5950Helper() {
  return {
    flagOff: flagOffDigest5950(),
    mainModel: mainModelDigest5950(),
    leadersWithSubswitch: leadersWithSubswitchDigest5950(),
  };
}
