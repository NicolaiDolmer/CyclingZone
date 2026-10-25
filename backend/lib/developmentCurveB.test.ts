// #3564 kurve B (D-058). Tallene i PARAMS er syntetiske testværdier, ikke
// kalibreringen (den er privat, hard rule 17). Testene låser ADFÆRDEN.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  curveBBase, curveBCapSoftness, curveBLevelCost, curveBLoadCapacity, curveBSoftCeiling,
  validateDevelopmentCurveBParams,
} from "./developmentCurveB.ts";
import {
  DEVELOPMENT_CURVE_B_FLAG_KEY, DEVELOPMENT_CURVE_B_PARAMS_ENV, curveBParamsFromEnv,
  isDevelopmentCurveBEnabled, loadDevelopmentCurveB,
} from "./developmentCurveBFlag.ts";
import * as dt from "./dailyTraining.js";
import * as engine from "./dailyTrainingEngine.js";

// JS-modulerne har ingen typer; deres JSDoc-defaults (null) ville ellers afvise kurven.
type AnyFn = (args: Record<string, unknown>) => any;
const dailyAbilityDelta = dt.dailyAbilityDelta as unknown as AnyFn;
const applyDailyTick = dt.applyDailyTick as unknown as AnyFn;
const applyRaceDevelopmentTick = dt.applyRaceDevelopmentTick as unknown as AnyFn;
const resolveProgram = dt.resolveProgram as unknown as (plan: unknown, type: string) => Record<string, unknown>;
const capTickGainsPerDate = engine.capTickGainsPerDate as unknown as AnyFn;
import { STAGE_FLAGS } from "./stageFlagCatalog.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

const RAW = {
  rate: 10, levelExponent: 2, capExponent: 0.5,
  load: { fromAge: 16, fullAge: 24, floor: 0.5 },
  potentialCeiling: [0.5, 0.6, 0.7, 0.8, 0.9, 1],
};
const PARAMS = validateDevelopmentCurveBParams(RAW)!;

const abilitiesAt = (v: number) => Object.fromEntries(VISIBLE_ABILITIES.map((k: string) => [k, v]));

test("validate: gyldige params fryses, alt ugyldigt giver null (fail-safe)", () => {
  assert.ok(PARAMS);
  assert.ok(Object.isFrozen(PARAMS));
  assert.equal(validateDevelopmentCurveBParams(null), null);
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, rate: 0 }), null);
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, levelExponent: -1 }), null);
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, load: { ...RAW.load, floor: 0 } }), null);
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, load: { ...RAW.load, floor: 1.2 } }), null);
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, load: { ...RAW.load, fullAge: 16 } }), null);
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, potentialCeiling: [1, 0.9, 0.8, 0.7, 0.6, 0.5] }), null, "højere potentiale må ikke give lavere loft");
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, potentialCeiling: [0.5, 1] }), null);
  const noCeiling = validateDevelopmentCurveBParams({ ...RAW, potentialCeiling: undefined });
  assert.equal(noCeiling?.potentialCeiling, null);
});

test("niveau: hvert point koster mere jo højere evnen er", () => {
  let prev = Infinity;
  for (let l = 0; l <= 99; l += 3) {
    const c = curveBLevelCost(l, PARAMS);
    assert.ok(c > 0 && c <= 1);
    assert.ok(c < prev, `niveau ${l}`);
    prev = c;
  }
});

test("belastningsevne: gulv for de helt unge, glidende op, aldrig over 1 (alder er ingen turbo)", () => {
  assert.equal(curveBLoadCapacity(16, PARAMS), RAW.load.floor);
  assert.equal(curveBLoadCapacity(14, PARAMS), RAW.load.floor);
  assert.equal(curveBLoadCapacity(24, PARAMS), 1);
  assert.equal(curveBLoadCapacity(35, PARAMS), 1);
  assert.equal(curveBLoadCapacity(null, PARAMS), 1);
  let prev = 0;
  for (let a = 14; a <= 40; a += 0.5) {
    const l = curveBLoadCapacity(a, PARAMS);
    assert.ok(l >= prev && l <= 1, `alder ${a}`);
    prev = l;
  }
});

