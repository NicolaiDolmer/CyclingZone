// #6984 Form og træthed 2.0 (ejer-beslutninger B1-B5, 20/10). REN: ingen IO.
// Spec: docs/superpowers/specs/2026-10-20-6984-form-traethed-design.md.
// Kun aktiv bag app_config-flaget `condition_model_v2` (conditionModelV2Flag.js);
// flag off = ingen kaldere, altså bit-identisk med den gamle model.
//
//  B1  En etape vejer et helt døgn: belastning lægges til og én restitution trækkes
//      fra pr. etape, i etapernes rækkefølge. Datoens frie pladser regnes som i dag
//      (summen af træningsbelastningen / 5 og en femtedel restitution pr. plads).
//  B3  Sæsonbelastning: glidende tillæg pr. løbsdag i sæsonen, med loft.
//  B4  Form: inaktivitet OG overbelastning koster form; passende belastning bygger den.
//  §5.2 Profil + længde, §5.4 recovery-evnen styrer den proportionale restitution,
//  §5.5 indsats, frontarbejde og et hentet udbrud koster.
// Konstanterne er balance; målte fordelinger og kalibrering ligger kun i
// balance-internals/6984/ (hard rule 17).
import { DAILY_TRAINING_CONFIG } from "./dailyTraining.js";
import { CONDITION_CONFIG, RACE_DAY_ENGINE_RECOVERY_CONFIG, injuryRisk, rollInjury } from "./riderCondition.js";
import { effortFatigueMultiplier } from "./raceRoles.js";
import { medicalRecoveryMultiplier, medicalTrainingInjuryRisk, medicalInjuryDays } from "./medicalEffects.js";
import { allOut7280Tuning, isAllOut7280On, isSaveItt7332Effort } from "./engine/v4/mechanics/effortCost.ts";
import { isS5ProfilesV3OrLater } from "./raceEngineRulesRevision.ts";

export const CONDITION_V2_CONFIG = Object.freeze({
  // §5.2: profil-belastning (spillernes rækkefølge, større spænd end v1). Niveauet er
  // harness-kalibreret 20/10 mod hele S4 (balance-internals/6984/, variant k70acc4).
  profileLoad: Object.freeze({
    flat: 6.3, rolling: 7.7, hilly: 9.8, classic: 11.2, cobbles: 11.2, gravel: 10.5,
    medium_mountain: 11.2, mountain: 13.3, high_mountain: 15.4,
    itt: 7, itt_hilly: 8.4, ttt: 6.3,
  }),
  unknownProfileLoad: 8.4,
  // §5.2: længde omkring en normaletape; enkeltstarter får ingen længdefaktor.
  lengthRefKm: 180, lengthMin: 0.85, lengthMax: 1.15,
  // §5.5: GT-akkumulering: sene etaper i et langt etapeløb koster mere (uge 3 er hård).
  accumulationPerStage: 0.04, accumulationCapStages: 15,
  // §5.5: frontarbejde/grupetto (samme mekanik som v1) + tillæg for et hentet udbrud.
  frontWork: 0.5, shelterRelief: 0.3, caughtBreakawaySurcharge: 0.25,
  workFactorMin: 0.7, workFactorMax: 1.75,
  // B3: +perDay pr. løbsdag over freeDays, loft.
  seasonFreeDays: 20, seasonPerDay: 0.01, seasonCap: 1.35,
  // §5.4: base og evne-led som i dag; andelen følger recovery-evnen (49,5 = 0,15 som i dag).
  recoveryBase: RACE_DAY_ENGINE_RECOVERY_CONFIG.recoveryBase,
  recoveryFromAbility: CONDITION_CONFIG.recoveryFromAbility,
  recoveryFractionLo: 0.11, recoveryFractionHi: 0.19,
  // B4: formændring pr. dato ud fra aftenens træthed: [øvre grænse (eksklusiv), delta].
  formSteps: Object.freeze([[15, -1], [25, 0], [55, 2], [70, 0], [85, -2], [Infinity, -4]]),
  formNearTop: 90, formNearTopGain: 1,
});

const TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);
const INDIVIDUAL_TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly"]); // #7332: enkeltstarter (ikke ttt)
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const finiteOr = (x, fallback) => (Number.isFinite(Number(x)) ? Number(x) : fallback);

/** §5.4: ét døgns restitution ved træthed f. `share` = andel af et døgn (frie pladser).
 * M1 (ejer 20/10): `medicalBonus` FORSTÆRKER rytterens egen recovery-evne. Afdelingen
 * ganges kun på evne-leddene (det faste evne-bidrag og evnens del af den proportionale
 * andel), aldrig på gulvet; en god restituerer får mest ud af den, en dårlig lidt. */
