// Traeningsscoren 1-99 (#4851, fase A1) — passets KVALITET, ikke udbyttet.
//
// ═══ HVORFOR DEN FINDES ══════════════════════════════════════════════════════
// I dag er `tickResult.score` en KVITTERING: summen af de evne-deltaer motoren
// allerede har beregnet (`dailyTraining.js:232`, `:251`). Den er CAP-AFHAENGIG,
// fordi `gap` er afstanden til loftet (`dailyTraining.js:132`), saa en rytter
// hvis fokus-evner staar paa loftet faar score 0 efter et perfekt haardt pas.
// Maalt i prod 6/9: 534 ikke-hvile-rytterdage med score praecis 0 paa syv dage.
//
// Ejerens beslutning 4 (6/9, docs/TRAINING_RULES.md §13) vender kausalretningen
// om: scoren er et INPUT der maaler passets kvalitet, og udviklingen udledes AF
// scoren. Ordret: *"Taettest paa 1 - Men det skal ogsaa vaere alt efter hvor
// hurtigt/godt han udvikler sig. Saadan store talenter har bedre score, end naer
// saa gode talenter. Derudover skal det ogsaa stige, hvis man har bedre traener,
// hvis man har bedre akademi mv."*
//
// ═══ MODELLEN (spec §4.2) ════════════════════════════════════════════════════
//
//   kvalitet Q = session/intensitet × fokus-match × kondition × traener × facilitet
//   talent   T = potentiale-rate × ungdomsfaktor(alder)
//   u          = (Q × T × dagsstoej) / reference
//   score S    = clamp(1, 99, 99 · u^curve / (u^curve + m))
//
// `u` er en RELATIV kvalitet: 1,0 er en median-session for en median-rytter, og
// den maetter mod 99 i stedet for at blive klippet der. Det er praecis gate G3's
// krav ("ingen bunkning i enderne"): en ren lineaer skala ville lade en 16-aarig
// med potentiale 6 paa en haard dag ramme 500 og dermed staa i 99 hver eneste
// dag sammen med alle andre gode dage.
//
// ── DEN ER IKKE CAP-AFHAENGIG ────────────────────────────────────────────────
// Ingen af faktorerne ovenfor kender `ability_caps`. Loft-naerheden hoerer til
// DELTA-formlen (`dailyTraining.dailyAbilityDelta`, gap-proportional), ikke til
// kvalitetsmaalet. Det er selve rettelsen spec §4.1 beskriver, og gate G4
// ("0 raekker med score 0/1 paa et gennemfoert pas") foelger direkte af det.
//
// ── TRAENING STRAFFER ALDRIG ────────────────────────────────────────────────
// `staffTrainingBonus` og `facilityTrainingMultiplier` er begge >= 1,0 og
// scoren er monotont stigende i hver enkelt faktor. En bedre traener eller en
// bedre facilitet kan derfor ALDRIG saenke hverken scoren eller delta'en.
//
// ── HVILE OG LOEBSDAGE ──────────────────────────────────────────────────────
// Hviledag (intensity "rest") ⇒ ingen score (null): der var intet pas at maale.
// Loebsdag ⇒ scoren beregnes internt (den driver udviklingen), men fladen viser
// "loeb" uden tal og kurven har hul (spec §4.4). Om en loebsdag SKAL have et tal
// paa samme skala er et AABENT punkt i spec §5 — det afgoeres af ejeren, ikke her.
//
// ── STOEJ-SEED (arkitekt-beslutning A3) ─────────────────────────────────────
// Dagsstoejen kommer ind som en faerdig `noise` fra `applyDailyTick`, som i fase
// A noegler den paa `tick_date`. TODO(#4846 fase B2): naar loebsdagen er
// tick-enheden, noegles den paa `${seasonId}#gd${gameDay}` (seamen findes
// allerede som `tickSeedKey` i dailyTraining.js) — ellers ville tre loebsdage
// samme kalenderdag give tre IDENTISKE scorer.
//
// Ren funktion: ingen DB, ingen Date, ingen Math.random.

import { TRAINING_CONFIG, TRAINING_FOCUSES, focusAbilityWeight } from "./training.js";
import { ROLE_CLASS_RATE, roleRateFactor, youthRateForPotential } from "./riderProgression.js";
import { youthMultiplier } from "./academyFlag.js";
import { staffTrainingBonus, facilityTrainingMultiplier } from "./staffTrainingBonus.js";
import { dayTypeForProgram, sessionForProgram } from "./trainingDayTypes.js";

