// #6950: koblingen af Udviklingsscore B og catch-up via loeb. Alle tal her er
// syntetiske testvaerdier, ikke kalibreringen (den er privat, hard rule 17).
// Testene laaser koblingens ADFAERD: slukket = intet, taendt = de rigtige argumenter.
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEVELOPMENT_SCORE_V2_FLAG_KEY, DEVELOPMENT_SCORE_V2_PARAMS_ENV,
  validateDevelopmentScoreWiringParams, developmentScoreParamsFromEnv, loadDevelopmentScoreB,
  talentFromPotentiale, developmentScoreDayForTick, developmentTickArgs,
} from "./developmentScoreWiring.js";
import { DEVELOPMENT_SCORE_V2_FLAG_KEY as MODULE_FLAG_KEY } from "./developmentScore.ts";
import {
  RACE_DAY_CATCHUP_FLAG_KEY, RACE_DAY_CATCHUP_PARAMS_ENV, raceCatchUpParamsFromEnv, loadRaceCatchUp, raceCatchUpTickArgs,
} from "./raceCatchUpWiring.js";
import { isStageFlagKey } from "./stageFlagCatalog.js";
import { applyDailyTick } from "./dailyTraining.js";
import { TRAINING_FOCUSES } from "./training.js";
import { raceDayProgram } from "./raceDayYield.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { SCORE_PARAMS, CATCHUP_PARAMS } from "./developmentScoreWiring.fixtures.js";


function flagClient(values = {}) {
  return {
    from() {
      let key;
      return {
        select() { return this; },
        eq(_c, v) { key = v; return this; },
        async maybeSingle() {
          return { data: key in values ? { value: values[key] } : null, error: null };
        },
      };
    },
  };
}

function silentLog() {
  const warnings = [];
  return { warnings, log: { warn: (...a) => warnings.push(a.join(" ")) } };
}

test("#6950: flag-noeglerne staar i kataloget, og scorens noegle er modulets", () => {
  assert.equal(DEVELOPMENT_SCORE_V2_FLAG_KEY, MODULE_FLAG_KEY);
  assert.ok(isStageFlagKey(DEVELOPMENT_SCORE_V2_FLAG_KEY));
  assert.ok(isStageFlagKey(RACE_DAY_CATCHUP_FLAG_KEY));
});

test("#6950: params valideres fail-safe (ugyldigt = null), og gyldige fryses", () => {
  const ok = validateDevelopmentScoreWiringParams(SCORE_PARAMS);
  assert.ok(ok && Object.isFrozen(ok) && Object.isFrozen(ok.talentByPotentiale));
  assert.equal(validateDevelopmentScoreWiringParams(null), null);
  assert.equal(validateDevelopmentScoreWiringParams({ ...SCORE_PARAMS, talentByPotentiale: undefined }), null, "uden talent-tabel ingen score");
  assert.equal(validateDevelopmentScoreWiringParams({ ...SCORE_PARAMS, talentByPotentiale: [1, 2, 3] }), null);
  assert.equal(validateDevelopmentScoreWiringParams({ ...SCORE_PARAMS, talentByPotentiale: [90, 80, 70, 60, 50, 40] }), null, "rangbevarende");
  assert.equal(validateDevelopmentScoreWiringParams({ ...SCORE_PARAMS, score: { ...SCORE_PARAMS.score, midpoint: 0 } }), null);
  assert.equal(developmentScoreParamsFromEnv({}), null);
  assert.equal(developmentScoreParamsFromEnv({ [DEVELOPMENT_SCORE_V2_PARAMS_ENV]: "{not json" }), null);
  assert.ok(developmentScoreParamsFromEnv({ [DEVELOPMENT_SCORE_V2_PARAMS_ENV]: JSON.stringify(SCORE_PARAMS) }));
  assert.equal(raceCatchUpParamsFromEnv({ [RACE_DAY_CATCHUP_PARAMS_ENV]: JSON.stringify({ supplement: 1 }) }), null);
  assert.ok(raceCatchUpParamsFromEnv({ [RACE_DAY_CATCHUP_PARAMS_ENV]: JSON.stringify(CATCHUP_PARAMS) }));
});