export function recoveryV2({ fatigue, recoveryAbility = 50, share = 1, medicalBonus = 0, cfg = CONDITION_V2_CONFIG }) {
  const rec = (clamp(finiteOr(recoveryAbility, 50), 0, 99) / 99) * medicalRecoveryMultiplier(medicalBonus);
  const f = Math.max(0, finiteOr(fatigue, 0));
  const frac = cfg.recoveryFractionLo + (cfg.recoveryFractionHi - cfg.recoveryFractionLo) * rec;
  return share * (cfg.recoveryBase + cfg.recoveryFromAbility * rec + frac * f);
}

/** §5.2: længdefaktor (1 for enkeltstarter og ukendt distance). */
export function stageLengthMultiplier(profileType, distanceKm, cfg = CONDITION_V2_CONFIG) {
  const km = Number(distanceKm);
  if (TIME_TRIAL_PROFILES.has(profileType) || !Number.isFinite(km) || km <= 0) return 1;
  const raw = cfg.lengthMin + (cfg.lengthMax - cfg.lengthMin) * (km / cfg.lengthRefKm - 0.5);
  return clamp(raw, cfg.lengthMin, cfg.lengthMax);
}

/** B3: sæsonfaktor. `seasonRaceDays` = løbsdage i sæsonen INKLUSIVE denne. */
export function seasonLoadMultiplier(seasonRaceDays, cfg = CONDITION_V2_CONFIG) {
  const days = Math.max(0, Math.floor(finiteOr(seasonRaceDays, 0)));
  return Math.min(cfg.seasonCap, 1 + cfg.seasonPerDay * Math.max(0, days - cfg.seasonFreeDays));
}

/** §5.5: etapens plads i løbet (1 på etape 1, aldrig faldende, loft). */
export function stageAccumulationMultiplierV2(stageNumber, cfg = CONDITION_V2_CONFIG) {
  const n = Math.max(1, Math.floor(finiteOr(stageNumber, 1)));
  return 1 + cfg.accumulationPerStage * Math.min(n - 1, cfg.accumulationCapStages);
}

/** §5.5: arbejde ud fra andel i front/grupetto; et hentet udbrud koster et tillæg. */
export function workMultiplierV2(exposure, { profileType = null, cfg = CONDITION_V2_CONFIG } = {}) {
  if (!exposure || TIME_TRIAL_PROFILES.has(profileType)) return 1;
  const front = clamp(finiteOr(exposure.front, 0), 0, 1);
  const shelter = clamp(finiteOr(exposure.shelter, 0), 0, 1);
  const caught = exposure.caught === true && front > 0 ? cfg.caughtBreakawaySurcharge : 0;
  return clamp(1 + cfg.frontWork * front - cfg.shelterRelief * shelter + caught, cfg.workFactorMin, cfg.workFactorMax);
}

/**
 * #6641/#7280 (slukket alt ud-pakke, KUN s5_profiles_v3; spec 2026-10-27-6641-alt-ud-design.md):
 * ejer 27/10 punkt 3, prisen for Alt ud er træthed der hober sig op. Pakkens faktor
 * erstatter alt ud's indsats-faktor, også i enkeltstarter (dér vinder alt ud nu tid).
 * `null` = pakken er ikke i kraft eller trinnet er ikke alt ud (bit-identisk).
 */
export function allOutLoadMultiplier7280(effort, rulesRevision) {
  if (effort !== "all_out" || !isAllOut7280On(rulesRevision)) return null;
  return allOut7280Tuning().fatigueLoad;
}

/**
 * #7332 (s5_profiles_v3 og senere; ejer 31/10 valg A): spar mod uret sparer træthed.
 * På en enkeltstart (itt, itt_hilly; ikke ttt) får spar, beskyt og grupetto samme
 * trætheds-rabat som spar på en FLAD etape, i stedet for 1. Motoren tager prisen i tid
 * (individualTimeTrial.ts). `null` = aeldre revision, eller trinnet/profilen er
 * ikke omfattet (bit-identisk).
 */
export function saveIttLoadMultiplier7332(effort, profileType, rulesRevision) {
  if (!INDIVIDUAL_TIME_TRIAL_PROFILES.has(profileType)) return null;
  if (!isSaveItt7332Effort(effort, isS5ProfilesV3OrLater(rulesRevision))) return null;
  return effortFatigueMultiplier("save", { profileType: "flat", rulesRevision });
}

/**
 * REN: én rytters belastning for én etape under v2.
 * profil × længde × indsats × arbejde × etapens plads × sæson.
 */
