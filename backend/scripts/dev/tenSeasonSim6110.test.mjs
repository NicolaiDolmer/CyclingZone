// #6110 S25: tests for 10-saesoners-harnessens rene dele (ingen DB, ingen prod).
import { test } from "node:test";
import assert from "node:assert/strict";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { applyDailyTick, resolveProgram } from "../../lib/dailyTraining.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import {
  SIM_DEFAULTS, curveBRunInputs, sameCurveBRun, xpGateKey, applyPrivateXp, applyTickB, applyTickXp, assistantProgram, birthdateForAge, buildWorld, capGainsPerDate,
  dayXpFloor, estimateGates, expectedTopRating, isTrainNowTeam, limitSnapshotTeams, milestoneStats, nearestPotential,
  orderResults, potentialPeakStats, quantile, raceRoleFor, raceShareForAge, raceSlot, raceVsTraining, renderXpGates,
  riderXpRates, rotatingProgram, runFingerprint, runVariant, runXpGates, talentAttack, typeCareer, variantList,
  variationSeries, veteranStats, xpProgramShares, xpRunInputs, sameXpRun, xpVariant,
  XP_ENGINE_HOOKS, assertPrivateOutDir, cohortFingerprint, dateGainBucket, inflationCheck,
  renderMotorpakke, renderX7, runCohort, topLossCheck, validateRequirements,
  SIM_CALENDAR_ANCHOR, TIME_TRIAL_PROFILES, engineRaceDayXp, engineRaceRider, r16Check, resultCapPerDate, simDateStr, MAX_RACE_INTENTION, raceIntentionMult, variationText,
} from "./tenSeasonSim6110.mjs";
import { developmentXpAbilityDelta, validateDevelopmentXpParams, xpPriceForNextPoint } from "../../lib/developmentXp.ts";
import { developmentXpDayVariation } from "../../lib/developmentXpVariation.ts";
import { xpBestHardSessionTotal } from "../../lib/developmentXpRaceFit.ts";
import { raceDayProgram } from "../../lib/raceDayYield.js";
import { VALID_EFFORTS_FIVE_STEP, effortDevelopmentMultiplier } from "../../lib/raceRoles.js";
import { TRAINING_CONFIG } from "../../lib/training.js";
import { raceDayBudgetDivisor } from "../../lib/trainingRaceDayTick.js";

// Syntetisk normalisering til tests; den rigtige er privat (balance-internals, hard rule 17).
const STUB_B_NORM = () => 1;

const flatAbilities = (v) => Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, v]));

test("capGainsPerDate: klipper til +1 pr. evne pr. dato og baerer resten videre", () => {
  const abilities = { climbing: 40, sprint: 30 };
  const tickResult = {
    abilities: { climbing: 41, sprint: 31 }, progress: { climbing: 0.2, sprint: 0.5 }, gains: { climbing: 1, sprint: 1 },
  };
  const out = capGainsPerDate({ tickResult, abilities, usedGains: { climbing: 1 }, cap: 1 });
  assert.equal(out.abilities.climbing, 40, "climbing har allerede brugt datoens point");
  assert.equal(out.gains.climbing, undefined);
  assert.equal(out.progress.climbing, 1.2, "det klippede point ligger paa baren");
  assert.equal(out.abilities.sprint, 31, "sprint er urørt");
  assert.equal(tickResult.abilities.climbing, 41, "input muteres ikke");
  const same = capGainsPerDate({ tickResult, abilities, usedGains: {}, cap: 1 });
  assert.equal(same, tickResult, "uden klip returneres samme objekt");
});

test("raceSlot: deterministisk, andel 0 giver aldrig loeb, andel 1 altid", () => {
  assert.equal(raceSlot("r1", 5, 3, 0), null);
  const p = raceSlot("r1", 5, 3, 1);
  assert.equal(typeof p, "string");
  assert.equal(raceSlot("r1", 5, 3, 1), p);
  let hits = 0;
  for (let d = 1; d <= 2000; d++) if (raceSlot("r2", 6, d, 0.25)) hits++;
  assert.ok(hits > 400 && hits < 600, `ca. 25 % loebsdage (fik ${hits})`);
});

test("birthdateForAge: rammer sæson-alderen", () => {
  for (const age of [17, 18, 19, 30]) assert.equal(ageForSeason(birthdateForAge(age, 7), 7), age);
});

test("applyTickB: +1-loftet holder, hviledag giver intet, deterministisk", () => {
  const abilities = flatAbilities(20);
  const caps = flatAbilities(80);
  const args = {
    riderId: "r1", seedKey: "s#gd1", abilities, caps, progress: flatAbilities(0.9), program: resolveProgram(null, "climber"),
    potentiale: 6, staff: null, facilityTier: 0, riderLevel: "senior", primaryType: "climber", secondaryType: null,
    budgetDivisor: 1, hardDailyCap: 1, scale: 50, noiseSpan: 0.2, referenceAge: 23,
  };
  const out = applyTickB(args);
  for (const k of VISIBLE_ABILITIES) assert.ok((out.gains[k] ?? 0) <= 1, `${k} stiger hoejst 1`);
  assert.ok(Object.keys(out.gains).length > 0, "en stor skala giver gevinst");
  assert.deepEqual(applyTickB(args), out, "samme seed, samme udfald");
  const rest = applyTickB({ ...args, program: { focus: "endurance", intensity: "rest" } });
  assert.deepEqual(rest.gains, {});
});

test("B-normaliseringen er privat: uden injiceret funktion kaster runVariant (hard rule 17, Codex P1)", () => {
  assert.throws(() => runVariant(syntheticSnapshot(), { name: "nu", kind: "nu", capPerDate: false }, { ...SIM_DEFAULTS, seasons: 1, raceDaysPerSeason: 5 }), /B-normaliseringen mangler/);
});

test("milestoneStats: procent af top ved 22 og 25, kun baner der daekker 22-27", () => {
  const traj = (ratings, startAge) => ratings.map((rating, i) => ({ season: i, age: startAge + i, rating }));
  const riders = [
    { potentiale: 5, trajectory: traj([30, 40, 50, 60, 70, 80, 100, 90], 20) }, // 22 -> 50, 25 -> 80, top ved 26
    { potentiale: 2, trajectory: traj([10, 20], 22) }, // naar ikke 27: udelades
  ];
  const m = milestoneStats(riders);
  assert.equal(m.alle.n, 1);
  assert.equal(m.alle.pct22, 50);
  assert.equal(m.alle.pct25, 80);
  assert.equal(m.alle.peakAgeMedian, 26);
  assert.equal(m["pot5+"].n, 1);
});

test("quantile + orderResults + variantList", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([], 0.5), null);
  const names = orderResults([{ variant: "B@1.25" }, { variant: "nu_maks1" }, { variant: "B@0.75" }, { variant: "nu" }]).map((r) => r.variant);
  assert.deepEqual(names, ["nu", "nu_maks1", "B@0.75", "B@1.25"]);
  const v = variantList({ ...SIM_DEFAULTS, variants: ["nu", "B"], bScales: [1, 2] }).map((x) => x.name);
  assert.deepEqual(v, ["nu", "B@1", "B@2"]);
});

// Lille syntetisk verden: hele kaeden (traening, aldring, pension, nye unge) koerer.
function syntheticSnapshot() {
  const teams = [
    { id: "t1", is_ai: false, is_bank: false, is_test_account: false, division: 1 },
    { id: "t2", is_ai: true, is_bank: false, is_test_account: false, division: 4 },
    { id: "bank", is_ai: true, is_bank: true, is_test_account: false, division: null },
  ];
  const types = ["climber", "sprinter", "puncheur", "rouleur"];
  const riders = [];
  const abilities = [];
  for (let i = 0; i < 24; i++) {
    const age = i === 23 ? 41 : 17 + (i % 20); // én over pensionsgarantien
    const id = `r${i}`;
    riders.push({
      id, birthdate: birthdateForAge(age, 4), potentiale: 1 + (i % 6), primary_type: types[i % 4], secondary_type: null,
      team_id: i < 10 ? "t1" : i < 20 ? "t2" : null, is_academy: false,
    });
    abilities.push({ rider_id: id, ...flatAbilities(15 + (i % 30)), ability_progress: {} });
  }
  return {
    takenAt: "test", season: { id: "s4", number: 4, race_days_total: 28, race_days_completed: 28 },
    riders, abilities, teams, staffByTeam: {}, load: { r0: { raceDays: 70, hardDays: 0 } },
  };
}

