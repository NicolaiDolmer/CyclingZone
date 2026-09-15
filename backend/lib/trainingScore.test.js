// #4851 — traeningsscoren 1-99. Tester de INVARIANTER designet hviler paa,
// ikke de kalibrerede tal (hard rule 17: repoet er offentligt laesbart).

import test from "node:test";
import assert from "node:assert/strict";

import {
  computeTrainingScore, trainingScoreFactors, scoreFromRelativeQuality,
  buildTrainingScoreView, TRAINING_SCORE_CONFIG, SCORE_FACTOR_KEYS,
} from "./trainingScore.js";
import { applyDailyTick, dailyAbilityDelta } from "./dailyTraining.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

const BASE = Object.freeze({
  program: { focus: "tempo", intensity: "normal" },
  age: 26,
  potentiale: 3,
  conditionMult: 1.0,
  noise: 1.0,
  primaryType: "rouleur",
  secondaryType: null,
});

function scoreOf(overrides) {
  return computeTrainingScore({ ...BASE, ...overrides }).score;
}

test("hviledag giver INGEN score — der var intet pas at maale", () => {
  assert.equal(computeTrainingScore({ ...BASE, program: { focus: "tempo", intensity: "rest" } }), null);
  assert.equal(trainingScoreFactors({ ...BASE, program: { focus: "tempo", intensity: "rest" } }), null);
});

test("scoren ligger altid i 1-99", () => {
  // Bevidst ekstreme input i begge retninger.
  const worst = scoreOf({
    program: { focus: "restitution", intensity: "recovery" },
    potentiale: 1, age: 38, conditionMult: 0.7, noise: 0.85, primaryType: "sprinter",
  });
  const best = scoreOf({
    program: { focus: "vo2max", intensity: "hard" },
    potentiale: 6, age: 16, conditionMult: 1.2, noise: 1.15, primaryType: "climber",
    facilityTier: 5,
  });
  for (const s of [worst, best]) {
    assert.ok(Number.isInteger(s), `score skal vaere et heltal, fik ${s}`);
    assert.ok(s >= TRAINING_SCORE_CONFIG.min && s <= TRAINING_SCORE_CONFIG.max, `score ${s} uden for 1-99`);
  }
});

test("gate G4: et gennemfoert pas kan ikke give 0 eller 1, heller ikke paa loftet", () => {
  // Selve defekten i spec §4.1: en rytter hvis fokus-evner staar paa loftet fik
  // score 0 med den gamle kvitterings-score. Scoren kender ikke caps, saa den
  // er uaendret — og evne-deltaerne er 0, praecis som de skal vaere.
  const abilities = {};
  const caps = {};
  for (const k of VISIBLE_ABILITIES) { abilities[k] = 70; caps[k] = 70; }
  const result = applyDailyTick({
    riderId: "r-capped", dateStr: "2026-09-15", age: 26, abilities, caps, progress: {},
    program: { focus: "tempo", intensity: "hard" }, conditionMult: 1.0, bonus: false, potentiale: 4,
    primaryType: "rouleur",
  });
  assert.equal(result.score, 0, "kvitteringen er stadig 0 — der var intet gap at lukke");
  assert.ok(result.trainingScore, "et gennemfoert pas SKAL have en traeningsscore");
  assert.ok(result.trainingScore.score > 1, `G4: score ${result.trainingScore.score} paa et gennemfoert pas`);
});

test("scoren er IKKE cap-afhaengig: samme pas, to vidt forskellige lofter", () => {
  const abilities = {};
  const lowCaps = {};
  const highCaps = {};
  for (const k of VISIBLE_ABILITIES) { abilities[k] = 50; lowCaps[k] = 50; highCaps[k] = 95; }
  const args = {
    riderId: "r-caps", dateStr: "2026-09-15", age: 26, progress: {},
    program: { focus: "tempo", intensity: "hard" }, conditionMult: 1.0, bonus: false,
    potentiale: 4, primaryType: "rouleur",
  };
  const onCap = applyDailyTick({ ...args, abilities, caps: lowCaps });
  const farFromCap = applyDailyTick({ ...args, abilities, caps: highCaps });
  assert.equal(onCap.trainingScore.score, farFromCap.trainingScore.score);
});

