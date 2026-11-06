// #7584: loebsdagens rolle-tillaeg i tick'ets faktiske enhed under Udviklingsscore B.
//
// Under Score B normaliserer applyDailyTick fokus-evnerne, men ikke off-fokus-evnerne.
// Tillaegget skal derfor regnes pr. evne i tick'ets enhed, ellers faar lederskab,
// aggression og hjaelperens stoette-evner et andet tillaeg end vaegten siger, og D3
// variant A (samme tillaeg i alt for alle roller) holder ikke.
//
// Score B slukket = bit-identisk med merge-basen FOER rettelsen:
// __fixtures__/raceDayRoleYield7584Base.json er skrevet af merge-basens kode (sourceCommit
// i filen) med de samme scenarier (__fixtures__/raceDayRoleYield7584Scenarios.js) og
// genereres aldrig med den nye kode. Kun hashes; syntetisk fixture, ingen prod-data.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyDailyTick, RACE_PROFILE_ABILITY_MAP } from "./dailyTraining.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { VALID_RACE_ROLES } from "./raceRoles.js";
import { raceDayProgram } from "./raceDayYield.js";
import {
  DECISIVE_ABILITY_BY_PROFILE, raceDayRoleBaseProgram, raceDayRoleBonusWeights,
  raceDayRoleYieldMultipliers, withRaceDayRoleYield,
} from "./raceDayRoleYield5950.js";
import { developmentTickArgs, validateDevelopmentScoreWiringParams } from "./developmentScoreWiring.js";
import { SCORE_PARAMS } from "./developmentScoreWiring.fixtures.js";
import { computeDigests7584 } from "./__fixtures__/raceDayRoleYield7584Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/raceDayRoleYield7584Base.json", import.meta.url), "utf8"));

// Syntetiske params og Score B-objekter, IKKE kalibreringen.
const PARAMS = Object.freeze({ stageBonus: 0.5, leadShare: 0.6 });
const PARAMS_A = Object.freeze({ ...PARAMS, roleDrivesBaseDay: true });
const PROFILES = Object.keys(RACE_PROFILE_ABILITY_MAP);
const ROLES = [...VALID_RACE_ROLES, null, "unknown_role"];
const SCORE_B_CASES = Object.freeze({
  neutral: Object.freeze({ score: 50, devMult: 1, kind: "race", offFocusDevMult: 1 }),
  split: Object.freeze({ score: 50, devMult: 1.3, kind: "race", offFocusDevMult: 0.8 }),
  "uden offFocusDevMult": Object.freeze({ score: 50, devMult: 1.2, kind: "race" }),
});

function tickArgs(program, extra = {}) {
  return {
    riderId: "r1", dateStr: "2026-11-05", age: 24,
    abilities: Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 40])),
    caps: Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 90])),
    progress: {}, program, conditionMult: 1, potentiale: 4, hardDailyCap: Infinity, ...extra,
  };
}
const yielded = (r) => Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, (r.gains[k] ?? 0) + Number(r.progress[k] ?? 0)]));

// Dagens udbytte pr. evne, med og uden tillaeg, gennem den rigtige tick.
function dayWithAndWithoutBonus(profile, role, params, extraArgs) {
  const day = (p) => {
    const extra = withRaceDayRoleYield(extraArgs, { params: p, profileType: profile, role });
    return yielded(applyDailyTick(tickArgs(raceDayProgram(profile), extra)));
  };
  return { withBonus: day(params), base: day({ ...params, stageBonus: 0 }) };
}

// Tick'ets enhed: hvad en fokus-evne med vaegt 1 giver paa dagen, maalt i tick'et.
function focusUnit(profile, extraArgs) {
  const { base } = dayWithAndWithoutBonus(profile, "captain", PARAMS, extraArgs);
  return base[DECISIVE_ABILITY_BY_PROFILE[profile]];
}