test("#6950: loaderne er slukket uden flag, uden params og uden dato-loftet, og logger aldrig tal", async () => {
  const env = {
    [DEVELOPMENT_SCORE_V2_PARAMS_ENV]: JSON.stringify(SCORE_PARAMS),
    [RACE_DAY_CATCHUP_PARAMS_ENV]: JSON.stringify(CATCHUP_PARAMS),
  };
  for (const value of [undefined, "off", "beta", false]) {
    const values = value === undefined ? {} : { [DEVELOPMENT_SCORE_V2_FLAG_KEY]: value, [RACE_DAY_CATCHUP_FLAG_KEY]: value };
    assert.equal(await loadDevelopmentScoreB({ supabase: flagClient(values), env, capPerDateOn: true }), null);
    assert.equal(await loadRaceCatchUp({ supabase: flagClient(values), env, capPerDateOn: true }), null);
  }
  const on = flagClient({ [DEVELOPMENT_SCORE_V2_FLAG_KEY]: "on", [RACE_DAY_CATCHUP_FLAG_KEY]: "on" });
  const missing = silentLog();
  assert.equal(await loadDevelopmentScoreB({ supabase: on, env: {}, log: missing.log, capPerDateOn: true }), null);
  assert.equal(await loadRaceCatchUp({ supabase: on, env: {}, log: missing.log, capPerDateOn: true }), null);
  const noCap = silentLog();
  assert.equal(await loadDevelopmentScoreB({ supabase: on, env, log: noCap.log, capPerDateOn: false }), null);
  assert.equal(await loadRaceCatchUp({ supabase: on, env, log: noCap.log, capPerDateOn: false }), null);
  for (const w of [...missing.warnings, ...noCap.warnings]) {
    assert.ok(!/\d\.\d|supplement|midpoint|talentByPotentiale/.test(w), `advarslen viser ingen tal: ${w}`);
  }
  assert.equal(missing.warnings.length, 2);
  assert.equal(noCap.warnings.length, 2);
  assert.ok(await loadDevelopmentScoreB({ supabase: on, env, capPerDateOn: true }));
  assert.ok(await loadRaceCatchUp({ supabase: on, env, capPerDateOn: true }));
});

test("#6950: strict flag-laesning kaster ved fejl i stedet for at tolke den som slukket", async () => {
  const broken = { from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: { message: "outage" } }; } }) };
  await assert.rejects(loadDevelopmentScoreB({ supabase: broken, strict: true, capPerDateOn: true }), /outage/);
  await assert.rejects(loadRaceCatchUp({ supabase: broken, strict: true, capPerDateOn: true }), /outage/);
});

test("#6950: talentet fra potentialet er rangbevarende og interpolerer halve trin", () => {
  const table = SCORE_PARAMS.talentByPotentiale;
  assert.equal(talentFromPotentiale(1, table), table[0]);
  assert.equal(talentFromPotentiale(6, table), table[5]);
  assert.equal(talentFromPotentiale(3.5, table), (table[2] + table[3]) / 2);
  assert.equal(talentFromPotentiale(null, table), null);
  let prev = -Infinity;
  for (let p = 1; p <= 6; p += 0.5) {
    const t = talentFromPotentiale(p, table);
    assert.ok(t >= prev);
    prev = t;
  }
});

const PARAMS = validateDevelopmentScoreWiringParams(SCORE_PARAMS);
const TICK_ARGS = Object.freeze({
  riderId: "r1", program: { focus: "vo2max", intensity: "hard" }, primaryType: "climber", secondaryType: null,
  potentiale: 4, staff: null, facilityTier: null, riderLevel: "senior",
});

