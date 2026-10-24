// #6110 / #7114: Udviklingsscore B. Tallene i PARAMS er syntetiske testværdier,
// ikke kalibreringen (den er privat, hard rule 17). Testene låser ADFÆRDEN fra
// spec'en, ikke tallene.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  developmentDay,
  developmentDayFactors,
  devMultFromScore,
  dayNoise,
  talentFactor,
  levelBonusFactor,
  scoreFromRelativeQuality,
  assertDevelopmentScoreParams,
  DEVELOPMENT_SCORE_V2_FLAG_KEY,
  DEVELOPMENT_SCORE_MIN,
  DEVELOPMENT_SCORE_MAX,
} from "./developmentScore.ts";
import type {
  DevelopmentScoreParams,
  TrainingDayInput,
  RaceDayInput,
} from "./developmentScore.ts";

const PARAMS: DevelopmentScoreParams = Object.freeze({
  salt: "test",
  midpoint: 50,
  curve: 1,
  talent: { center: 50, spread: 20, baseWeight: 0.2, disciplineWeight: 0.1 },
  noise: { sigma: 0.2, clip: 2.5 },
  race: {
    stageBonus: 1.3,
    decisionBonus: { decisive: 1.2, finale: 1.1 },
    levelBonus: { max: 0.2, fromGap: -10, peakGap: 5, toGap: 20 },
  },
  devMult: { exponent: 1, normalizer: 1 },
}) as DevelopmentScoreParams;

// Uden støj, så led-sammenligninger er rene.
const QUIET: DevelopmentScoreParams = { ...PARAMS, noise: { sigma: 0, clip: 2.5 } };

const training = (over: Partial<TrainingDayInput> = {}): TrainingDayInput => ({
  kind: "training",
  riderId: "r1",
  dayKey: "2026-10-24",
  talent: { baseTalent: 50, trainingDiscipline: 50 },
  primaryType: "climber",
  secondaryType: null,
  program: { focus: "vo2max_climb", intensity: "hard" },
  ...over,
});

const race = (over: Partial<RaceDayInput> = {}): RaceDayInput => ({
  kind: "race",
  riderId: "r1",
  dayKey: "s5#gd12",
  talent: { baseTalent: 50, trainingDiscipline: 50 },
  primaryType: "climber",
  secondaryType: null,
  profileType: "mountain",
  finished: true,
  decision: "none",
  riderRating: null,
  fieldRating: null,
  ...over,
});

test("flagnøglen er development_score_v2", () => {
  assert.equal(DEVELOPMENT_SCORE_V2_FLAG_KEY, "development_score_v2");
});

test("kontrakten: kun score, devMult og kind (S10: ingen faktorer eller bidrag)", () => {
  const day = developmentDay(training(), PARAMS);
  assert.ok(day);
  assert.deepEqual(Object.keys(day).sort(), ["devMult", "kind", "score"]);
  assert.equal(day.kind, "training");
  assert.ok(Number.isInteger(day.score));
  assert.ok(day.score >= DEVELOPMENT_SCORE_MIN && day.score <= DEVELOPMENT_SCORE_MAX);
  const r = developmentDay(race(), PARAMS);
  assert.ok(r);
  assert.equal(r.kind, "race");
  assert.deepEqual(Object.keys(r).sort(), ["devMult", "kind", "score"]);
});

test("hviledag og ukendt intensitet giver null", () => {
  assert.equal(developmentDay(training({ program: { focus: "endurance", intensity: "rest" } }), PARAMS), null);
  assert.equal(developmentDay(training({ program: { focus: "endurance", intensity: "bogus" } }), PARAMS), null);
  assert.equal(developmentDay(training({ program: {} }), PARAMS), null);
});

