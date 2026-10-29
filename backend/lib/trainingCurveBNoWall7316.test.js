// #7316: kurve B må aldrig fryse en trænet evne over det bløde loft (ingen mur, S2/S8).
// Rodårsag: docs/superpowers/specs/2026-10-29-7316-training-main-ability-rootcause.md §5.
//
// PARAMS er syntetiske testværdier, ikke kalibreringen (den er privat, hard rule 17).
// Fixturerne efterligner spillernes egne eksempler fra rodårsagen (alias, ingen navne):
// en signatur-evne der står over sit bløde loft, men under rolleklassens hårde loft.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ABOVE_CEILING_FLOOR, curveBBase, curveBCapSoftness, curveBSoftCeiling,
  validateDevelopmentCurveBParams,
} from "./developmentCurveB.ts";
import { applyDailyTick, applyRaceDevelopmentTick, dailyAbilityDelta } from "./dailyTraining.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

const RAW = {
  rate: 10, levelExponent: 2, capExponent: 0.5,
  load: { fromAge: 16, fullAge: 24, floor: 0.5 },
  potentialCeiling: [0.2, 0.3, 0.4, 0.5, 0.6, 1],
};
const PARAMS = validateDevelopmentCurveBParams(RAW);
const CAP = 93; // rolleklassens tag for signatur-evner

// Rytter A: punch-program, høj potentiale, signatur-evnen over det bløde loft.
// Rytter B: sprint-program, mellem potentiale. Rytter C: angrebs-program, lavt potentiale.
const FIXTURES = [
  { alias: "A", ability: "punch", current: 80, potentiale: 4.5, primaryType: "puncheur", focus: "vo2max_punch" },
  { alias: "B", ability: "sprint", current: 58, potentiale: 3.5, primaryType: "sprinter", focus: "sprint" },
  { alias: "C", ability: "aggression", current: 42, potentiale: 3, primaryType: "baroudeur", focus: "attack_repeats" },
];

const at = (v) => Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, v]));

function tickFor(f, over = {}) {
  return {
    riderId: `rider-${f.alias}`, dateStr: "2026-10-28", age: 26,
    abilities: { ...at(30), [f.ability]: f.current }, caps: at(CAP), progress: {},
    program: { focus: f.focus, intensity: "hard" }, conditionMult: 1, potentiale: f.potentiale,
    primaryType: f.primaryType, secondaryType: null, hardDailyCap: 1, ...over,
  };
}

test("params: manglende aboveCeilingFloor giver en sikker default > 0; 0 og ugyldigt afvises", () => {
  assert.ok(DEFAULT_ABOVE_CEILING_FLOOR > 0 && DEFAULT_ABOVE_CEILING_FLOOR <= 1);
  assert.equal(PARAMS.aboveCeilingFloor, DEFAULT_ABOVE_CEILING_FLOOR, "params fra miljøet uden feltet virker uden ny env-værdi");
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, aboveCeilingFloor: 0.2 }).aboveCeilingFloor, 0.2);
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, aboveCeilingFloor: 0 }), null, "0 ville give muren tilbage");
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, aboveCeilingFloor: -0.1 }), null);
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, aboveCeilingFloor: 1.5 }), null);
  assert.equal(validateDevelopmentCurveBParams({ ...RAW, aboveCeilingFloor: "0.1" }), null);
});

test("fixturerne står over det bløde loft og under det hårde (ellers tester de intet)", () => {
  for (const f of FIXTURES) {
    const ceiling = curveBSoftCeiling(CAP, f.potentiale, PARAMS);
    assert.ok(f.current >= ceiling && f.current < CAP, `rytter ${f.alias}`);
  }
});