test("#6950: begge slukket = tomt objekt (kaldet i motoren er bit-identisk)", () => {
  assert.deepEqual(developmentTickArgs({ dayKey: "2026-06-12", tickArgs: TICK_ARGS }), {});
  assert.deepEqual(developmentTickArgs({ dayKey: "2026-06-12", tickArgs: TICK_ARGS, racedToday: true, profileType: "mountain" }), {});
});

test("#6950: scoren er deterministisk pr. (rytter, dag), hviledag giver ingen score, loebsdag er kind race", () => {
  const a = developmentScoreDayForTick({ params: PARAMS, ...TICK_ARGS, dayKey: "d1" });
  const b = developmentScoreDayForTick({ params: PARAMS, ...TICK_ARGS, dayKey: "d1" });
  assert.deepEqual(a, b);
  assert.equal(a.kind, "training");
  assert.ok(a.score >= 1 && a.score <= 99);
  assert.equal(developmentScoreDayForTick({ params: PARAMS, ...TICK_ARGS, program: { focus: "vo2max", intensity: "rest" }, dayKey: "d1" }), null);
  const race = developmentTickArgs({ developmentScoreB: PARAMS, dayKey: "d1", tickArgs: TICK_ARGS, racedToday: true, profileType: "mountain" });
  assert.equal(race.developmentScore.kind, "race");
  assert.ok(!("abilityYieldMult" in race), "catch-up slukket: intet tillaeg");
});

test("#6950 S13: traener og facilitet roerer ikke scorens loebsdag, kun traeningsdagen", () => {
  const staff = { overall: 95, dimensions: { physical: 95, mental: 95, technical: 95 }, levels: { senior: 95 } };
  const rich = { ...TICK_ARGS, staff, facilityTier: 3 };
  const raceRich = developmentTickArgs({ developmentScoreB: PARAMS, dayKey: "d1", tickArgs: rich, racedToday: true, profileType: "flat" });
  const racePoor = developmentTickArgs({ developmentScoreB: PARAMS, dayKey: "d1", tickArgs: TICK_ARGS, racedToday: true, profileType: "flat" });
  assert.deepEqual(raceRich.developmentScore, racePoor.developmentScore);
  const trainRich = developmentTickArgs({ developmentScoreB: PARAMS, dayKey: "d1", tickArgs: rich });
  const trainPoor = developmentTickArgs({ developmentScoreB: PARAMS, dayKey: "d1", tickArgs: TICK_ARGS });
  assert.ok(trainRich.developmentScore.score >= trainPoor.developmentScore.score, "traening straffer aldrig");
});

test("#6950 catch-up: kun loebsdage, kun etapens profil-evner, og S13 fjerner pengene fra tick'et", () => {
  const program = raceDayProgram("mountain");
  assert.deepEqual(raceCatchUpTickArgs({ cfg: CATCHUP_PARAMS, racedToday: false, program }), {}, "traeningsdag roeres ikke");
  assert.deepEqual(raceCatchUpTickArgs({ cfg: null, racedToday: true, program }), {});
  const args = raceCatchUpTickArgs({ cfg: CATCHUP_PARAMS, racedToday: true, program });
  assert.equal(args.staff, null);
  assert.equal(args.facilityTier, null);
  for (const ability of VISIBLE_ABILITIES) {
    if (program.focusAbilities.includes(ability)) assert.ok(args.abilityYieldMult[ability] > 1, `${ability} faar tillaegget`);
    else assert.ok(!(ability in args.abilityYieldMult), `${ability} faar basis uaendret`);
  }
  const dnf = raceCatchUpTickArgs({ cfg: CATCHUP_PARAMS, racedToday: true, program, finished: false });
  assert.deepEqual(dnf.abilityYieldMult, {}, "S16: udgaaet rytter faar kun basis");
});