test("S22: devMult afledes kun af scoren", () => {
  // To vidt forskellige dage med samme score har samme devMult.
  const seen = new Map<number, number>();
  for (let i = 0; i < 400; i++) {
    const input = i % 2 === 0
      ? training({ riderId: `r${i}`, talent: { baseTalent: 20 + (i % 60) } })
      : race({ riderId: `r${i}`, finished: i % 3 !== 0, decision: "decisive" });
    const day = developmentDay(input, PARAMS);
    assert.ok(day);
    assert.equal(day.devMult, devMultFromScore(day.score, PARAMS));
    if (seen.has(day.score)) assert.equal(seen.get(day.score), day.devMult);
    seen.set(day.score, day.devMult);
  }
  // Monotont: højere score, mindst lige så højt devMult.
  let prev = -Infinity;
  for (let s = DEVELOPMENT_SCORE_MIN; s <= DEVELOPMENT_SCORE_MAX; s++) {
    const m = devMultFromScore(s, PARAMS);
    assert.ok(m >= prev);
    prev = m;
  }
  assert.equal(devMultFromScore(PARAMS.midpoint, PARAMS), 1 / PARAMS.devMult.normalizer);
});

test("S29 + B: form, træthed, kondition og alder påvirker hverken score eller devMult", () => {
  const base = developmentDay(training(), PARAMS);
  const noisy = { ...training(), conditionMult: 0.4, fatigue: 95, form: -20, age: 17 } as TrainingDayInput;
  assert.deepEqual(developmentDay(noisy, PARAMS), base);
  const rBase = developmentDay(race(), PARAMS);
  const rNoisy = { ...race(), conditionMult: 0.4, fatigue: 95, form: -20, age: 34 } as RaceDayInput;
  assert.deepEqual(developmentDay(rNoisy, PARAMS), rBase);
});

test("S13: træner og facilitet påvirker aldrig en løbsdag", () => {
  const staff = { overall: 95, dimensions: { physical: 95 }, levels: { senior: 95 } };
  const plain = developmentDay(race(), PARAMS);
  const rich = { ...race(), staff, facilityTier: 5, riderLevel: "senior" } as RaceDayInput;
  assert.deepEqual(developmentDay(rich, PARAMS), plain);
  const f = developmentDayFactors(rich, PARAMS);
  assert.ok(f);
  assert.equal(f.coach, 1);
  assert.equal(f.facility, 1);
});

test("træning straffer aldrig: træner og facilitet kan kun løfte en træningsdag", () => {
  const staff = { overall: 95, dimensions: { physical: 95 }, levels: { senior: 95 } };
  const plain = developmentDayFactors(training(), QUIET);
  assert.ok(plain);
  for (const tier of [0, 1, 2, 3, 4, 5]) {
    const f = developmentDayFactors(training({ staff, facilityTier: tier, riderLevel: "senior" }), QUIET);
    assert.ok(f);
    assert.ok(f.coach >= 1);
    assert.ok(f.facility >= 1);
    const a = developmentDay(training({ staff, facilityTier: tier, riderLevel: "senior" }), QUIET);
    const b = developmentDay(training(), QUIET);
    assert.ok(a && b && a.score >= b.score);
  }
  const top = developmentDayFactors(training({ staff, facilityTier: 5, riderLevel: "senior" }), QUIET);
  assert.ok(top && top.coach > 1 && top.facility > 1, "en stærk træner på bedste facilitet løfter faktisk");
});

test("S16: udgået rytter får kun basis, uafhængigt af afgørelse og felt", () => {
  const dnf = developmentDay(race({ finished: false }), QUIET);
  const dnfDecisive = developmentDay(race({ finished: false, decision: "decisive", riderRating: 60, fieldRating: 65 }), QUIET);
  assert.deepEqual(dnfDecisive, dnf);
  const finished = developmentDay(race(), QUIET);
  assert.ok(dnf && finished && finished.score > dnf.score);
  const f = developmentDayFactors(race({ finished: false, decision: "decisive" }), QUIET);
  assert.ok(f);
  assert.equal(f.stage, 1);
  assert.equal(f.decision, 1);
  assert.equal(f.level, 1);
});