test("traening straffer aldrig: bedre traener/facilitet kan ikke saenke scoren", () => {
  const withoutFacility = scoreOf({ program: { focus: "vo2max", intensity: "hard" } });
  const withFacility = scoreOf({ program: { focus: "vo2max", intensity: "hard" }, facilityTier: 5 });
  assert.ok(withFacility >= withoutFacility, `${withFacility} < ${withoutFacility}`);
});

test("monotoni: hver kvalitetsfaktor peger samme vej", () => {
  const hard = scoreOf({ program: { focus: "tempo", intensity: "hard" } });
  const easy = scoreOf({ program: { focus: "tempo", intensity: "easy" } });
  assert.ok(hard > easy, "haardere session skal give hoejere kvalitet end let");

  assert.ok(scoreOf({ potentiale: 6 }) > scoreOf({ potentiale: 1 }), "stoerre talent → hoejere score");
  assert.ok(scoreOf({ conditionMult: 1.2 }) > scoreOf({ conditionMult: 0.8 }), "bedre form → hoejere score");
  assert.ok(scoreOf({ age: 17 }) > scoreOf({ age: 30 }), "ungdomsfaktoren loefter");
});

test("gate G3-kontrasten: haard dag paa frisk rytter m. facilitet > let dag paa traet uden", () => {
  const good = scoreOf({
    program: { focus: "vo2max", intensity: "hard" }, primaryType: "climber",
    conditionMult: 1.15, facilityTier: 4,
  });
  const bad = scoreOf({
    program: { focus: "endurance", intensity: "easy" }, primaryType: "climber",
    conditionMult: 0.78,
  });
  assert.ok(good - bad >= 10, `kontrasten er kun ${good - bad} point — ikke "tydeligt over"`);
});

test("fokus-match: en session der rammer rytterens signatur scorer hoejere", () => {
  const onSignature = scoreOf({ program: { focus: "sprint", intensity: "hard" }, primaryType: "sprinter" });
  const offSignature = scoreOf({ program: { focus: "sprint", intensity: "hard" }, primaryType: "climber" });
  assert.ok(onSignature > offSignature);
});

test("contributions: max 4, sorteret efter stoerrelse, kun kendte faktor-noegler", () => {
  const result = computeTrainingScore({
    ...BASE, program: { focus: "vo2max", intensity: "hard" }, potentiale: 6, age: 18,
    conditionMult: 1.15, primaryType: "climber",
  });
  assert.ok(result.contributions.length <= 4);
  for (const c of result.contributions) {
    assert.ok(SCORE_FACTOR_KEYS.includes(c.key), `ukendt faktor-noegle ${c.key}`);
    assert.ok(c.direction === "up" || c.direction === "down");
    assert.notEqual(c.points, 0);
  }
  for (let i = 1; i < result.contributions.length; i++) {
    assert.ok(Math.abs(result.contributions[i - 1].points) >= Math.abs(result.contributions[i].points));
  }
});

test("kurven maetter: den naar aldrig asymptoten, saa clamp'en er en garanti", () => {
  assert.ok(scoreFromRelativeQuality(1e9) < TRAINING_SCORE_CONFIG.asymptote);
  assert.ok(scoreFromRelativeQuality(1e-9) >= TRAINING_SCORE_CONFIG.min);
  // u = 1 er referencen og rammer midtpunktet.
  assert.equal(Math.round(scoreFromRelativeQuality(1)), TRAINING_SCORE_CONFIG.midpoint);
});

test("nul regression: dailyAbilityDelta uden riderQualityMult er uaendret", () => {
  const args = {
    ability: "tempo", current: 50, cap: 80, age: 26,
    program: { focus: "tempo", intensity: "hard" }, conditionMult: 1.0, bonus: false,
    noise: 1.0, potentiale: 4, primaryType: "rouleur",
  };
  const legacy = dailyAbilityDelta(args);
  // gamma = 0 ⇒ koblingen er inert ⇒ samme tal (paa naer flydende-komma-stoej).
  const inert = dailyAbilityDelta({
    ...args,
    riderQualityMult: computeTrainingScore({
      program: args.program, age: args.age, potentiale: args.potentiale,
      conditionMult: args.conditionMult, noise: args.noise, primaryType: args.primaryType,
    }, { ...TRAINING_SCORE_CONFIG, deltaCoupling: { gamma: 0, normalizer: 1 } }).deltaQualityMult,
  });
  assert.ok(Math.abs(legacy - inert) < 1e-12, `${legacy} vs ${inert}`);
});