test("runVariant: kortet fyldes for en lille verden (nu og B)", () => {
  const opts = { ...SIM_DEFAULTS, seasons: 3, raceDaysPerSeason: 20, bNormalizer: STUB_B_NORM };
  for (const variant of variantList({ ...opts, variants: ["nu_maks1", "B"], bScales: [1] })) {
    const res = runVariant(syntheticSnapshot(), variant, opts);
    assert.equal(res.seasons.length, 3);
    assert.equal(res.transitions.length, 4, "første skifte + ét pr. simuleret sæson");
    assert.ok(res.start.rating.n > 0);
    assert.ok(res.seasons.at(-1).rating.n > 0);
    const retired = res.transitions.reduce((s, t) => s + t.retired, 0);
    assert.ok(retired > 0, "de ældste pensioneres");
  }
});

test("runVariant: et hold udvikler sig med dagens motor (samme tick som produktionen)", () => {
  const snap = syntheticSnapshot();
  const res = runVariant(snap, { name: "nu", kind: "nu", capPerDate: false }, { ...SIM_DEFAULTS, seasons: 1, raceDaysPerSeason: 40, bNormalizer: STUB_B_NORM });
  assert.ok(res.seasons[0].rating.mean >= res.start.rating.mean - 5, "ingen kollaps i første sæson");
  // Sanity: produktionens tick giver gevinst for en ung rytter langt under loftet.
  const ab = flatAbilities(10);
  const caps = buildCapsForRider(ab, { potentiale: 6, age: 18 }, "climber", null);
  let state = { abilities: ab, progress: {} };
  let gained = 0;
  for (let d = 0; d < 60; d++) {
    const r = applyDailyTick({
      riderId: "x", dateStr: null, tickSeedKey: `t#${d}`, age: 18, abilities: state.abilities, caps, progress: state.progress,
      program: resolveProgram(null, "climber"), conditionMult: 1, potentiale: 6, hardDailyCap: 1,
    });
    gained += Object.values(r.gains).reduce((s, n) => s + n, 0);
    state = r;
  }
  assert.ok(gained > 0);
});

test("buildWorld: en rytter uden løbsdage i en hentet sæson har andel 0, ukendt dækning giver null", () => {
  const snap = syntheticSnapshot();
  const world = buildWorld(snap);
  assert.equal(world.riders.find((r) => r.id === "r1").raceShare, 0, "kørte ikke: 0, ikke medianen");
  assert.equal(world.riders.find((r) => r.id === "r0").raceShare, 0.5, "70 af 28 datoer × 5 løbsdage");
  const unknown = buildWorld({ ...snap, load: undefined });
  assert.equal(unknown.riders.find((r) => r.id === "r1").raceShare, null);
});

test("runFingerprint: skifter med billede og sæson-parametre", () => {
  const snap = syntheticSnapshot();
  const a = runFingerprint(snap, SIM_DEFAULTS);
  assert.equal(runFingerprint(snap, { ...SIM_DEFAULTS, bNoiseSpan: 0.9 }), a, "B's støj er pr. variant, ikke i aftrykket");
  assert.notEqual(runFingerprint(snap, { ...SIM_DEFAULTS, raceDaysPerSeason: 140 }), a);
  assert.notEqual(runFingerprint({ ...snap, takenAt: "andet" }, SIM_DEFAULTS), a);
});

// ── XP-varianten (#6110). Tallene er syntetiske; de rigtige er private (hard rule 17). ──

const XP_RAW = Object.freeze({
  price: { base: 20, exponent: 2 },
  potentialXp: [{ at: 1, value: 20 }, { at: 3, value: 60 }, { at: 6, value: 180 }],
  ageShare: {
    physical: [{ at: 28, value: 1 }, { at: 34, value: 0.2 }],
    mental: [{ at: 32, value: 1 }, { at: 38, value: 0.2 }],
  },
  offFocusShare: 0.1,
  raceOffFocusShare: 0.2,
  typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
});
const XP = validateDevelopmentXpParams(XP_RAW);
// Motorens dagsvariation i prøverne. Nøglen er sat sammen af dele, så hemmeligheds-scanneren
// ikke tager en prøvetekst for en rigtig nøgle; den rigtige findes kun i private_config.
const TEST_VARIATION = Object.freeze({
  key: ["sim-7757", "kun-til-proever", "ikke-en-rigtig-noegle", "0123456789"].join("-"), span: 0.5, memory: 0,
});
const XP_RAW_VAR = Object.freeze({ ...XP_RAW, variation: TEST_VARIATION });
const XP_OPTS = { ...SIM_DEFAULTS, seasons: 3, raceDaysPerSeason: 20, bNormalizer: STUB_B_NORM, xp: XP_RAW };

test("assistantProgram: bruger det katalog, der er live", () => {
  const tt = assistantProgram("tt", null);
  assert.equal(tt.focus, "itt_long", "en enkeltstartsrytter uden plan træner enkeltstart under v3");
  assert.ok(tt.focusAbilities.includes("time_trial"));
  assert.equal(assistantProgram("climber", null, { intensity: "hard" }).intensity, "hard");
  const first = rotatingProgram("sprinter", null, 0);
  const second = rotatingProgram("sprinter", null, 1);
  assert.notEqual(first.focus, second.focus, "planen skifter fra dato til dato");
  assert.equal(rotatingProgram("sprinter", null, 4).focus, first.focus, "og kommer rundt");
});

test("xpProgramShares: mest i fokus, lidt i resten, intet på hvile, restitution kun i egen evne", () => {
  const ctx = { primaryType: "climber", secondaryType: "puncheur", xp: XP };
  const shares = xpProgramShares({ focus: "vo2max_climb", intensity: "hard" }, ctx);
  assert.equal(shares.climbing, 2, "signatur, vægt 2, hård dag");
  assert.ok(shares.sprint > 0 && shares.sprint < 0.2, "lidt i resten");
  const normal = xpProgramShares({ focus: "vo2max_climb", intensity: "normal" }, ctx);
  assert.ok(normal.climbing < shares.climbing);
  assert.ok(Math.abs(normal.sprint / normal.climbing - shares.sprint / shares.climbing) < 1e-12, "forholdet følger ikke intensiteten");
  assert.deepEqual(xpProgramShares({ focus: "vo2max_climb", intensity: "rest" }, ctx), {});
  const recovery = xpProgramShares({ focus: "restitution", intensity: "recovery" }, ctx);
  assert.deepEqual(Object.keys(recovery), ["recovery"]);
  const race = xpProgramShares({ focus: "race_day", intensity: "hard", focusAbilities: ["climbing"] }, { ...ctx, raceDay: true });
  const training = xpProgramShares({ focus: "race_day", intensity: "hard", focusAbilities: ["climbing"] }, ctx);
  assert.ok(race.sprint > training.sprint, "løbsdagen har sin egen off-fokus-andel");
  const skill = xpProgramShares({ focus: "loebslaere", intensity: "normal" }, { primaryType: "baroudeur", secondaryType: null, xp: XP });
  const full = xpProgramShares({ focus: "attack_repeats", intensity: "normal" }, { primaryType: "baroudeur", secondaryType: null, xp: XP });
  assert.ok(skill.aggression < full.aggression, "en færdighedsdag træner højst til håndværks-raten");
});