test("løbsdagens basis er en hård dag over etapens evner", () => {
  const raceBase = developmentDayFactors(race({ finished: false }), QUIET);
  const hard = developmentDayFactors(training({ program: { focus: "vo2max_climb", intensity: "hard" } }), QUIET);
  assert.ok(raceBase && hard);
  assert.equal(raceBase.intensity, hard.intensity);
  // Planen er ikke input: en løbsdag har ingen program-nøgle at læse.
  const explicit = developmentDayFactors(race({ stageAbilities: ["sprint", "flat"] }), QUIET);
  const sprinterOnFlat = developmentDayFactors(race({ primaryType: "sprinter", stageAbilities: ["sprint", "flat"] }), QUIET);
  assert.ok(explicit && sprinterOnFlat);
  assert.ok(sprinterOnFlat.focusMatch > explicit.focusMatch, "terræn-match løfter sprinteren på den flade etape");
});

test("S14: afgørelsen løfter, og 'med i afgørelsen' løfter mest", () => {
  const none = developmentDay(race({ decision: "none" }), QUIET);
  const finale = developmentDay(race({ decision: "finale" }), QUIET);
  const decisive = developmentDay(race({ decision: "decisive" }), QUIET);
  assert.ok(none && finale && decisive);
  assert.ok(finale.score >= none.score);
  assert.ok(decisive.score >= finale.score);
  assert.ok(decisive.score > none.score);
});

test("S14: niveau-bonus er aldrig negativ, glidende, og nul ved alt for let eller alt for hårdt felt", () => {
  const { fromGap, peakGap, toGap, max } = PARAMS.race.levelBonus;
  assert.equal(levelBonusFactor(null, 60, PARAMS), 1);
  assert.equal(levelBonusFactor(60, undefined, PARAMS), 1);
  assert.equal(levelBonusFactor(60, 60 + fromGap - 1, PARAMS), 1, "alt for let felt");
  assert.equal(levelBonusFactor(60, 60 + toGap + 1, PARAMS), 1, "alt for hårdt felt");
  assert.ok(Math.abs(levelBonusFactor(60, 60 + peakGap, PARAMS) - (1 + max)) < 1e-12, "top ved et lidt stærkere felt");
  assert.ok(levelBonusFactor(60, 60, PARAMS) > 1, "bred: eget niveau giver også bonus");
  let prev = levelBonusFactor(60, 60 + fromGap - 5, PARAMS);
  for (let gap = fromGap - 5; gap <= toGap + 5; gap += 0.25) {
    const f = levelBonusFactor(60, 60 + gap, PARAMS);
    assert.ok(f >= 1 && f <= 1 + max + 1e-12);
    assert.ok(Math.abs(f - prev) < 0.02, `ingen trappe ved gap ${gap}`);
    prev = f;
  }
});

test("S11: højere grundtalent og højere træningsdisciplin giver højere score", () => {
  assert.ok(talentFactor({ baseTalent: 80 }, PARAMS) > talentFactor({ baseTalent: 40 }, PARAMS));
  assert.ok(talentFactor({ baseTalent: 50, trainingDiscipline: 80 }, PARAMS) > talentFactor({ baseTalent: 50, trainingDiscipline: 40 }, PARAMS));
  assert.equal(talentFactor({ baseTalent: 50, trainingDiscipline: null }, PARAMS), talentFactor({ baseTalent: 50, trainingDiscipline: 50 }, PARAMS));
  const lo = developmentDay(training({ talent: { baseTalent: 20 } }), QUIET);
  const hi = developmentDay(training({ talent: { baseTalent: 90 } }), QUIET);
  assert.ok(lo && hi && hi.score > lo.score);
});