// Faktorernes REFERENCE — den "median-session for en median-rytter" der pr.
// definition giver `midpoint`. Hver reference peger paa en eksisterende
// prod-konstant, saa skalaen ikke kan drive fra motoren:
//   intensity  = TRAINING_CONFIG.focusGrowthMult.normal  (tempo-dagen)
//   focusMatch = ROLE_CLASS_RATE.haandvaerk              (midterste rolleklasse)
//   potential  = youthRateForPotential(3)                (midterste potentiale)
// Resten er de neutrale vaerdier (ingen traener, ingen facilitet, normal form).
const REFERENCE = Object.freeze({
  intensity: TRAINING_CONFIG.focusGrowthMult.normal,
  focusMatch: ROLE_CLASS_RATE.haandvaerk,
  condition: 1.0,
  coach: 1.0,
  facility: 1.0,
  potential: youthRateForPotential(3),
  youth: 1.0,
  noise: 1.0,
});

// Raekkefoelgen er den fladen viser bidrag i, naar to bidrag er lige store.
export const SCORE_FACTOR_KEYS = Object.freeze([
  "intensity", "focusMatch", "condition", "coach", "facility", "potential", "youth", "noise",
]);

export const TRAINING_SCORE_CONFIG = Object.freeze({
  min: 1,
  max: 99,
  // Asymptoten. Kurven naar den aldrig, saa `max` er en garanti, ikke en klippe.
  asymptote: 99,
  // Scoren for u = 1 (referencen ovenfor). Kalibreret i
  // backend/scripts/dev/trainingScoreHarness.mjs mod en seedet bestand.
  midpoint: 50,
  // Hvor haardt kvaliteten slaar igennem. Lavere = fladere fordeling. 0,95 er
  // valgt i harnessen mod 500 aegte prod-ryttere × 14 dage (5.166 pas): den
  // bruger skalaen (10 til 86, median 55) uden at bunke i nogen af enderne —
  // 0 pas i 1-5 og 0 i 95-99, altsaa gate G3 og G4 med margin. En hoejere
  // vaerdi presser bunden mod 1; en lavere klemmer alt ind i 30-70.
  curve: 0.95,
  reference: REFERENCE,
  // ── Koblingen til udviklingen (ejer-beslutning 4) ─────────────────────────
  // Delta'ens rytter-led er scorens afvigelse fra midtpunktet loeftet i
  // `gamma`, ganget paa den faktor-kaede scoren selv er bygget af.
  //   gamma = 0  ⇒ praecis dagens model (koblingen er inert)
  //   gamma > 0  ⇒ en hoej score giver et hoejere udbytte end i dag, en lav et
  //               lavere. `normalizer` er bestandens middelvaerdi af
  //               (S/midpoint)^gamma, saa SAEEONENS SAMLEDE udvikling er
  //               uaendret — reshaping, ikke power creep (gate G1).
  // Begge tal er maalt i harnessen; se PR-body for foer/efter over 14 dage.
  deltaCoupling: Object.freeze({ gamma: 0.25, normalizer: 1.0745 }),
});

// m saa kurven rammer `midpoint` praecis ved u = 1.
const CURVE_M = TRAINING_SCORE_CONFIG.asymptote / TRAINING_SCORE_CONFIG.midpoint - 1;

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Evnerne sessionen faktisk traener, med deres vaegt (#4631's FOCUS_ABILITY_WEIGHT).
function sessionAbilityWeights(program) {
  const focus = program?.focus ?? null;
  const abilities = TRAINING_FOCUSES[focus] ?? [];
  return abilities.map((ability) => ({ ability, weight: focusAbilityWeight(focus, ability) }));
}

/**
 * De otte faktorer bag scoren. Ren opslags-/aggregerings-funktion.
 *
 * Returnerer `null` naar der ikke var et pas at maale (hviledag, ukendt
 * intensitet) — kald-stedet skriver saa ingen raekke.
 */
export function trainingScoreFactors({
  program, age, potentiale, conditionMult, noise,
  staff = null, facilityTier = null, riderLevel = null,
  primaryType = null, secondaryType = null,
  trainingCfg = TRAINING_CONFIG,
}) {
  const intensity = trainingCfg.focusGrowthMult?.[program?.intensity];
  // "rest" staar IKKE i focusGrowthMult — en hviledag har ingen kvalitet at
  // maale, og det er samme gren som abilityMult's `intensity === "rest" ⇒ 0`.
  if (!Number.isFinite(intensity) || intensity <= 0) return null;

  const dayType = dayTypeForProgram(program);
  const weights = sessionAbilityWeights(program);

  // ── fokus-match: hvor godt sessionen rammer NETOP denne rytters anlaeg ────
  // Vaegtet middel af rolle-raten over sessionens egne evner. Samme
  // `roleRateFactor` + faerdighedsdags-loft som delta'en bruger pr. evne
  // (dailyTraining.js), saa tallet spilleren ser og udbyttet han faar er
  // bygget paa den SAMME kilde.
  let focusMatch = ROLE_CLASS_RATE.andenRolle;
  let coach = 1.0;
  if (weights.length > 0) {
    let weightSum = 0;
    let rateSum = 0;
    let coachSum = 0;
    for (const { ability, weight } of weights) {
      const baseRate = primaryType == null
        ? ROLE_CLASS_RATE.haandvaerk
        : roleRateFactor(primaryType, secondaryType, ability);
      const rate = dayType === "skill" ? Math.min(baseRate, ROLE_CLASS_RATE.haandvaerk) : baseRate;
      weightSum += weight;
      rateSum += weight * rate;
      coachSum += weight * staffTrainingBonus({ facilityTier, staff, ability, riderLevel });
    }
    if (weightSum > 0) {
      focusMatch = rateSum / weightSum;
      coach = coachSum / weightSum;
    }
  }

  return {
    intensity,
    focusMatch,
    condition: finiteOr(conditionMult, 1),
    coach,
    facility: facilityTrainingMultiplier({ facilityTier, staff }),
    potential: youthRateForPotential(potentiale),
    youth: youthMultiplier(age),
    noise: finiteOr(noise, 1),
  };
}

// u = Π(faktor / reference). 1,0 = median-session for median-rytter.
function relativeQuality(factors, cfg = TRAINING_SCORE_CONFIG) {
  let u = 1;
  for (const key of SCORE_FACTOR_KEYS) {
    const ref = cfg.reference[key];
    const value = factors[key];
    if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(value) || value <= 0) continue;
    u *= value / ref;
  }
  return u;
}