test("#7584 golden: Score B slukket er bit-identisk med merge-basen (program, multiplikatorer, hele tick'et)", () => {
  assert.equal(computeDigests7584().scoreBOff, FROZEN.scoreBOff);
});

test("#7584 golden: fokus-evnerne under Score B og basis-programmet er uroerte", () => {
  const digests = computeDigests7584();
  assert.equal(digests.scoreBFocus, FROZEN.scoreBFocus);
  assert.equal(digests.baseProgram, FROZEN.baseProgram);
});

for (const [name, developmentScore] of Object.entries(SCORE_B_CASES)) {
  for (const [switchName, params] of [["underkontakt off", PARAMS], ["underkontakt on", PARAMS_A]]) {
    test(`#7584 Score B ${name}, ${switchName}: tillaegget pr. evne er vaegten i tick'ets enhed, ogsaa off-fokus`, () => {
      for (const profile of PROFILES) {
        const unit = focusUnit(profile, { developmentScore });
        assert.ok(unit > 0, `${profile}: enheden er maalt`);
        for (const role of ROLES) {
          const { withBonus, base } = dayWithAndWithoutBonus(profile, role, params, { developmentScore });
          const weights = raceDayRoleBonusWeights(profile, role, params.leadShare, { roleDrivesBaseDay: params === PARAMS_A });
          for (const ability of VISIBLE_ABILITIES) {
            const expected = params.stageBonus * (weights[ability] ?? 0) * unit;
            const got = withBonus[ability] - base[ability];
            assert.ok(Math.abs(got - expected) < 1e-9, `${profile}/${role}/${ability}: ${got} vs ${expected}`);
          }
        }
      }
    });

    test(`#7584 Score B ${name}, ${switchName}: D3 variant A - samme tillaeg i alt for alle roller`, () => {
      const total = (profile, role) => {
        const { withBonus, base } = dayWithAndWithoutBonus(profile, role, params, { developmentScore });
        return VISIBLE_ABILITIES.reduce((s, a) => s + withBonus[a] - base[a], 0);
      };
      for (const profile of PROFILES) {
        const captain = total(profile, "captain");
        assert.ok(captain > 0, `${profile}: kaptajnen faar et tillaeg`);
        for (const role of ROLES) {
          assert.ok(Math.abs(total(profile, role) - captain) < 1e-9, `${profile}/${role}: ${total(profile, role)} vs ${captain}`);
        }
      }
    });
  }
}

test("#7584: de navngivne off-fokus-evner - lederskab, aggression og hjaelperens stoette-evner", () => {
  const developmentScore = SCORE_B_CASES.split;
  const profile = "mountain";
  const unit = focusUnit(profile, { developmentScore });
  const cases = [["captain", "leadership"], ["hunter", "aggression"], ["helper", "teamwork"]];
  for (const [role, ability] of cases) {
    const program = raceDayRoleBaseProgram(profile, { role });
    assert.ok(!program.focusAbilities.includes(ability), `${ability} er off-fokus for ${role}`);
    const weight = raceDayRoleBonusWeights(profile, role, PARAMS.leadShare)[ability];
    assert.ok(weight > 0, `${ability} har vaegt for ${role}`);
    const { withBonus, base } = dayWithAndWithoutBonus(profile, role, PARAMS, { developmentScore });
    const got = withBonus[ability] - base[ability];
    assert.ok(Math.abs(got - PARAMS.stageBonus * weight * unit) < 1e-9, `${role}/${ability}: ${got}`);
  }
});