test("applyTickXp: +1 pr. dato holder, XP bæres videre, input muteres ikke, samme input giver samme tick (G8)", () => {
  const abilities = Object.freeze(flatAbilities(30));
  const args = {
    abilities, progress: Object.freeze({ climbing: 0.9 }), shares: { climbing: 1, tactics: 1 }, rates: { physical: 1e6, mental: 1e6 }, xp: XP,
  };
  const out = applyTickXp(args);
  assert.equal(out.gains.climbing, 1);
  assert.equal(out.abilities.climbing, 31);
  assert.ok(out.progress.climbing > 1, "det klippede ligger på bjælken");
  assert.equal(abilities.climbing, 30);
  assert.deepEqual(applyTickXp(args), out);
  const used = applyTickXp({ ...args, usedGains: { climbing: 1 } });
  assert.equal(used.gains.climbing, undefined, "datoens point er brugt");
  assert.equal(used.abilities.climbing, 30);
  const later = applyTickXp({ ...args, progress: { climbing: 2.5 }, shares: {} });
  assert.equal(later.gains.climbing, 1, "en bar over 1 betales ud uden ny XP");
  assert.equal(applyTickXp({ ...args, progress: {}, rates: { physical: 1, mental: 1 }, ticksPerDate: 5 }).earned, 0.4);
});

test("applyTickXp: mentale evner bruger deres egen sats", () => {
  const out = applyTickXp({
    abilities: flatAbilities(30), progress: {}, shares: { climbing: 1, tactics: 1 }, rates: { physical: 0, mental: 5 }, xp: XP,
  });
  assert.equal(out.progress.climbing, undefined);
  assert.ok(out.progress.tactics > 0);
});

test("riderXpRates + kørslens kalender: mentale evner længst, datoerne er faste og i forlængelse", () => {
  assert.ok(riderXpRates({ potentiale: 3, age: 33 }, XP).mental > riderXpRates({ potentiale: 3, age: 33 }, XP).physical);
  assert.equal(simDateStr(0, 0, 32), SIM_CALENDAR_ANCHOR);
  assert.equal(simDateStr(5, 3, 32), simDateStr(5, 3, 32), "ingen ur");
  assert.equal(simDateStr(5, 31, 32), "2030-07-11");
  assert.equal(simDateStr(6, 0, 32), "2030-07-12","næste sæson fortsætter dagen efter, så hukommelsen bæres over skiftet");
});

test("xpVariant: navnet vælger plan og bonus, private varianter lægger tal ovenpå, uden params kaster den", () => {
  assert.throws(() => xpVariant("xp", SIM_DEFAULTS), /XP-params mangler/);
  assert.equal(xpVariant("xp", XP_OPTS).plan, "standard");
  assert.equal(xpVariant("xp_rot", XP_OPTS).plan, "rotate");
  assert.equal(xpVariant("xp_hard", XP_OPTS).intensity, "hard");
  assert.equal(xpVariant("xp_bonus15", XP_OPTS).trainNowBonus, 0.15);
  const custom = xpVariant("xp_lav", { ...XP_OPTS, xpVariants: { xp_lav: { xp: { offFocusShare: 0.05 } } } });
  assert.equal(custom.xpParams.offFocusShare, 0.05);
  assert.deepEqual(variantList({ ...XP_OPTS, variants: ["kurveB", "xp", "xp_bonus10"] }).map((v) => v.kind), ["curveB", "xp", "xp"]);
  assert.deepEqual(orderResults([{ variant: "xp" }, { variant: "kurveB" }, { variant: "nu" }]).map((r) => r.variant), ["nu", "kurveB", "xp"]);
});

test("applyPrivateXp: de private tal lander på kørslens opts, og ugyldig kurve kaster", () => {
  const opts = applyPrivateXp({ ...SIM_DEFAULTS }, { xp: XP_RAW_VAR, sim: { raceShareByAge: [{ maxAge: 99, share: 0.2 }] } });
  assert.equal(xpVariant("xp", opts).xpParams.variation.span, 0.5, "variationen kommer fra xp.variation, som i motoren");
  assert.match(variationText(opts), /±0\.5, hukommelse 0/);
  assert.ok(!variationText(opts).includes(TEST_VARIATION.key), "nøglen står aldrig på kortet");
  assert.match(variationText({ xp: XP_RAW }), /ingen/, "uden xp.variation er der ingen variation, som i motoren");
  assert.equal(opts.raceShareByAge.length, 1);
  assert.notEqual(runFingerprint({ takenAt: "x" }, opts), runFingerprint({ takenAt: "x" }, SIM_DEFAULTS), "en anden løbsandel er en anden kørsel");
  assert.throws(() => applyPrivateXp({ ...SIM_DEFAULTS }, { xp: XP_RAW, sim: { curveBLive: { rate: -1 } } }), /ugyldige/);
});

test("raceShareForAge og raceRoleFor: tabellen og fordelingen følges", () => {
  const table = [{ maxAge: 19, share: 0.1 }, { maxAge: 99, share: 0.3 }];
  assert.equal(raceShareForAge(18, table), 0.1);
  assert.equal(raceShareForAge(40, table), 0.3);
  assert.equal(raceRoleFor("r", 5, 1, null), "free_role");
  const roles = [{ role: "captain", share: 0.25 }, { role: "helper", share: 0.75 }];
  let captains = 0;
  for (let d = 0; d < 2000; d++) if (raceRoleFor("r", 5, d, roles) === "captain") captains += 1;
  assert.ok(captains > 400 && captains < 600, `ca. 25 % (fik ${captains})`);
});

test("isTrainNowTeam: aldrig AI-hold, ca. halvdelen af managerholdene", () => {
  assert.equal(isTrainNowTeam({ id: "t", isAi: true }), false);
  assert.equal(isTrainNowTeam(null), false);
  let hits = 0;
  for (let i = 0; i < 1000; i++) if (isTrainNowTeam({ id: `t${i}`, isAi: false })) hits += 1;
  assert.ok(hits > 420 && hits < 580, `fik ${hits}`);
});

test("runVariant: XP-pakken kører hele kæden, +1 pr. dato holder, ingen rating falder i sæsonen", () => {
  const res = runVariant(syntheticSnapshot(), xpVariant("xp", XP_OPTS), XP_OPTS);
  assert.equal(res.seasons.length, 3);
  assert.equal(res.gates.capViolations, 0);
  assert.equal(res.gates.inSeasonRatingDrops, 0);
  assert.equal(res.gates.pointsPerSeason.length, 3);
  assert.ok(res.gates.pointsPerSeason[0] > 0);
  assert.ok(res.transitions.reduce((s, t) => s + t.retired, 0) > 0, "de ældste pensioneres");
  assert.deepEqual(res.params.xp, XP);
  assert.deepEqual(runVariant(syntheticSnapshot(), xpVariant("xp", XP_OPTS), XP_OPTS).seasons, res.seasons, "samme seeds, samme udfald");
});

test("runVariant: bonus giver mere til dem, der trykker, og intet til resten", () => {
  const base = runVariant(syntheticSnapshot(), xpVariant("xp", XP_OPTS), XP_OPTS);
  const bonus = runVariant(syntheticSnapshot(), xpVariant("xp_bonus25", XP_OPTS), XP_OPTS);
  const sum = (r) => r.gates.pointsPerSeason.reduce((s, x) => s + x, 0);
  assert.ok(sum(bonus) >= sum(base));
});

test("runVariant: roterende plan og hård plan kører, og hårde dage tæller i sæsonfaldet", () => {
  for (const name of ["xp_rot", "xp_hard"]) {
    const res = runVariant(syntheticSnapshot(), xpVariant(name, XP_OPTS), XP_OPTS);
    assert.equal(res.gates.capViolations, 0, name);
  }
});

test("runVariant: løbsandel efter alder afløser en sæson uden målte løb", () => {
  const snap = { ...syntheticSnapshot(), load: null };
  const opts = { ...XP_OPTS, raceShareByAge: [{ maxAge: 99, share: 1 }], raceRoles: [{ role: "captain", share: 1 }], raceRoleYield: { stageBonus: 0.5, leadShare: 0.5 } };
  const res = runVariant(snap, xpVariant("xp", opts), opts);
  assert.ok(res.gates.abilityPoints.leadership > 0, "kaptajner får lederskab gennem løb");
});