export function stageLoadV2({ profileType, distanceKm = null, stageNumber = 1, effort = "normal", exposure = null, seasonRaceDays = 0, rulesRevision = null, cfg = CONDITION_V2_CONFIG }) {
  const base = cfg.profileLoad[profileType] ?? cfg.unknownProfileLoad;
  const effortMult = allOutLoadMultiplier7280(effort, rulesRevision)
    ?? saveIttLoadMultiplier7332(effort, profileType, rulesRevision)
    ?? (TIME_TRIAL_PROFILES.has(profileType) ? 1 : effortFatigueMultiplier(effort, { profileType, rulesRevision }));
  return base
    * stageLengthMultiplier(profileType, distanceKm, cfg)
    * effortMult
    * workMultiplierV2(exposure, { profileType, cfg })
    * stageAccumulationMultiplierV2(stageNumber, cfg)
    * seasonLoadMultiplier(seasonRaceDays, cfg);
}

/** B4: formændring pr. dato. Små skridt; de sidste point mod toppen kommer langsommere. */
export function nextFormV2({ form, fatigue, cfg = CONDITION_V2_CONFIG }) {
  const fo = Number(form);
  const t = Number(fatigue);
  if (!Number.isFinite(fo) || !Number.isFinite(t)) return 50; // samme neutrale fallback som v1
  let delta = cfg.formSteps.find(([hi]) => t < hi)[1];
  if (delta > 0 && fo >= cfg.formNearTop) delta = Math.min(delta, cfg.formNearTopGain);
  return clamp(Math.round(fo + delta), 0, 100);
}

/**
 * B1: træthed efter én dato. Etape-pladser regnes som hele døgn i pladsernes
 * rækkefølge; de frie pladser bagefter med summen/5 og (antal/5) restitution.
 * En dato uden etaper er derfor samme formel som v1 (gennemsnit + én restitution),
 * kun med §5.4's evne-afhængige andel.
 */
export function settleDateFatigueV2({ fatigue, intensities, raceLoads, recoveryAbility = 50, medicalBonus = 0, cfg = CONDITION_V2_CONFIG }) {
  let f = clamp(finiteOr(fatigue, 0), 0, 100);
  let trainingLoad = 0;
  let trainingSlots = 0;
  intensities.forEach((intensity, index) => {
    if (intensity === "race") {
      f = clamp(f + raceLoads[index] - recoveryV2({ fatigue: f, recoveryAbility, medicalBonus, cfg }), 0, 100);
    } else {
      trainingLoad += DAILY_TRAINING_CONFIG.fatigueLoad[intensity] ?? 0;
      trainingSlots += 1;
    }
  });
  if (trainingSlots > 0) {
    const share = trainingSlots / intensities.length;
    f = clamp(f + trainingLoad / intensities.length - recoveryV2({ fatigue: f, recoveryAbility, share, medicalBonus, cfg }), 0, 100);
  }
  return Math.round(f);
}

/** v2-udgaven af trainingDateCondition.settleTrainingDateCondition (samme signatur og retur). */
export function settleTrainingDateConditionV2({ riderId, dateStr, condition, intensities, raceLoads, recoveryAbility = 50, medicalBonus = 0, cfg = CONDITION_V2_CONFIG }) {
  const preFatigue = Number(condition.fatigue ?? 0);
  const fatigue = settleDateFatigueV2({ fatigue: preFatigue, intensities, raceLoads, recoveryAbility, medicalBonus, cfg });
  const form = nextFormV2({ form: Number(condition.form ?? 50), fatigue, cfg });
  // Skaderisiko som i v1 (kun hård træning over skadegrænsen, på åbningstrætheden);
  // M2 sænker risikoen, M3 forkorter en skade.
  const baseRisk = intensities.reduce((total, intensity) => total + injuryRisk({ intensity, fatigue: preFatigue }), 0) / intensities.length;
  const risk = medicalTrainingInjuryRisk(baseRisk, medicalBonus);
  const injury = rollInjury({ riderId, dateStr, risk });
  return { fatigue, form, risk, injury: injury.injured ? { ...injury, days: medicalInjuryDays(injury.days, medicalBonus) } : injury };
}

/**
 * B2: træthed rytteren STARTER en etape med, når tidligere etaper samme dato allerede
 * er kørt. `priorLoadsToday` = de registrerede belastninger for datoens tidligere
 * etaper i rækkefølge (ledgeren). Uden tidligere etaper = åbningstrætheden.
 */
export function enteringFatigueV2({ openingFatigue, priorLoadsToday = [], recoveryAbility = 50, medicalBonus = 0, cfg = CONDITION_V2_CONFIG }) {
  let f = clamp(finiteOr(openingFatigue, 0), 0, 100);
  for (const load of priorLoadsToday) {
    f = clamp(f + finiteOr(load, 0) - recoveryV2({ fatigue: f, recoveryAbility, medicalBonus, cfg }), 0, 100);
  }
  return Math.round(f);
}