test("#6950: med Udviklingsscore B taendt ejer scoren loebsdagen; catch-up giver intet ekstra (ingen dobbelt-taelling)", () => {
  const both = developmentTickArgs({ developmentScoreB: PARAMS, raceCatchUp: CATCHUP_PARAMS, dayKey: "d1", tickArgs: TICK_ARGS, racedToday: true, profileType: "mountain" });
  const scoreOnly = developmentTickArgs({ developmentScoreB: PARAMS, dayKey: "d1", tickArgs: TICK_ARGS, racedToday: true, profileType: "mountain" });
  assert.deepEqual(both, scoreOnly);
  const catchUpOnly = developmentTickArgs({ raceCatchUp: CATCHUP_PARAMS, dayKey: "d1", tickArgs: TICK_ARGS, racedToday: true, profileType: "mountain" });
  assert.ok(Object.keys(catchUpOnly.abilityYieldMult).length > 0);
  assert.ok(!("developmentScore" in catchUpOnly));
});

// ── applyDailyTick: de to nye argumenter ─────────────────────────────────────
const TICK_BASE = Object.freeze({
  riderId: "r1", dateStr: "2026-06-12", age: 22,
  abilities: Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 50])),
  caps: Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 80])),
  progress: {}, program: { focus: "vo2max", intensity: "hard" }, conditionMult: 0.9, potentiale: 4,
  primaryType: "climber", secondaryType: null,
  staff: { overall: 95, dimensions: { physical: 95, mental: 95, technical: 95 }, levels: { senior: 95 } }, facilityTier: 2, riderLevel: "senior",
});

test("#6950 applyDailyTick: udeladt og null er bit-identisk med i dag", () => {
  const today = applyDailyTick(TICK_BASE);
  assert.deepEqual(applyDailyTick({ ...TICK_BASE, developmentScore: null, abilityYieldMult: null }), today);
  assert.deepEqual(applyDailyTick({ ...TICK_BASE, abilityYieldMult: {} }), today);
});

test("#6950 applyDailyTick S22: devMult er rytter-leddet; kondition og traener paavirker ikke udviklingen", () => {
  const day = { score: 60, devMult: 1.2, kind: "training" };
  const a = applyDailyTick({ ...TICK_BASE, developmentScore: day });
  const b = applyDailyTick({ ...TICK_BASE, developmentScore: day, conditionMult: 0.5, staff: null, facilityTier: null });
  assert.deepEqual(a.progress, b.progress, "S29 + scoren ejer traeneren: samme score = samme udvikling");
  const double = applyDailyTick({ ...TICK_BASE, developmentScore: { ...day, devMult: 2.4 } });
  for (const k of VISIBLE_ABILITIES) {
    const pa = a.progress[k] ?? 0;
    if (pa > 0) assert.ok(Math.abs((double.progress[k] ?? 0) - 2 * pa) < 1e-9, `${k}: dobbelt devMult = dobbelt fremdrift`);
  }
  assert.equal(a.trainingScore.score, 60, "det viste tal er scorens");
  assert.equal(a.trainingScore.contributions, null, "S10: ingen bidrag");
});

test("#6950 applyDailyTick: under scoren taeller intensiteten kun gennem scoren (samme score = samme fokus-udvikling)", () => {
  const day = { score: 60, devMult: 0.2, kind: "training" };
  const hard = applyDailyTick({ ...TICK_BASE, developmentScore: day });
  const easy = applyDailyTick({ ...TICK_BASE, program: { ...TICK_BASE.program, intensity: "easy" }, developmentScore: day });
  const focus = TRAINING_FOCUSES.vo2max;
  assert.ok(focus.length > 0);
  for (const k of focus) assert.ok(Math.abs((hard.progress[k] ?? 0) - (easy.progress[k] ?? 0)) < 1e-12, k);
  // Codex P2 (PR #7194): off-fokus-evnerne maa heller ikke afhaenge af intensiteten.
  const offFocus = VISIBLE_ABILITIES.filter((k) => !focus.includes(k));
  assert.ok(offFocus.some((k) => (hard.progress[k] ?? 0) > 0), "forudsaetning: off-fokus vokser");
  for (const k of offFocus) assert.ok(Math.abs((hard.progress[k] ?? 0) - (easy.progress[k] ?? 0)) < 1e-12, `off-fokus ${k}`);
  const todayHard = applyDailyTick(TICK_BASE);
  const todayEasy = applyDailyTick({ ...TICK_BASE, program: { ...TICK_BASE.program, intensity: "easy" } });
  assert.notDeepEqual(todayHard.progress, todayEasy.progress, "forudsaetning: i dag giver intensiteten forskel");
});