test("Codex: rolletillægget regnes i XP's forhold, og rollen kan styre basis-dagen", () => {
  const world = buildWorld(syntheticSnapshot());
  const yieldParams = { stageBonus: 0.5, leadShare: 0.5 };
  const base = raceVsTraining(world, 4, XP, { ...XP_OPTS, raceRoleYield: yieldParams }, { sample: 3 });
  const roleBase = raceVsTraining(world, 4, XP, { ...XP_OPTS, raceRoleYield: { ...yieldParams, roleDrivesBaseDay: true } }, { sample: 3 });
  assert.notDeepEqual(base.ratio.helper, roleBase.ratio.helper, "hjælperens basis-dag følger rollen");
});

test("Codex: en XP-kørsel med andre løbsroller, bonus eller variation må ikke på samme kort", () => {
  const variant = xpVariant("xp", XP_OPTS);
  const a = xpRunInputs(variant, XP_OPTS);
  // Variationen står i XP-tallene (params.xp), som kortet sammenligner sammen med xpRun.
  assert.notEqual(JSON.stringify(xpVariant("xp", { ...XP_OPTS, xp: XP_RAW_VAR }).xpParams), JSON.stringify(variant.xpParams));
  assert.notDeepEqual(a, xpRunInputs(variant, { ...XP_OPTS, raceRoles: [{ role: "captain", share: 1 }] }));
  assert.notDeepEqual(a, xpRunInputs(xpVariant("xp_bonus10", XP_OPTS), XP_OPTS));
  assert.deepEqual(runVariant(syntheticSnapshot(), variant, XP_OPTS).params.xpRun, a);
});

test("Codex P2: en ny variationsnøgle (samme bredde og hukommelse) giver andet fingeraftryk uden at afsløre nøglen", () => {
  const other = { ...TEST_VARIATION, key: TEST_VARIATION.key.replace("kun-til", "kun-tit") };
  const a = xpRunInputs(xpVariant("xp", { ...XP_OPTS, xp: XP_RAW_VAR }), { ...XP_OPTS, xp: XP_RAW_VAR });
  const b = xpRunInputs(xpVariant("xp", { ...XP_OPTS, xp: { ...XP_RAW, variation: other } }), XP_OPTS);
  assert.ok(a.variation && b.variation);
  assert.notEqual(a.variation, b.variation);
  assert.ok(!JSON.stringify(a).includes(TEST_VARIATION.key));
  assert.equal("variation" in xpRunInputs(xpVariant("xp", XP_OPTS), XP_OPTS), false, "uden variation er feltet udeladt");
  const gate = (xp) => xpGateKey({ fingerprint: "f", opts: { ...XP_OPTS, xp } });
  assert.notEqual(gate(XP_RAW_VAR), gate({ ...XP_RAW, variation: other }), "gate-nøglen skifter også med nøglen");
  // En gemt kørsel med den gamle nøgle må ikke på kortet, når nøglen er skiftet.
  const saved = runVariant(syntheticSnapshot(), xpVariant("xp", { ...XP_OPTS, xp: XP_RAW_VAR }), { ...XP_OPTS, xp: XP_RAW_VAR });
  assert.equal(sameXpRun(saved, { ...XP_OPTS, xp: XP_RAW_VAR }), true);
  assert.equal(sameXpRun(saved, { ...XP_OPTS, xp: { ...XP_RAW, variation: other } }), false);
});

test("Codex P2: en gemt kørsel med udgået variant (_gulv) springes over i stedet for at kaste", () => {
  assert.throws(() => xpVariant("xp_gulv", XP_OPTS), /_gulv/, "nyt ønsket setup afvises stadig");
  const good = runVariant(syntheticSnapshot(), xpVariant("xp", XP_OPTS), XP_OPTS);
  assert.equal(sameXpRun(good, XP_OPTS), true);
  assert.equal(sameXpRun({ ...good, variant: "xp_bonus15_gulv_nocap" }, XP_OPTS), false);
});

test("X9 (Fable-dom 15/11, fund 4): dommen bruger motorens variation; angrebsbredder er mærkede udforskninger uden for dommen", () => {
  const snap = syntheticSnapshot();
  const base = { estimateParams: ESTIMATE_PARAMS, knowledge: [], sampleRiders: 5 };
  const seen = [];
  const hooks = { ...XP_ENGINE_HOOKS, dayVariation: (args, variation) => {
    const mult = XP_ENGINE_HOOKS.dayVariation(args, variation);
    seen.push({ ...args, mult, variation });
    return mult;
  } };
  const varOpts = { ...XP_OPTS, xp: XP_RAW_VAR, engineHooks: hooks };
  const withVar = runXpGates(snap, varOpts, base);
  assert.deepEqual(Object.keys(withVar.x9.attack), ["motor"], "dommen har kun motorens variation");
  assert.deepEqual(withVar.x9.explore, {}, "ingen udforskning uden private angrebsbredder");
  assert.ok(seen.length > 0, "X9 kalder motorens dagsvariation");
  const params = xpVariant("xp", varOpts).xpParams;
  for (const s of seen.slice(0, 20)) {
    assert.match(s.dateStr, /^\d{4}-\d{2}-\d{2}$/, "en rigtig dato, som i motoren");
    assert.equal(s.mult, developmentXpDayVariation({ riderId: s.riderId, dateStr: s.dateStr }, params.variation));
  }
  assert.ok(seen.some((s) => s.mult !== 1), "med xp.variation svinger dagene");
  // Uden xp.variation er dagen 1 i motoren, også i X9.
  seen.length = 0;
  runXpGates(snap, { ...XP_OPTS, engineHooks: hooks }, base);
  assert.ok(seen.length > 0 && seen.every((s) => s.mult === 1));
  // Private angrebsbredder flytter aldrig dommen; de står mærket i explore.
  const explored = runXpGates(snap, { ...varOpts, xpAttackSpans: [0.05, 0.9], xpAttackMemories: [0.9] }, base);
  assert.deepEqual(explored.x9.attack, withVar.x9.attack, "udforskningerne rører ikke dommen");
  assert.deepEqual(Object.keys(explored.x9.explore), ["span0.05-mem0.9", "span0.9-mem0.9"]);
  const card = renderXpGates(snap, [], explored, varOpts, "test");
  assert.match(card, /Angreb, motorens variation \(dommen\)/);
  assert.match(card, /X9 udforskning \(ikke en del af tændingsdommen\)/);
  assert.match(card, /\| udforskning span0\.9-mem0\.9 \|/);
});

test("potentialPeakStats og veteranStats:måler karrierens top og om veteraner stiger", () => {
  const riders = [
    { potentiale: 2.5, inflow: true, trajectory: [{ season: 6, age: 26, rating: 30 }, { season: 7, age: 27, rating: 40 }] },
    { potentiale: 5, start: { age: 30, rating: 50 }, trajectory: [{ season: 8, age: 33, rating: 52 }, { season: 10, age: 35, rating: 49 }] },
    { potentiale: 2, start: { age: 20, rating: 20 }, trajectory: [{ season: 6, age: 21, rating: 25 }] },
  ];
  const peak = potentialPeakStats(riders);
  assert.equal(peak[2].n, 1, "banen skal nå 27");
  assert.equal(peak[2].max, 40);
  assert.equal(peak[5], undefined, "startede ikke ung");
  const vet = veteranStats(riders, 5)["29-34 rating 50+"];
  assert.deepEqual(vet.efter3, { n: 1, stiger: 1, medianDelta: 2 });
  assert.deepEqual(vet.efter5, { n: 1, stiger: 0, medianDelta: -1 });
});

test("expectedTopRating: aldrig under nuværende rating, højere potentiale når mindst lige så højt", () => {
  const rider = { id: "r", abilities: flatAbilities(30), age: 20, primary_type: "climber", secondary_type: null };
  const low = expectedTopRating({ ...rider, potentiale: 1 }, XP, { datesPerSeason: 8 });
  const high = expectedTopRating({ ...rider, potentiale: 6 }, XP, { datesPerSeason: 8 });
  assert.ok(low >= 30 - 1);
  assert.ok(high > low);
  const old = expectedTopRating({ ...rider, potentiale: 3, age: 40 }, XP);
  assert.ok(old >= 29, "uden år tilbage er toppen dagens niveau");
});