test("#7584: hele kaeden - motorens rigtige Score B-argumenter giver samme tillaeg i alt for alle roller", () => {
  const developmentScoreB = validateDevelopmentScoreWiringParams(SCORE_PARAMS);
  assert.ok(developmentScoreB, "syntetiske params er gyldige");
  for (const profile of PROFILES) {
    const shared = tickArgs(raceDayProgram(profile));
    const scoreArgs = developmentTickArgs({ developmentScoreB, dayKey: "d1", tickArgs: shared, racedToday: true, profileType: profile });
    assert.ok(scoreArgs.developmentScore.devMult > 0, `${profile}: scoren er taendt`);
    assert.equal(scoreArgs.developmentScore.kind, "race");
    const total = (role) => {
      const { withBonus, base } = dayWithAndWithoutBonus(profile, role, PARAMS, scoreArgs);
      return VISIBLE_ABILITIES.reduce((s, a) => s + withBonus[a] - base[a], 0);
    };
    const captain = total("captain");
    for (const role of ROLES) assert.ok(Math.abs(total(role) - captain) < 1e-9, `${profile}/${role}: ${total(role)} vs ${captain}`);
  }
});

test("#7584: et direkte kald med developmentScore giver det samme som motorens kald", () => {
  for (const developmentScore of Object.values(SCORE_B_CASES)) {
    for (const params of [PARAMS, PARAMS_A]) {
      for (const profile of PROFILES) {
        for (const role of ROLES) {
          assert.deepEqual(
            raceDayRoleYieldMultipliers({ params, profileType: profile, role, developmentScore }),
            withRaceDayRoleYield({ developmentScore }, { params, profileType: profile, role }).abilityYieldMult,
            `${profile}/${role}`,
          );
        }
      }
    }
  }
});

test("#7584: et ugyldigt Score B-objekt laeses som slukket, praecis som applyDailyTick", () => {
  for (const developmentScore of [null, undefined, {}, { devMult: Number.NaN }, { devMult: -1 }, { devMult: "1" }]) {
    for (const profile of PROFILES) {
      for (const role of ROLES) {
        assert.deepEqual(
          raceDayRoleYieldMultipliers({ params: PARAMS, profileType: profile, role, developmentScore }),
          raceDayRoleYieldMultipliers({ params: PARAMS, profileType: profile, role }),
          `${profile}/${role}`,
        );
      }
    }
  }
});

test("#7584: et nul-led i Score B giver aldrig en uendelig multiplikator", () => {
  const edges = [
    { score: 1, devMult: 0, kind: "race", offFocusDevMult: 0 },
    { score: 1, devMult: 0, kind: "race", offFocusDevMult: 0.8 },
    { score: 1, devMult: 1, kind: "race", offFocusDevMult: 0 },
  ];
  for (const developmentScore of edges) {
    for (const profile of PROFILES) {
      for (const role of ROLES) {
        const mults = withRaceDayRoleYield({ developmentScore }, { params: PARAMS, profileType: profile, role }).abilityYieldMult;
        for (const [ability, mult] of Object.entries(mults)) {
          assert.ok(Number.isFinite(mult) && mult > 0, `${profile}/${role}/${ability}: ${mult}`);
        }
      }
    }
  }
  // devMult 0: enheden er nul, saa off-fokus-evnerne faar intet tillaeg, kun deres basis.
  const zero = { score: 1, devMult: 0, kind: "race", offFocusDevMult: 0.8 };
  const { withBonus, base } = dayWithAndWithoutBonus("flat", "captain", PARAMS, { developmentScore: zero });
  assert.equal(withBonus.leadership, base.leadership);
});

test("#7584: maks +1 pr. evne pr. loebsdag holder under Score B, ogsaa med et stort tillaeg", () => {
  const big = { stageBonus: 5, leadShare: 0.1 };
  for (const role of ["captain", "hunter", "helper", "free_role"]) {
    const extra = withRaceDayRoleYield({ developmentScore: SCORE_B_CASES.split }, { params: big, profileType: "flat", role });
    const r = applyDailyTick(tickArgs(raceDayProgram("flat"), {
      ...extra, hardDailyCap: 1, progress: { leadership: 0.99, aggression: 0.99, teamwork: 0.99 },
    }));
    for (const k of VISIBLE_ABILITIES) assert.ok((r.gains[k] ?? 0) <= 1, `${role}: ${k}`);
  }
});