test("færdighedsdagen trænes højst til håndværks-raten", () => {
  const skill = developmentDayFactors(training({ primaryType: "sprinter", program: { focus: "technique", intensity: "easy" } }), QUIET);
  assert.ok(skill);
  assert.ok(skill.focusMatch <= 1 + 1e-12);
});

test("støjen er deterministisk pr. (rytter, dag), skifter mellem dage og har median 1", () => {
  assert.equal(dayNoise("r1", "2026-10-24", PARAMS), dayNoise("r1", "2026-10-24", PARAMS));
  assert.notEqual(dayNoise("r1", "2026-10-24", PARAMS), dayNoise("r1", "2026-10-25", PARAMS));
  assert.notEqual(dayNoise("r1", "s5#gd12", PARAMS), dayNoise("r1", "s5#gd13", PARAMS));
  const logs: number[] = [];
  const bound = Math.exp(PARAMS.noise.sigma * PARAMS.noise.clip);
  for (let i = 0; i < 4000; i++) {
    const n = dayNoise(`r${i % 50}`, `d${i}`, PARAMS);
    assert.ok(n > 0 && n <= bound + 1e-12 && n >= 1 / bound - 1e-12);
    logs.push(Math.log(n));
  }
  logs.sort((a, b) => a - b);
  assert.ok(Math.abs(logs[logs.length >> 1]) < 0.02, "median ≈ 1");
  assert.equal(dayNoise("r1", "d1", QUIET), 1);
});

test("samme input giver altid samme dag (ren funktion)", () => {
  assert.deepEqual(developmentDay(training(), PARAMS), developmentDay(training(), PARAMS));
  assert.deepEqual(developmentDay(race(), PARAMS), developmentDay(race(), PARAMS));
});

test("skalaen: referencen rammer midpoint, og ekstreme dage holder sig i 1-99", () => {
  assert.equal(Math.round(scoreFromRelativeQuality(1, PARAMS)), PARAMS.midpoint);
  assert.equal(scoreFromRelativeQuality(0, PARAMS), DEVELOPMENT_SCORE_MIN);
  assert.equal(scoreFromRelativeQuality(Number.NaN, PARAMS), DEVELOPMENT_SCORE_MIN);
  assert.ok(scoreFromRelativeQuality(1e9, PARAMS) <= DEVELOPMENT_SCORE_MAX);
  const extreme = { ...PARAMS, noise: { sigma: 3, clip: 3 } };
  for (let i = 0; i < 500; i++) {
    const day = developmentDay(training({ riderId: `x${i}`, talent: { baseTalent: i % 2 ? 99 : 1, trainingDiscipline: i % 2 ? 99 : 1 } }), extreme);
    assert.ok(day && day.score >= DEVELOPMENT_SCORE_MIN && day.score <= DEVELOPMENT_SCORE_MAX);
  }
});

test("params uden standardværdier: ufuldstændige params fejler højt", () => {
  assert.doesNotThrow(() => assertDevelopmentScoreParams(PARAMS));
  const broken: Array<Partial<DevelopmentScoreParams> | null> = [
    null,
    { ...PARAMS, salt: "" },
    { ...PARAMS, midpoint: 0 },
    { ...PARAMS, curve: -1 },
    { ...PARAMS, noise: { sigma: -1, clip: 1 } },
    { ...PARAMS, race: { ...PARAMS.race, stageBonus: 0.9 } },
    { ...PARAMS, race: { ...PARAMS.race, decisionBonus: { decisive: 1.05, finale: 1.1 } } },
    { ...PARAMS, race: { ...PARAMS.race, levelBonus: { max: 0.1, fromGap: 5, peakGap: 0, toGap: 10 } } },
    { ...PARAMS, devMult: { exponent: 1, normalizer: 0 } },
    { ...PARAMS, talent: undefined },
  ];
  for (const p of broken) {
    assert.throws(() => developmentDay(training(), p as DevelopmentScoreParams), /ugyldige params/);
  }
});