test("blødt loft: potentialet skalerer rolleklassens loft, og fremdriften aftager glidende mod det", () => {
  assert.equal(curveBSoftCeiling(90, 6, PARAMS), 90);
  assert.equal(curveBSoftCeiling(90, 1, PARAMS), 45);
  assert.ok(curveBSoftCeiling(90, 3.5, PARAMS) > curveBSoftCeiling(90, 3, PARAMS));
  const ceiling = curveBSoftCeiling(90, 3, PARAMS);
  assert.equal(curveBCapSoftness(ceiling, ceiling, PARAMS), 0);
  assert.equal(curveBCapSoftness(ceiling + 5, ceiling, PARAMS), 0, "over det bløde loft: står stille, falder ikke");
  assert.ok(curveBCapSoftness(ceiling - 1, ceiling, PARAMS) > 0, "ingen mur: et point før loftet er der stadig fremdrift");
});

test("basis: aldrig negativ, 0 på loftet, mindre for de helt unge på samme niveau", () => {
  for (const current of [0, 10, 40, 70, 89, 90, 95]) {
    for (const age of [16, 20, 26, 33]) {
      const b = curveBBase({ current, cap: 90, age, divisor: 28, potentiale: 5 }, PARAMS);
      assert.ok(b >= 0);
      if (current >= 90) assert.equal(b, 0);
    }
  }
  const young = curveBBase({ current: 20, cap: 90, age: 16, divisor: 28, potentiale: 4 }, PARAMS);
  const adult = curveBBase({ current: 20, cap: 90, age: 26, divisor: 28, potentiale: 4 }, PARAMS);
  const older = curveBBase({ current: 20, cap: 90, age: 33, divisor: 28, potentiale: 4 }, PARAMS);
  assert.ok(young < adult);
  assert.equal(adult, older, "efter fuld belastning betyder alderen intet");
});

const deltaArgs = (over: Record<string, unknown> = {}) => ({
  ability: "climbing", current: 30, cap: 85, age: 20, program: resolveProgram(null, "climber"),
  conditionMult: 1, noise: 1, potentiale: 4, primaryType: "climber", secondaryType: null, ...over,
});

test("flag off: udeladt kurve og curveB null er bit-identiske (dagens model)", () => {
  for (const age of [16, 18, 21, 24, 30]) {
    for (const current of [5, 30, 60, 84]) {
      for (const riderQualityMult of [null, 0.8, 1.3]) {
        const a = dailyAbilityDelta(deltaArgs({ age, current, riderQualityMult }));
        const b = dailyAbilityDelta(deltaArgs({ age, current, riderQualityMult, curveB: null }));
        assert.ok(Object.is(a, b), `alder ${age}, niveau ${current}`);
      }
    }
  }
  const tick = {
    riderId: "r1", dateStr: "2026-10-25", age: 19, abilities: abilitiesAt(30), caps: abilitiesAt(80),
    progress: {}, program: resolveProgram(null, "sprinter"), conditionMult: 0.95, potentiale: 3,
    primaryType: "sprinter", secondaryType: null, hardDailyCap: 1,
  };
  assert.deepEqual(applyDailyTick(tick), applyDailyTick({ ...tick, curveB: null }));
  assert.deepEqual(
    applyRaceDevelopmentTick({ ...tick, profileType: "mountain" }),
    applyRaceDevelopmentTick({ ...tick, profileType: "mountain", curveB: null }),
  );
});

test("kurve B i dailyAbilityDelta: alderstabel og ungdomstillæg er ude, kun belastningsevnen bremser", () => {
  const d16 = dailyAbilityDelta(deltaArgs({ age: 16, curveB: PARAMS }));
  const d26 = dailyAbilityDelta(deltaArgs({ age: 26, curveB: PARAMS }));
  const d33 = dailyAbilityDelta(deltaArgs({ age: 33, curveB: PARAMS }));
  assert.ok(d16 < d26, "de helt unge tåler ikke fuld træning");
  assert.equal(d26, d33, "alder er ikke en turbo eller bremse efter fuld belastning");
  // I dag er det omvendt: den unge går hurtigst.
  assert.ok(dailyAbilityDelta(deltaArgs({ age: 16 })) > dailyAbilityDelta(deltaArgs({ age: 26 })));
  // Potentiale = fart.
  const low = dailyAbilityDelta(deltaArgs({ age: 26, potentiale: 2, current: 10, curveB: PARAMS }));
  const high = dailyAbilityDelta(deltaArgs({ age: 26, potentiale: 6, current: 10, curveB: PARAMS }));
  assert.ok(high > low);
});