test("typeCareer: signaturen når højere end en svaghed, samme session, samme potentiale", () => {
  const spec = { session: "vo2max_climb", potentiale: 6, startLevel: 20, seasons: 12, ability: "climbing" };
  const climber = typeCareer({ ...spec, primaryType: "climber", secondaryType: null }, XP, SIM_DEFAULTS);
  const sprinter = typeCareer({ ...spec, primaryType: "sprinter", secondaryType: null }, XP, SIM_DEFAULTS);
  assert.ok(climber.after10 > sprinter.after10);
  assert.ok(sprinter.after10 > 20, "alt kan trænes");
});

test("dayXpFloor og raceVsTraining: hele dagen giver XP, løb måles mod hård dag", () => {
  const world = buildWorld(syntheticSnapshot());
  const floor = dayXpFloor(world, 4, XP);
  assert.ok(floor.riders > 0 && floor.dayTotalMin > 0 && floor.focusAbilityMin > 0);
  const race = raceVsTraining(world, 4, XP, { ...XP_OPTS, raceRoleYield: { stageBonus: 0.5, leadShare: 0.5 } }, { sample: 5 });
  assert.ok(race.checks > 0);
  assert.equal(race.underHardNoStaff, 0, "uden træner slår løbet en hård dag");
  assert.ok(race.ratio.leader.min >= 1);
});

const ESTIMATE_PARAMS = Object.freeze({
  salt: "test", weights: { shared: 0.6, pair: 0.6, level: Math.sqrt(0.28) }, clip: 2, minU: 0.5,
  words: { sureAtOrBelow: 2, fairAtOrBelow: 5 },
  scout: { maxLooks: 3, defaultTier: 3, uByLooks: [8, 6, 4], tierFactor: [1.2, 1.1, 1, 0.9, 0.8] },
  own: { firstEstimateDates: 3, staffSpeedWeight: 0.2, steps: [{ fromDates: 3, u: 7 }, { fromDates: 10, u: 4 }, { fromDates: 30, u: 1.5 }] },
});

test("variationSeries og nearestPotential: hukommelse giver perioder, opslaget rammer tabellen", () => {
  const free = variationSeries("k", 400, 0.5, 0);
  const sticky = variationSeries("k", 400, 0.5, 0.95);
  const jump = (s) => s.slice(1).reduce((sum, x, i) => sum + Math.abs(x - s[i]), 0);
  assert.ok(jump(sticky) < jump(free), "gode og dårlige perioder flytter sig langsommere");
  assert.ok(free.every((x) => x >= 0.5 && x <= 1.5));
  assert.deepEqual(variationSeries("k", 5, 0.5, 0.9), variationSeries("k", 5, 0.5, 0.9));
  const steps = [{ potentiale: 1, xp: 10 }, { potentiale: 2, xp: 20 }, { potentiale: 3, xp: 40 }];
  assert.equal(nearestPotential(11, steps), 1);
  assert.equal(nearestPotential(35, steps), 3);
});

test("talentAttack: bredere variation gør aflæsningen dårligere, og skønnet står ved siden af", () => {
  const rows = Array.from({ length: 60 }, (_, i) => {
    const potentiale = 1 + (i % 3) * 2;
    return { id: `r${i}`, potentiale, truth: potentiale * 10, truthByPotential: { 1: 10, 3: 30, 5: 50 } };
  });
  const out = talentAttack(rows, XP, ESTIMATE_PARAMS, { dateSteps: [5, 30], explore: { spans: [0.05, 0.9], memories: [0] }, potentials: [1, 3, 5] });
  assert.equal(out.explore["span0.05-mem0"][30].exactPct, 100);
  assert.ok(out.explore["span0.9-mem0"][5].exactPct <= out.explore["span0.05-mem0"][5].exactPct);
  assert.equal(out.attack.motor[30].exactPct, 100, "uden xp.variation læses potentialet præcist af motorens dag");
  assert.ok(out.estimate[5].p50 >= out.estimate[30].p50, "skønnet bliver bedre med tiden");
});

test("estimateGates: H1, H2, H3 og H6 regner på det nye sande tal", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, rating: 20, truth: 40 + (i % 30) }));
  const knowledge = rows.map((r, i) => (i % 2
    ? { rider_id: r.id, team_id: "t", own: true, trainingDates: 40, coachTier: 1, facilityTier: 1 }
    : { rider_id: r.id, team_id: "t", own: false, looks: 2, bestScoutTier: 3 }));
  const out = estimateGates(rows, knowledge, ESTIMATE_PARAMS);
  assert.equal(out.h2Unstable, 0);
  assert.equal(out.h3MeanBreaks, 0);
  assert.ok(out.h1.own.sure.n > 0);
  assert.ok(out.h6.hold10.p50 != null && out.h6.toNiveauer.bedsteP50 != null);
});

test("runXpGates + renderXpGates: kortet bygges af varianter og gates, uden at røre prod", () => {
  const snap = syntheticSnapshot();
  const gates = runXpGates(snap, XP_OPTS, { estimateParams: ESTIMATE_PARAMS, knowledge: [], sampleRiders: 5 });
  assert.ok(Object.keys(gates.x4).length > 0);
  assert.ok(gates.truth.riders > 0);
  assert.ok(gates.x9.attack);
  const results = [
    runVariant(snap, { name: "kurveB-stub", kind: "nu", capPerDate: true }, XP_OPTS),
    runVariant(snap, xpVariant("xp", XP_OPTS), XP_OPTS),
    runVariant(snap, xpVariant("xp_bonus10", XP_OPTS), XP_OPTS),
  ];
  const card = renderXpGates(snap, results, gates, XP_OPTS, "test");
  for (const heading of ["X1", "X2", "X3", "X4", "X5", "X6", "X7", "X8", "X9", "X10", "Træn nu", "Kalibrering"]) assert.ok(card.includes(heading), heading);
  assert.ok(xpPriceForNextPoint(10, XP) > 0);
});

test("sameCurveBRun: en gemt kurve B med andre roller eller rolletillæg kommer ikke på kortet", () => {
  const opts = { curveB: { a: 1 }, raceRoles: { captain: 0.2 }, raceRoleYield: { bonus: 1 } };
  const saved = { variant: "kurveB", params: { curveB: { a: 1 }, curveBRun: curveBRunInputs(opts) } };
  assert.equal(sameCurveBRun(saved, opts), true);
  assert.equal(sameCurveBRun(saved, { ...opts, raceRoles: { captain: 0.3 } }), false);
  assert.equal(sameCurveBRun(saved, { ...opts, raceRoleYield: { bonus: 2 } }), false);
  assert.equal(sameCurveBRun(saved, { ...opts, curveB: { a: 2 } }), false);
  assert.equal(sameCurveBRun({ variant: "kurveB", params: { curveB: { a: 1 } } }, opts), false, "gamle filer uden roller er ugyldige");
  assert.equal(sameCurveBRun({ variant: "nu", params: {} }, opts), true);
});

test("xpGateKey: alle gate-input ugyldiggør de gemte tal", () => {
  const opts = { ...XP_OPTS, xpAttackSpans: [1], xpAttackMemories: [2], curveB: { a: 1 }, raceRoles: { c: 1 }, raceRoleYield: { b: 1 } };
  const args = { fingerprint: "f", opts, estimateParams: { e: 1 }, knowledge: { k: 1 } };
  const base = xpGateKey(args);
  assert.equal(xpGateKey(args), base);
  for (const change of [{ xpAttackSpans: [9] }, { xpAttackMemories: [9] }, { curveB: { a: 2 } }, { raceRoles: { c: 2 } }, { raceRoleYield: { b: 2 } }, { xp: XP_RAW_VAR }]) {
    assert.notEqual(xpGateKey({ ...args, opts: { ...opts, ...change } }), base, JSON.stringify(change));
  }
  assert.notEqual(xpGateKey({ ...args, estimateParams: { e: 2 } }), base);
  assert.notEqual(xpGateKey({ ...args, knowledge: { k: 2 } }), base);
  assert.notEqual(xpGateKey({ ...args, fingerprint: "g" }), base);
});