test("udviklingen udledes af scoren: hoejere score ⇒ stoerre delta, alt andet lige", () => {
  // Samme rytter, samme gap, samme session — kun konditionen adskiller dem.
  const mk = (conditionMult) => {
    const abilities = {};
    const caps = {};
    for (const k of VISIBLE_ABILITIES) { abilities[k] = 40; caps[k] = 90; }
    return applyDailyTick({
      riderId: "r-coupling", dateStr: "2026-09-15", age: 22, abilities, caps, progress: {},
      program: { focus: "tempo", intensity: "hard" }, conditionMult, bonus: false,
      potentiale: 5, primaryType: "rouleur",
    });
  };
  const sharp = mk(1.18);
  const flat = mk(0.80);
  assert.ok(sharp.trainingScore.score > flat.trainingScore.score);
  assert.ok(sharp.score > flat.score, "hoejere score skal give stoerre samlet udbytte");
});

test("loebsdags-tick'et bruger samme score-kobling som en traeningsdag", async () => {
  const { applyRaceDevelopmentTick } = await import("./dailyTraining.js");
  const abilities = {};
  const caps = {};
  for (const k of VISIBLE_ABILITIES) { abilities[k] = 45; caps[k] = 85; }
  const result = applyRaceDevelopmentTick({
    riderId: "r-race", dateStr: "2026-09-15", age: 25, abilities, caps, progress: {},
    program: { focus: "tempo", intensity: "normal" }, conditionMult: 1.0, bonus: false,
    potentiale: 4, primaryType: "rouleur", profileType: "hilly",
  });
  assert.ok(result.trainingScore, "loebsdagen skal have en intern score (den driver udviklingen)");
  assert.ok(result.trainingScore.score >= 1 && result.trainingScore.score <= 99);
});

// ── buildTrainingScoreView (fladens udsnit) ─────────────────────────────────

test("view: en loebsdags NULL-score forgifter hverken gennemsnit, bedste eller dags-taelleren", () => {
  // Number(null) er 0 — uden en eksplicit null-tjek ville loebsdagen taelle som
  // et nul-pas og traekke gennemsnittet ned.
  const rows = [
    { rider_id: "r1", tick_date: "2026-09-10", score: 60, was_race_day: false },
    { rider_id: "r1", tick_date: "2026-09-11", score: null, was_race_day: true },
    { rider_id: "r1", tick_date: "2026-09-12", score: 80, was_race_day: false },
  ];
  const view = buildTrainingScoreView(rows, { today: "2026-09-12" });
  assert.equal(view.r1.avg, 70, "gennemsnittet maa kun regne paa dage MED et tal");
  assert.equal(view.r1.best, 80);
  assert.equal(view.r1.days, 2, "loebsdagen taeller ikke som en maalt dag");
  assert.deepEqual(view.r1.spark.map((p) => p.score), [60, null, 80], "hullet skal vaere null, ikke 0");
});

test("view: loebsdag som DAGENS raekke giver today = null, ikke 0", () => {
  const rows = [{ rider_id: "r1", tick_date: "2026-09-12", score: null, was_race_day: true }];
  const view = buildTrainingScoreView(rows, { today: "2026-09-12" });
  assert.equal(view.r1.today, null);
  assert.equal(view.r1.todayIsRaceDay, true);
});

test("view: flere loebsdage samme kalenderdato sorteres paa game_day, og 'i dag' er den seneste", () => {
  // Fase B (#4846): den partielle unikke noegle tillader flere game_day pr. dato.
  const rows = [
    { rider_id: "r1", tick_date: "2026-09-12", game_day: 14, score: 70, was_race_day: false },
    { rider_id: "r1", tick_date: "2026-09-12", game_day: 12, score: 40, was_race_day: false },
    { rider_id: "r1", tick_date: "2026-09-12", game_day: 13, score: 55, was_race_day: false },
  ];
  const view = buildTrainingScoreView(rows, { today: "2026-09-12" });
  assert.deepEqual(view.r1.spark.map((p) => p.score), [40, 55, 70], "kurven skal foelge loebsdagen");
  assert.equal(view.r1.today, 70, "'i dag' er den SENESTE loebsdag paa datoen");
});

test("view: tom raekkeliste giver et tomt objekt, ikke et kast", () => {
  assert.deepEqual(buildTrainingScoreView([], { today: "2026-09-12" }), {});
  assert.deepEqual(buildTrainingScoreView(null), {});
});