test("kurve B i applyDailyTick: alders-neutral udvikling, uændret vist score, +1 pr. tick og pr. dato", () => {
  const base = {
    riderId: "r2", dateStr: "2026-10-25", abilities: abilitiesAt(20), caps: abilitiesAt(90),
    progress: Object.fromEntries(VISIBLE_ABILITIES.map((k: string) => [k, 0.99])),
    program: resolveProgram(null, "climber"), conditionMult: 1, potentiale: 5,
    primaryType: "climber", secondaryType: null, hardDailyCap: 1,
  };
  const withCurve = applyDailyTick({ ...base, age: 17, curveB: PARAMS });
  const today = applyDailyTick({ ...base, age: 17 });
  assert.deepEqual(withCurve.trainingScore, today.trainingScore, "den viste træningsscore er den samme");
  const scoreYoung = applyDailyTick({ ...base, age: 25, curveB: { ...PARAMS, rate: 1e6 } });
  for (const n of Object.values(scoreYoung.gains)) assert.ok((n as number) <= 1, "maks +1 pr. evne pr. løbsdag");
  // Datoens anden løbsdag: dato-loftet (#7075) klipper uændret under kurven.
  const second = applyDailyTick({ ...base, abilities: scoreYoung.abilities, progress: scoreYoung.progress, age: 25, tickSeedKey: "s#gd2", curveB: { ...PARAMS, rate: 1e6 } });
  const capped = capTickGainsPerDate({ tickResult: second, abilities: scoreYoung.abilities, usedGains: scoreYoung.gains });
  for (const [k, n] of Object.entries(capped.gains)) assert.ok((n as number) + ((scoreYoung.gains as Record<string, number>)[k] ?? 0) <= 1);
  // Ingen evne falder nogensinde.
  for (const k of VISIBLE_ABILITIES) assert.ok(scoreYoung.abilities[k] >= base.abilities[k]);
});

test("flag: nøglen står i stage-kataloget; kun on tænder; params kræves fra miljøet", async () => {
  assert.ok(STAGE_FLAGS.some((f: { key: string }) => f.key === DEVELOPMENT_CURVE_B_FLAG_KEY));
  const client = (value: unknown) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }) }) }),
  });
  assert.equal(await isDevelopmentCurveBEnabled(client("off")), false);
  assert.equal(await isDevelopmentCurveBEnabled(client("beta")), false, "beta = off (live balance-ændring)");
  assert.equal(await isDevelopmentCurveBEnabled(client(undefined)), false);
  assert.equal(await isDevelopmentCurveBEnabled(client("on")), true);

  const env = { [DEVELOPMENT_CURVE_B_PARAMS_ENV]: JSON.stringify(RAW) };
  const warnings: string[] = [];
  const log = { warn: (m: string) => { warnings.push(m); } };
  assert.equal(await loadDevelopmentCurveB({ supabase: client("off"), env, log }), null);
  assert.deepEqual(await loadDevelopmentCurveB({ supabase: client("on"), env, log }), PARAMS);
  assert.equal(await loadDevelopmentCurveB({ supabase: client("on"), env: {}, log }), null);
  assert.equal(await loadDevelopmentCurveB({ supabase: client("on"), env: { [DEVELOPMENT_CURVE_B_PARAMS_ENV]: "{" }, log }), null);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => !/\d/.test(w)), "tallene logges aldrig");
  assert.equal(curveBParamsFromEnv({ [DEVELOPMENT_CURVE_B_PARAMS_ENV]: JSON.stringify({ ...RAW, rate: -1 }) }), null);
});