// ── #7757: kørslen på motorens pakke. Alle tal er syntetiske (hard rule 17). ──

// Stor XP, så en dato kan købe flere point i samme evne, når intet loft bremser.
const XP_BIG = { xp_stor: { xp: { potentialXp: [{ at: 1, value: 2000 }, { at: 6, value: 9000 }] } } };

test("runCohort: kun nye 16-årige på aktive hold, fulgt år for år, deterministisk", () => {
  const opts = { ...XP_OPTS, cohortEndAge: 20 };
  const res = runCohort(syntheticSnapshot(), xpVariant("xp", opts), opts);
  assert.equal(res.mode, "cohort");
  assert.equal(res.cohortSize, 4, "2 pr. aktivt hold, banken tæller ikke");
  assert.ok(Object.keys(res.riderPeaks).every((id) => id.startsWith("coh-")), "ingen ryttere fra billedet");
  assert.deepEqual(Object.keys(res.byAge).map(Number), [16, 17, 18, 19, 20]);
  assert.equal(res.byAge[16].n, 4);
  assert.ok(res.byAge[20].rating.mean >= res.byAge[16].rating.mean, "de unge udvikler sig");
  assert.deepEqual(runCohort(syntheticSnapshot(), xpVariant("xp", opts), opts).riderPeaks, res.riderPeaks, "samme seeds, samme udfald");
  assert.notEqual(cohortFingerprint(syntheticSnapshot(), opts), cohortFingerprint(syntheticSnapshot(), { ...opts, cohortPerTeam: 3 }));
});

test("runCohort: følges til 40 år eller pension, og kurve B-sammenligningen har samme ryttere", () => {
  const opts = { ...XP_OPTS, cohortPerTeam: 1 };
  const xp = runCohort(syntheticSnapshot(), xpVariant("xp", opts), opts);
  const ages = Object.keys(xp.byAge).map(Number);
  assert.equal(ages[0], 16);
  assert.ok(ages.every((a) => a >= 16 && a <= 40));
  const retired = Object.values(xp.retiredAt).reduce((s, n) => s + n, 0);
  assert.ok(ages.at(-1) === 40 || retired === xp.cohortSize, "enten 40 år eller alle pensioneret");
  const other = runCohort(syntheticSnapshot(), { name: "kurveB", kind: "nu", capPerDate: true }, opts);
  assert.deepEqual(Object.keys(other.riderPeaks).sort(), Object.keys(xp.riderPeaks).sort(), "samme kohorte i begge modeller");
});

test("inflationCheck: ekstra købte point i kravets sæson mod kurve B, grænsen kommer udefra", () => {
  const world = (pts) => ({ gates: { pointsPerSeason: pts } });
  const req = validateRequirements({ inflation: { season: 3, maxExtraPct: 5 }, topLoss: { maxBelow: 1 } });
  const ok = inflationCheck(world([100, 100, 104]), world([100, 100, 100]), req);
  assert.equal(ok.extraPct, 4);
  assert.equal(ok.verdict, true);
  assert.deepEqual(ok.perSeason, [0, 0, 4]);
  assert.equal(inflationCheck(world([100, 100, 106]), world([100, 100, 100]), req).verdict, false);
  const short = inflationCheck(world([100]), world([100]), req);
  assert.equal(short.verdict, null);
  assert.match(short.reason, /når ikke sæson 3/);
  const none = inflationCheck(world([100, 100, 106]), world([100, 100, 100]), null);
  assert.equal(none.verdict, null, "uden private grænser ingen dom");
  assert.match(none.reason, /privat/);
});

test("topLossCheck: kun ryttere i begge kohorter, antal og andel under egen kurve B-top", () => {
  const xp = { riderPeaks: { a: 50, b: 40, c: 60 } };
  const b = { riderPeaks: { a: 50, b: 45, c: 55, d: 70 } };
  const req = (topLoss) => validateRequirements({ inflation: { season: 1, maxExtraPct: 0 }, topLoss });
  const one = topLossCheck(xp, b, req({ maxBelow: 1 }));
  assert.equal(one.n, 3, "d findes kun i kurve B");
  assert.equal(one.below, 1);
  assert.equal(one.loss.max, 5);
  assert.equal(one.verdict, true);
  assert.equal(topLossCheck(xp, b, req({ maxBelow: 0 })).verdict, false);
  assert.equal(topLossCheck(xp, b, req({ maxBelowPct: 30 })).verdict, false, "en tredjedel er over 30 %");
  assert.equal(topLossCheck(xp, b, null).verdict, null);
});

test("validateRequirements: intet er null, ugyldigt kaster, gyldigt fryses", () => {
  assert.equal(validateRequirements(null), null);
  assert.throws(() => validateRequirements({ inflation: { season: 0, maxExtraPct: 1 }, topLoss: { maxBelow: 1 } }), /inflation/);
  assert.throws(() => validateRequirements({ inflation: { season: 15, maxExtraPct: 1 }, topLoss: {} }), /top-tab/);
  const ok = validateRequirements({ inflation: { season: 15, maxExtraPct: 1 }, topLoss: { maxBelowPct: 2 } });
  assert.ok(Object.isFrozen(ok) && ok.topLoss.maxBelow === null);
  const opts = applyPrivateXp({ ...SIM_DEFAULTS }, { xp: XP_RAW, sim: { requirements: { inflation: { season: 2, maxExtraPct: 3 }, topLoss: { maxBelow: 4 } } } });
  assert.equal(opts.requirements.inflation.season, 2);
  // Den anden sandhed om variationen afvises højt i stedet for at blive overset.
  for (const sim of [{ variationSpan: 0.1 }, { variationMemory: 0.5 }]) {
    assert.throws(() => applyPrivateXp({ ...SIM_DEFAULTS }, { xp: XP_RAW, sim }), /xp\.variation/);
  }
});

test("xpVariant: led i navnet vælger intet dagsloft og bonus, også oven på en privat variant", () => {
  assert.equal(xpVariant("xp", XP_OPTS).capPerDate, true);
  assert.equal(xpVariant("xp_nocap", XP_OPTS).capPerDate, false);
  const full = xpVariant("xp_bonus15_nocap", XP_OPTS);
  assert.deepEqual([full.trainNowBonus, full.capPerDate, full.plan], [0.15, false, "standard"]);
  assert.throws(() => xpVariant("xp_bonus15_gulv_nocap", XP_OPTS), /_gulv er fjernet/, "motoren har altid gulvet");
  const big = xpVariant("xp_stor_nocap", { ...XP_OPTS, xpVariants: XP_BIG });
  assert.equal(big.xpParams.potentialXp[0].value, 2000, "tallene kommer fra den private variant");
  assert.equal(xpVariant("xp_rot_hard", XP_OPTS).plan, "rotate");
  assert.throws(() => xpVariant("xp_m", { ...XP_OPTS, xpVariants: { xp_m: { variationMemory: 0.5 } } }), /xp\.variation/);
  const ownVar = xpVariant("xp_v", { ...XP_OPTS, xpVariants: { xp_v: { xp: { variation: TEST_VARIATION } } } });
  assert.equal(ownVar.xpParams.variation.span, 0.5, "en privat variant sætter sin variation i xp.variation");
  assert.notDeepEqual(xpRunInputs(xpVariant("xp", XP_OPTS), XP_OPTS), xpRunInputs(xpVariant("xp_nocap", XP_OPTS), XP_OPTS), "intet loft er en anden kørsel");
});