// Maettende kurve u → 1..99. Naar aldrig asymptoten, saa clamp'en er en garanti.
export function scoreFromRelativeQuality(u, cfg = TRAINING_SCORE_CONFIG) {
  if (!Number.isFinite(u) || u <= 0) return cfg.min;
  const m = cfg.asymptote / cfg.midpoint - 1;
  const p = Math.pow(u, cfg.curve);
  const raw = (cfg.asymptote * p) / (p + m);
  return Math.max(cfg.min, Math.min(cfg.max, raw));
}

// Hvad ville scoren vaere hvis netop DENNE faktor stod paa sin reference?
// Differencen er faktorens bidrag i score-point — den ene linje "hvad traekker
// op/ned" paa profilkortet (spec §4.4) er de stoerste af dem.
function contributionsFor(factors, score, cfg) {
  const out = [];
  for (const key of SCORE_FACTOR_KEYS) {
    const neutral = { ...factors, [key]: cfg.reference[key] };
    const without = Math.round(scoreFromRelativeQuality(relativeQuality(neutral, cfg), cfg));
    const points = score - without;
    if (points === 0) continue;
    out.push({ key, points, direction: points > 0 ? "up" : "down" });
  }
  out.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return out.slice(0, 4);
}

/**
 * Traeningsscoren for ÉT pas.
 *
 * @returns {null|{
 *   score: number, raw: number, relative: number,
 *   factors: object, contributions: Array<{key:string,points:number,direction:string}>,
 *   session: string|null, dayType: string,
 *   riderQuality: number, deltaQualityMult: number,
 * }}  null naar der ikke var et pas at maale (hvile / ukendt intensitet).
 */
export function computeTrainingScore(args, cfg = TRAINING_SCORE_CONFIG) {
  const factors = trainingScoreFactors(args);
  if (!factors) return null;

  const relative = relativeQuality(factors, cfg);
  const raw = scoreFromRelativeQuality(relative, cfg);
  const score = Math.max(cfg.min, Math.min(cfg.max, Math.round(raw)));

  // ── Rytter-leddet i delta-formlen ─────────────────────────────────────────
  // Praecis den kaede `dailyAbilityDelta` i dag ganger paa pr. evne, bortset
  // fra `staffTrainingBonus`, som BLIVER pr. evne (den er dimension×niveau-
  // specifik og maa ikke kollapse til ét rytter-tal i udbyttet).
  const riderQuality = factors.condition * factors.youth * factors.potential
    * factors.noise * factors.facility;
  // Koblingen: scoren er kilden. gamma = 0 ⇒ inert (dagens model).
  const { gamma, normalizer } = cfg.deltaCoupling;
  const shape = gamma === 0 ? 1 : Math.pow(score / cfg.midpoint, gamma) / normalizer;
  const deltaQualityMult = riderQuality * shape;

  return {
    score,
    raw,
    relative,
    factors,
    contributions: contributionsFor(factors, score, cfg),
    session: sessionForProgram(args.program),
    dayType: dayTypeForProgram(args.program),
    riderQuality,
    deltaQualityMult,
  };
}