test("træningsdag: hovedevnen over det bløde loft og under cap får fremgang (> 0)", () => {
  for (const f of FIXTURES) {
    const t = tickFor(f, { curveB: PARAMS });
    const r = applyDailyTick(t);
    assert.ok(Number(r.progress[f.ability] ?? 0) > 0 || (r.gains[f.ability] ?? 0) > 0, `rytter ${f.alias}: ${f.ability} står stille`);
    const delta = dailyAbilityDelta({
      ability: f.ability, current: f.current, cap: CAP, age: 26, program: t.program, conditionMult: 1, noise: 1,
      potentiale: f.potentiale, primaryType: f.primaryType, secondaryType: null, curveB: PARAMS,
    });
    assert.ok(delta > 0, `rytter ${f.alias}: delta`);
  }
});

test("monotoni: højere evne = langsommere, også hen over det bløde loft", () => {
  for (const pot of [1, 3, 4.5, 6]) {
    let prev = Infinity;
    for (let current = 0; current < CAP; current += 0.5) {
      const b = curveBBase({ current, cap: CAP, age: 26, divisor: 28, potentiale: pot }, PARAMS);
      assert.ok(b > 0, `pot ${pot}, niveau ${current}: aldrig 0 før det hårde loft`);
      assert.ok(b < prev, `pot ${pot}, niveau ${current}`);
      prev = b;
    }
  }
});

test("kontinuitet: intet spring ved det bløde loft", () => {
  for (const pot of [1, 2.5, 4.5]) {
    const ceiling = curveBSoftCeiling(CAP, pot, PARAMS);
    const eps = 1e-6;
    const below = curveBCapSoftness(ceiling - eps, ceiling, PARAMS, CAP);
    const atCeiling = curveBCapSoftness(ceiling, ceiling, PARAMS, CAP);
    const above = curveBCapSoftness(ceiling + eps, ceiling, PARAMS, CAP);
    assert.ok(Math.abs(below - atCeiling) < 1e-4, `pot ${pot} nedefra`);
    assert.ok(Math.abs(above - atCeiling) < 1e-4, `pot ${pot} ovenfra`);
    assert.equal(atCeiling, PARAMS.aboveCeilingFloor);
    // Over loftet er farten lavere end langt under det.
    assert.ok(curveBCapSoftness(ceiling + 1, ceiling, PARAMS, CAP) < curveBCapSoftness(ceiling * 0.5, ceiling, PARAMS, CAP));
  }
});

test("hårdt loft: 0 på og over rolleklassens loft, både træningsdag og løbsdag", () => {
  for (const current of [CAP, CAP + 2]) {
    assert.equal(curveBBase({ current, cap: CAP, age: 26, divisor: 28, potentiale: 4.5 }, PARAMS), 0);
  }
  const f = FIXTURES[0];
  const r = applyDailyTick(tickFor(f, { abilities: { ...at(30), [f.ability]: CAP }, curveB: PARAMS }));
  assert.equal(r.gains[f.ability], undefined);
  assert.equal(Number(r.progress[f.ability] ?? 0), 0);
  const race = applyRaceDevelopmentTick({ ...tickFor(f, { abilities: at(CAP), curveB: PARAMS }), profileType: "hilly" });
  assert.deepEqual(race.gains, {});
});

test("løbsdag: en evne over det bløde loft får restfarten, ikke 0 (samme regel)", () => {
  const f = FIXTURES[0];
  const t = { ...tickFor(f, { curveB: PARAMS }), abilities: at(f.current), profileType: "hilly" };
  const r = applyRaceDevelopmentTick(t);
  const moved = VISIBLE_ABILITIES.filter((k) => Number(r.progress[k] ?? 0) > 0 || (r.gains[k] ?? 0) > 0);
  assert.ok(moved.length > 0, "løbsdagens point forsvinder ikke over det bløde loft");
});

test("flag off: bit-identisk med i dag (træningsdag og løbsdag)", () => {
  for (const f of FIXTURES) {
    const t = tickFor(f);
    assert.deepEqual(applyDailyTick(t), applyDailyTick({ ...t, curveB: null }));
    const race = { ...t, profileType: "hilly" };
    assert.deepEqual(applyRaceDevelopmentTick(race), applyRaceDevelopmentTick({ ...race, curveB: null }));
  }
});