test("intet dagsloft: uden loft kan en evne stige mere end 1 på en dato, med loft aldrig", () => {
  const opts = { ...XP_OPTS, seasons: 1, xpVariants: XP_BIG };
  const capped = runVariant(syntheticSnapshot(), xpVariant("xp_stor", opts), opts);
  const free = runVariant(syntheticSnapshot(), xpVariant("xp_stor_nocap", opts), opts);
  const over = (h) => (h["2"] ?? 0) + (h["3+"] ?? 0);
  assert.equal(over(capped.dateGains.all), 0);
  assert.equal(capped.dateGains.max, 1);
  assert.ok(over(free.dateGains.all) > 0, "kun prisen bremser");
  assert.ok(free.dateGains.max >= 2);
  assert.equal(free.gates.capViolations, 0, "uden loft er der intet at bryde");
  assert.ok(free.gates.pointsPerSeason[0] > capped.gates.pointsPerSeason[0], "loftet holdt point tilbage");
  assert.ok(over(free.dateGains.firstWeek) > 0, "X6: første uge måles for sig");
  assert.ok(Object.keys(free.dateGains.byAge).length > 0 && Object.keys(free.dateGains.byPotential).length > 0);
  assert.equal(dateGainBucket(5), "3+");
});

test("dagsvariation: kørslen bruger motorens egen variation fra xp.variation, og uden den ingen", () => {
  const opts = { ...XP_OPTS, seasons: 1 };
  const varOpts = { ...opts, xp: XP_RAW_VAR };
  const seen = [];
  const hooks = { ...XP_ENGINE_HOOKS, dayVariation: (args, variation) => {
    const mult = XP_ENGINE_HOOKS.dayVariation(args, variation);
    seen.push({ ...args, mult, variation });
    return mult;
  } };
  const withVar = runVariant(syntheticSnapshot(), xpVariant("xp", varOpts), { ...varOpts, engineHooks: hooks });
  assert.ok(seen.length > 0);
  // Samme tal som motoren regner for (rytter, dato) med de validerede params.
  const params = xpVariant("xp", varOpts).xpParams;
  for (const s of seen.slice(0, 20)) {
    assert.equal(s.mult, developmentXpDayVariation({ riderId: s.riderId, dateStr: s.dateStr }, params.variation));
    assert.match(s.dateStr, /^\d{4}-\d{2}-\d{2}$/, "en rigtig dato, så motorens kalender gælder");
  }
  assert.ok(seen.some((s) => s.mult !== 1), "med xp.variation svinger dagene");
  assert.deepEqual(runVariant(syntheticSnapshot(), xpVariant("xp", varOpts), varOpts).seasons, withVar.seasons, "samme nøgle, samme udfald");
  seen.length = 0;
  runVariant(syntheticSnapshot(), xpVariant("xp", opts), { ...opts, engineHooks: hooks });
  assert.ok(seen.length > 0 && seen.every((s) => s.mult === 1 && s.variation === undefined), "uden xp.variation er dagen præcis 1, som i motoren");
});

test("løbsdagen regnes af motoren: gulvet mod en hård dag og R15b-løftet på en enkeltstart, der passer", () => {
  const team = { staff: null, facilityTier: 3 };
  const rider = (primaryType) => engineRaceRider({ age: 22, potentiale: 6, primaryType, secondaryType: null, team, riderLevel: "u23" });
  // Uden rolletillæg er programmet motorens raceDayProgram, og hver evne er developmentXpAbilityDelta.
  const sprinterItt = engineRaceDayXp({ profile: "itt", role: "free_role", rider: rider("sprinter"), xp: XP });
  assert.equal(sprinterItt.lifted, false, "enkeltstart passer ikke en sprinter: intet R15b-løft");
  const program = raceDayProgram("itt");
  for (const a of VISIBLE_ABILITIES) {
    assert.equal(sprinterItt.xp[a], developmentXpAbilityDelta({ ...rider("sprinter"), ability: a, program, academyRateMult: 1, yieldMult: 1 }, XP), a);
  }
  assert.ok(sprinterItt.xp.time_trial > 0 && sprinterItt.xp.tempo > 0);
  // Enkeltstartsrytteren på sin hjemmebane løftes op til sit bedste hårde pas, og hele løftet
  // ligger i etapens evner (#7757: det er dét, R16 skal måles på).
  const ttRider = rider("tt");
  const tt = engineRaceDayXp({ profile: "itt", role: "free_role", rider: ttRider, xp: XP });
  const unlifted = Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, developmentXpAbilityDelta({ ...ttRider, ability: a, program, academyRateMult: 1, yieldMult: 1 }, XP)]));
  const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);
  const best = xpBestHardSessionTotal(ttRider, { catalogV3: true, abilities: VISIBLE_ABILITIES }, XP);
  assert.equal(tt.lifted, true, "med de syntetiske tal er enkeltstarten under det bedste pas og løftes");
  assert.ok(sum(unlifted) < best && sum(tt.xp) >= best, "dagen løftes op til mindst det bedste hårde pas");
  for (const a of VISIBLE_ABILITIES) {
    if (program.focusAbilities.includes(a)) assert.ok(tt.xp[a] > unlifted[a], a);
    else assert.equal(tt.xp[a], unlifted[a], `${a}: løftet går kun i etapens evner`);
  }
  assert.ok(TIME_TRIAL_PROFILES.has("itt") && TIME_TRIAL_PROFILES.has("itt_hilly") && TIME_TRIAL_PROFILES.has("ttt"));
  assert.equal(engineRaceRider({ age: 22, potentiale: 3, primaryType: "tt", team, riderLevel: "u23" }).budgetDivisor, raceDayBudgetDivisor());
  assert.equal(ttRider.trainingCfg, TRAINING_CONFIG);
});

test("R16 i kørslen: løbsdatoer og enkeltstarter tælles for sig, og dommen er 0 brud", () => {
  const opts = { ...XP_OPTS, seasons: 1, raceShareByAge: [{ maxAge: 99, share: 1 }], xpVariants: XP_BIG };
  const free = runVariant(syntheticSnapshot(), xpVariant("xp_stor_nocap", opts), opts);
  const h = free.dateGains;
  const count = (b) => Object.values(b ?? {}).reduce((s, n) => s + n, 0);
  assert.ok(count(h.raceDate) > 0, "alle datoer er løbsdatoer");
  assert.ok(count(h.timeTrialDate) > 0 && count(h.timeTrialDate) <= count(h.raceDate), "enkeltstarter er en del af løbsdatoerne");
  const c = r16Check(h);
  assert.equal(c.all, h.all["3+"] ?? 0);
  assert.equal(c.verdict, c.all === 0);
  assert.deepEqual(r16Check({ all: { 1: 4 }, raceDate: {}, trainingDate: {} }), { all: 0, raceDate: 0, timeTrialDate: 0, verdict: true }, "gamle kørsler uden enkeltstart");
  assert.equal(r16Check({ all: { "3+": 1 }, raceDate: { "3+": 1 }, timeTrialDate: { "3+": 1 } }).verdict, false);
  assert.equal(r16Check(null).verdict, null);
});

test("R16 på løbsdage med højeste intention (Fable-dom 15/11, fund 6): leddet _maxint giver motoren den højeste intention", () => {
  assert.equal(MAX_RACE_INTENTION, Math.max(...VALID_EFFORTS_FIVE_STEP.map(effortDevelopmentMultiplier)));
  assert.ok(MAX_RACE_INTENTION > 1, "den højeste intention giver mere end normal");
  assert.equal(raceIntentionMult("normal"), 1);
  const opts = { ...XP_OPTS, seasons: 1, raceShareByAge: [{ maxAge: 99, share: 1 }], xpVariants: XP_BIG };
  const max = xpVariant("xp_stor_nocap_maxint", opts);
  assert.deepEqual([max.raceIntention, max.capPerDate], ["max", false]);
  assert.equal(xpVariant("xp_stor_nocap", opts).raceIntention, "normal");
  assert.equal(xpRunInputs(max, opts).raceIntention, "max", "højeste intention er en anden kørsel");
  assert.equal("raceIntention" in xpRunInputs(xpVariant("xp_nocap", XP_OPTS), XP_OPTS), false, "kørsler uden _maxint har samme identitet som før");
  const seen = [];
  const hooks = { ...XP_ENGINE_HOOKS, raceDayXp: (args) => { seen.push(args.intention); return XP_ENGINE_HOOKS.raceDayXp(args); } };
  const snap = syntheticSnapshot();
  const hi = runVariant(snap, max, { ...opts, engineHooks: hooks });
  assert.ok(seen.length > 0 && seen.every((i) => i === MAX_RACE_INTENTION), "hver løbsdag regnes med den højeste intention");
  seen.length = 0;
  const normal = runVariant(snap, xpVariant("xp_stor_nocap", opts), { ...opts, engineHooks: hooks });
  assert.ok(seen.length > 0 && seen.every((i) => i === 1), "uden _maxint er løbsdagen normal");
  const total = (r) => Object.values(r.dateGains.raceDate).reduce((s, n) => s + n, 0);
  assert.ok(total(hi) >= total(normal), "højeste intention giver mindst lige så mange løbsdato-stigninger");
  assert.match(renderMotorpakke(snap, [hi], [], opts, "test"), /\| xp_stor_nocap_maxint \| verden \| \d+ \| \d+ \| \d+ \| holder( IKKE)? \|/);
});