test("#6950 applyDailyTick: catch-up-tillaegget ganges kun paa de evner der staar i kortet", () => {
  const program = raceDayProgram("mountain");
  const base = applyDailyTick({ ...TICK_BASE, program });
  const boosted = applyDailyTick({ ...TICK_BASE, program, abilityYieldMult: { climbing: 1.5 } });
  assert.ok(Math.abs(boosted.progress.climbing - 1.5 * base.progress.climbing) < 1e-9);
  for (const k of VISIBLE_ABILITIES) if (k !== "climbing") assert.equal(boosted.progress[k], base.progress[k]);
});

test("#6950 S14 (Codex P2, PR #7194): under scoren lander loebets tillaeg kun i etapens profil-evner, ogsaa med begge flag on", () => {
  const program = raceDayProgram("mountain");
  const bigBonus = validateDevelopmentScoreWiringParams({
    ...SCORE_PARAMS, score: { ...SCORE_PARAMS.score, race: { ...SCORE_PARAMS.score.race, stageBonus: 1.8 } },
  });
  const raceTick = (params, raceCatchUp = null) => applyDailyTick({
    ...TICK_BASE, program,
    ...developmentTickArgs({ developmentScoreB: params, raceCatchUp, dayKey: "d1", tickArgs: { ...TICK_BASE, program }, racedToday: true, profileType: "mountain" }),
  });
  const offFocus = VISIBLE_ABILITIES.filter((k) => !program.focusAbilities.includes(k));
  assert.ok(offFocus.length > 0);
  for (const catchUp of [null, CATCHUP_PARAMS]) {
    const small = raceTick(PARAMS, catchUp);
    const big = raceTick(bigBonus, catchUp);
    assert.ok(big.trainingScore.score > small.trainingScore.score, "forudsaetning: stoerre tillaeg = hoejere score");
    assert.ok(offFocus.some((k) => (small.progress[k] ?? 0) > 0), "forudsaetning: off-fokus vokser paa loebsdagen");
    for (const k of offFocus) assert.equal(big.progress[k], small.progress[k], `off-fokus ${k} roeres ikke af tillaegget`);
    for (const k of program.focusAbilities) assert.ok((big.progress[k] ?? 0) > (small.progress[k] ?? 0), `profil-evnen ${k} faar tillaegget`);
  }
  // Off-fokus faar praecis basis-dagen (S16's "kun basis"): samme devMult som en udgaaet rytter.
  const args = developmentTickArgs({ developmentScoreB: PARAMS, dayKey: "d1", tickArgs: TICK_ARGS, racedToday: true, profileType: "mountain" });
  const dnf = developmentScoreDayForTick({ params: PARAMS, ...TICK_ARGS, dayKey: "d1", racedToday: true, program, profileType: "mountain", finished: false });
  assert.equal(args.developmentScore.offFocusDevMult, dnf.devMult);
  assert.ok(args.developmentScore.devMult > args.developmentScore.offFocusDevMult);
  // Traeningsdagen har ingen off-fokus-split.
  const training = developmentTickArgs({ developmentScoreB: PARAMS, dayKey: "d1", tickArgs: TICK_ARGS });
  assert.ok(!("offFocusDevMult" in training.developmentScore));
});