test("R16-dommen (Fable-dom 15/11, fund 3): brud dømmes 'holder IKKE', dagsloft dømmes 'ikke målt', aldrig 'holder'", () => {
  const opts = { ...XP_OPTS, seasons: 1, raceShareByAge: [{ maxAge: 99, share: 0.5 }], xpVariants: XP_BIG };
  const snap = syntheticSnapshot();
  const free = runVariant(snap, xpVariant("xp_stor_nocap", opts), opts);
  const capped = runVariant(snap, xpVariant("xp_stor", opts), opts);
  assert.ok((free.dateGains.all["3+"] ?? 0) > 0, "de store syntetiske tal giver +3 på en dato uden dagsloft");
  assert.equal(capped.dateGains.max, 1, "med dagsloft kan intet stige mere end 1");
  assert.deepEqual([free.capPerDate, capped.capPerDate], [false, true]);
  assert.equal(r16Check(free.dateGains, { capPerDate: false }).verdict, false);
  const c = r16Check(capped.dateGains, { capPerDate: true });
  assert.deepEqual([c.verdict, c.reason], [null, "ikke målt (dagsloft)"]);
  const card = renderMotorpakke(snap, [free, capped], [], opts, "test");
  assert.match(card, /\| xp_stor_nocap \| verden \| [1-9]\d* \| \d+ \| \d+ \| holder IKKE \|/, "en kørsel med brud dømmes 'holder IKKE'");
  assert.match(card, /\| xp_stor \| verden \| 0 \| 0 \| 0 \| ikke målt \(dagsloft\) \|/, "dagsloft måler intet");
  assert.doesNotMatch(card, /\| xp_stor \| verden \|[^\n]*\| holder \|/);
  // Gemte kørsler fra før feltet: XP-kørsler har det i identiteten, de gamle modeller i navnet.
  const { capPerDate: _drop, ...oldFree } = free;
  assert.equal(resultCapPerDate(oldFree), false);
  assert.equal(resultCapPerDate({ variant: "nu" }), false);
  assert.equal(resultCapPerDate({ variant: "kurveB" }), true);
});

test("motorens hook: kørslen bruger de injicerede funktioner, og kilden står i kørslens identitet", () => {
  let variations = 0;
  let raceDays = 0;
  const engineHooks = {
    ...XP_ENGINE_HOOKS, source: "test",
    dayVariation: (...args) => { variations += 1; return XP_ENGINE_HOOKS.dayVariation(...args); },
    raceDayXp: (args) => { raceDays += 1; return XP_ENGINE_HOOKS.raceDayXp(args); },
  };
  const opts = { ...XP_OPTS, seasons: 1, engineHooks, raceShareByAge: [{ maxAge: 99, share: 0.5 }] };
  const res = runVariant(syntheticSnapshot(), xpVariant("xp", opts), opts);
  assert.ok(variations > 0 && raceDays > 0);
  assert.equal(res.params.xpRun.engine, "test");
  assert.notEqual(xpRunInputs(xpVariant("xp", XP_OPTS), XP_OPTS).engine, "test");
  assert.match(XP_ENGINE_HOOKS.source, /motorens egne funktioner/);
});

test("renderMotorpakke og renderX7: kravene, dagsloftet, kohorten og X7 særskilt på private kort", () => {
  const req = { inflation: { season: 2, maxExtraPct: 5 }, topLoss: { maxBelow: 1 } };
  const opts = { ...XP_OPTS, seasons: 2, cohortEndAge: 18, requirements: validateRequirements(req) };
  const snap = syntheticSnapshot();
  const b = { name: "kurveB", kind: "nu", capPerDate: true };
  const results = [runVariant(snap, b, opts), runVariant(snap, xpVariant("xp_nocap", opts), opts)];
  const cohorts = [runCohort(snap, b, opts), runCohort(snap, xpVariant("xp_nocap", opts), opts)];
  const card = renderMotorpakke(snap, results, cohorts, opts, "test");
  for (const heading of ["De to faste krav", "R16: aldrig +3", "Intet dagsloft", "Enkeltstart", "X6 første uge", "Kohorten: X1", "Kohorten pr. alder", "IKKE dækker"]) assert.ok(card.includes(heading), heading);
  assert.match(card, /\| xp_nocap \| verden \| \d+ \| \d+ \| \d+ \| holder( IKKE)? \|/, "R16-dommen står pr. variant");
  assert.match(card, /\| xp_nocap \|.*\| holder( IKKE)? \|/);
  assert.ok(!card.includes("undefined") && !card.includes("NaN"));
  const x7 = renderX7(snap, results, cohorts, opts, "test");
  assert.ok(x7.includes("Taktik") && x7.includes("tactics") && x7.includes("Kohorten pr. alder"));
  const bare = renderMotorpakke(snap, results, [], { ...opts, requirements: null }, "test");
  assert.match(bare, /Grænserne mangler/);
});

test("Codex P2: dommen falder på det uafrundede tal, lige over grænsen holder ikke", () => {
  const world = (pts) => ({ gates: { pointsPerSeason: pts } });
  const req = validateRequirements({ inflation: { season: 1, maxExtraPct: 5 }, topLoss: { maxBelowPct: 33.33 } });
  const inf = inflationCheck(world([105004]), world([100000]), req);
  assert.equal(inf.extraPct, 5, "visningen er afrundet");
  assert.equal(inf.verdict, false, "men 5,004 % er over 5 %");
  const top = topLossCheck({ riderPeaks: { a: 1, b: 2, c: 3 } }, { riderPeaks: { a: 2, b: 2, c: 3 } }, req);
  assert.equal(top.belowPct, 33.33);
  assert.equal(top.verdict, false, "en tredjedel er over 33,33 %");
});

test("X8 på motorens løbsdag: gulvet er altid med, rolletillægget og R15b følger motoren", () => {
  const world = buildWorld(syntheticSnapshot());
  const x8 = raceVsTraining(world, 4, XP, XP_OPTS, { sample: 3 });
  assert.ok(x8.checks > 0);
  assert.equal(x8.underHardNoStaff, 0, "uden træner slår løbet altid en hård dag");
  let calls = 0;
  const engineHooks = { ...XP_ENGINE_HOOKS, raceDayXp: (args) => { calls += 1; return XP_ENGINE_HOOKS.raceDayXp(args); } };
  raceVsTraining(world, 4, XP, { ...XP_OPTS, engineHooks }, { sample: 1 });
  assert.ok(calls > 0, "X8 regner løbsdagen af samme funktion som sæsonløkken");
});

test("assertPrivateOutDir: kun balance-internals/6110", () => {
  assert.ok(assertPrivateOutDir("C:/x/balance-internals/6110/s25").endsWith("s25"));
  assert.throws(() => assertPrivateOutDir("C:/x/tmp"), /balance-internals\/6110/);
  assert.throws(() => assertPrivateOutDir("C:/x/balance-internals/7000"), /6110/);
});

test("limitSnapshotTeams: beholder kun de første aktive hold og deres ryttere", () => {
  const lim = limitSnapshotTeams(syntheticSnapshot(), 1);
  assert.deepEqual(lim.teams.map((t) => t.id), ["t1"]);
  assert.equal(lim.riders.length, 10);
  assert.equal(lim.abilities.length, 10);
});
