// Værdimodel v4 (#2428) — karriere-NPV-lag, SLICE 1 (shadow, ren funktion).
//
// v3 (riderValuation.js predictBaseValue) værdisætter en rytter ud fra dens NUVÆRENDE
// abilities alene — ingen alder, ingen fremtid. v4 værdisætter i stedet den FORVENTEDE
// tilbagediskonterede sum af sæson-produktion over resten af karrieren:
//
//   base_value_v4 = scale · Σ_s discount^s · S_s · exp(a + b·O_s + c·O_s² + offset[type])
//
// hvor O_s = blendedOutput(abilities_s, type, alpha) og abilities_s er FORVENTEDE
// (ikke Monte Carlo) abilities ved sæson s — udviklet via samme kurve som den passive
// progressions-motor (riderProgression.js developRiderSeason), men med støjen
// nulstillet (noiseUnit=0.5 → noise=0) så resultatet er deterministisk. S_s er
// overlevelses-sandsynligheden (ikke pensioneret endnu) ved sæson s, drevet af samme
// retirement-hazard som riderProgression.js' retirementDecision (vindue [36,40),
// garanteret retirement ved 40).
//
// Dette er en NY funktion i en NY fil — predictBaseValue (v3, live) i riderValuation.js
// røres ALDRIG i denne slice. Ingen DB, ingen Date.now/Math.random: 100% ren, samme
// input → samme output (påkrævet for scorecardets determinisme-gate).
//
// Model-input: Kontrakt 2-formen (backend/lib/riderValuationModelV4.json), se
// docs/superpowers/specs/2026-07-13-rider-valuation-v4-production-value-design.md.

import { ABILITY_KEYS, blendedOutput, riderOverall } from "./riderValuation.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import {
  PROGRESSION_CONFIG,
  abilityCap,
  buildCaps,
  peakAgeForType,
  signatureFactor,
  stepAbility,
  youthRateForPotential,
} from "./riderProgression.js";

// Retirement-hazard som funktion af ALDER (ikke rider/season-seeded — v4 bruger
// forventningen, ikke en seeded roll). Samme vindue som riderProgression.js'
// retirementDecision: lineær fra 0 ved windowStartAge til 1 ved guaranteedAge,
// og forbliver 1 derover (garanteret pensionering).
export function hazard(age, cfg = PROGRESSION_CONFIG) {
  const { windowStartAge, guaranteedAge } = cfg.retirement;
  const a = Number(age);
  if (!Number.isFinite(a)) return 1; // ukendt alder → konservativt: ingen fremtidig produktion
  const p = (a - windowStartAge) / (guaranteedAge - windowStartAge);
  return Math.max(0, Math.min(1, p));
}

// Ét sæson-fremskridt for ALLE VISIBLE_ABILITIES, FORVENTNING (noiseUnit=0.5 → noise=0),
// ingen retirement-mutation (survival håndteres separat via hazard/S). Replikerer
// developRiderSeason's matematik nøjagtigt (riderProgression.js:200-219) minus
// training-bias (NPV-forventningen kender ikke fremtidige træningsplaner) og minus
// changed/retirement-bogføring (ikke relevant her).
//   abilities : { <ability>: current-værdi, ... } (kun VISIBLE_ABILITIES-nøgler bruges)
//   caps      : { <ability>: loft, ... } fra buildCaps (uforanderligt over hele NPV-løkken)
//   ctx       : { primary_type, potentiale, age } — age = alderen brugt til
//               vækst/fald-fase-bestemmelsen for DETTE fremskridt (se predictBaseValueV4).
// EKSPORTERET så valuationV4Scorecard.js's udvikl-og-sælg-gate fremskriver evner med
// PRÆCIST samme matematik som predictBaseValueV4 selv bruger internt (ingen drift
// mellem det scorecardet validerer og det produktionen beregner — #2428 slice 1).
// ── VÆRDI-FRYS (trin 7, ejer-beslutning 16/8) ────────────────────────────────
// Trin 7 spredte motorens rateByPotential fra 0,6-1,35 til 0,11-0,89. Fulgte
// NPV'en med, ville markedsværdierne flytte sig fra deploy-dagen (målt på
// snapshottet: median −12 %, unge ≤21 −27 %, pot 5,5-6 −33 %) — fremskrevet
// mod de GAMLE lofter, for buildCaps-stien hernede er legacy-formlen. En
// kimære af gammel og ny motor, midt i et værdispor med sin egen plan.
//
// Ejeren valgte at FRYSE: NPV'en beregner videre med de rater den blev fittet
// mod, så trin 7 flytter præcis 0 i markedsværdi. Det planlagte refit
// (#3750 + #3449, i kø efter typebeslutningen) indarbejder den nye motor
// samlet — fjern denne frysning DÉR, aldrig separat.
const FROZEN_NPV_RATE_BY_POTENTIAL = Object.freeze({ 1: 0.6, 2: 0.78, 3: 0.92, 4: 1.06, 5: 1.2, 6: 1.35 });
function frozenNpvRate(potentiale) {
  return youthRateForPotential(potentiale, { rateByPotential: FROZEN_NPV_RATE_BY_POTENTIAL });
}

export function expectedNextAbilities(abilities, caps, { primary_type, potentiale, age }) {
  const peakAge = peakAgeForType(primary_type);
  const growthMult = frozenNpvRate(potentiale);
  const next = {};
  for (const ability of VISIBLE_ABILITIES) {
    const cur = abilities?.[ability];
    if (cur == null) continue; // spejler developRiderSeason: evner uden værdi springes
    const isSig = signatureFactor(primary_type, ability) >= 1.0;
    const cap = caps?.[ability] ?? abilityCap(cur, primary_type, ability, potentiale);
    next[ability] = stepAbility(cur, cap, age, peakAge, isSig, 0.5, PROGRESSION_CONFIG, growthMult);
  }
  return next;
}

// Delt kerne for predictBaseValueV4 + careerTrajectory. Returnerer null hvis
// model/abilities er ugyldige (spejler predictBaseValue's guards i riderValuation.js),
// ellers { npv, trajectory }.
function simulateCareer(rider, abilities, model) {
  const fit = model?.fit;
  if (!fit || !Number.isFinite(Number(fit.a)) || !Number.isFinite(Number(fit.b))) return null;

  const haveAbilities = ABILITY_KEYS.some((k) => Number.isFinite(Number(abilities?.[k])));
  if (!haveAbilities) return null;

  // #3345 FROZEN VALUATION TYPE: samme fallback-kæde som predictBaseValue (v3) i
  // riderValuation.js — se dens #3345-kommentar for baggrund + fjernelsesplan.
  // predictBaseValueV4 er den LIVE model (#2594-cutover), så DENNE linje er den
  // reelle produktions-kaldsvej der skal fryses, ikke v3'ens.
  const type = rider?.valuation_type ?? rider?.primary_type ?? null;
  const potentiale = rider?.potentiale;
  const age0 = Number(rider?.age);
  // #2594: uden gyldig alder kan hverken NPV'en eller sæson-0-leddet forankres i
  // karrieren — returnér null (samme kontrakt som manglende abilities) i stedet
  // for et tavst prod_0-kollaps (NaN-alder fik survival til at dø efter sæson 0).
  if (!Number.isFinite(age0)) return null;

  const alpha = Number.isFinite(Number(fit.alpha)) ? Number(fit.alpha) : 1;
  const c = Number.isFinite(Number(fit.c)) ? Number(fit.c) : 0;
  const offsets = fit.offset
    ? Object.values(fit.offset).map(Number).filter(Number.isFinite)
    : [];
  const offsetFloor = offsets.length ? Math.min(...offsets) : 0;
  // #1231-mønster (samme fallback som predictBaseValue): type uden kalibreret offset
  // arver det LAVESTE fittede offset, ikke 0.
  const offset = fit.offset?.[type] ?? offsetFloor;
  const discount = Number.isFinite(Number(model.discount)) ? Number(model.discount) : 0.8;

  const caps = buildCaps(abilities, type, potentiale);

  let ab = { ...abilities };
  let S = 1;
  let npv = 0;
  const trajectory = [];

  for (let s = 0; ; s++) {
    const age_s = age0 + s;
    // Sikkerheds-cap (s>25) + hård alders-grænse (>40) + survival-udtynding (<1e-4).
    if (s > 25 || age_s > 40 || !(S >= 1e-4)) break;

    const O_s = blendedOutput(ab, type, alpha);
    const prod_s = Math.exp(fit.a + fit.b * O_s + c * O_s * O_s + offset);
    const discounted = discount ** s * S * prod_s;
    npv += discounted;
    trajectory.push({ s, age: age_s, O: O_s, prod: prod_s, survival: S, discounted });

    // Fremskriv abilities til næste sæson (FORVENTNING, age=age_s — vækst/fald-fasen
    // for DETTE overgangs-skridt bestemmes af den alder rytteren HAR i sæson s).
    ab = expectedNextAbilities(ab, caps, { primary_type: type, potentiale, age: age_s });
    // Overlevelse ind i næste sæson (age_s + 1).
    S *= 1 - hazard(age_s + 1);
  }

  return { npv, trajectory };
}

// Elite-præmie (#2428, ejer-retning 14/7): de ENORMT gode ryttere skal være
// uoverkommeligt dyre (ukøbelige i 3-4 sæsoner), ikke prissat på ren produktion —
// produktionen alene kapper en stjerne ved hvad han kan tjene (~1-2M i den svage
// beta-økonomi), stik imod ejerens vision om eliten som utilgængelige trofæer.
// Løsningen: en STEJL, konveks præmie over en overall-tærskel:
//   value · exp(k · max(0, overall − overall_threshold))
// Under tærsklen (bulk): præmie = 1 (produktions-NPV'en grunder de mange ryttere
// fornuftigt). Over: eksplosiv vækst, så en overall-70-stjerne lander titals-
// millioner over det rigeste holds råd-loft. Monoton i BÅDE value og overall
// (bevarer rangorden). Erstatter det tidligere bløde top-loft (som trak den
// FORKERTE vej — klemte eliten ned). overall_threshold + k er ejer-tunbare og
// kalibreres i fitRiderValuationV4.js mod den faktiske hold-økonomi.
export function applyElitePremium(value, overall, elitePremium) {
  if (!elitePremium) return value;
  const threshold = Number(elitePremium.overall_threshold);
  const k = Number(elitePremium.k);
  const o = Number(overall);
  if (!Number.isFinite(o)) return value;
  let v = value;
  // Konveks præmie (glat vækst mod toppen).
  if (k > 0 && Number.isFinite(threshold) && o > threshold) {
    v = value * Math.exp(k * (o - threshold));
  }
  // Elite-gulv (#2428): de ENORMT gode ryttere (overall ≥ floor_overall) er GARANTERET
  // ukøbelige — mindst `floor` (= flere gange råd-loftet), uanset deres produktion.
  // Uden gulvet kan en top-overall rytter med lav produktion ende under råd-loftet.
  const floor = Number(elitePremium.floor);
  const floorOverall = Number(elitePremium.floor_overall);
  if (floor > 0 && Number.isFinite(floorOverall) && o >= floorOverall) {
    v = Math.max(v, floor);
  }
  return v;
}

// Karriere-NPV base_value (v4). Samme kald-form som predictBaseValue (v3).
// rider: { primary_type, potentiale, age } (age = heltal, sat af kalderen).
// abilities: rider_derived_abilities-form (VISIBLE_ABILITIES-nøgler).
// model: Kontrakt 2-objektet (riderValuationModelV4.json).
// Returnerer null hvis model ugyldig (mangler fit.a/fit.b) eller abilities helt
// fraværende, eller hvis NPV'en ikke bliver et gyldigt positivt tal.
export function predictBaseValueV4(rider, abilities, model /*, opts */) {
  const result = simulateCareer(rider, abilities, model);
  if (!result) return null;
  const { npv } = result;
  if (!Number.isFinite(npv) || npv <= 0) return null;

  const scale = Number.isFinite(Number(model.scale)) ? Number(model.scale) : 1;
  // Elite-præmien keyer på rytterens NUVÆRENDE overall (ikke fremskrevet) — det er
  // de dygtige NU der skal være uoverkommelige, ikke unge talenter (lav overall nu).
  const overallNow = riderOverall(abilities);
  const premium = applyElitePremium(scale * npv, overallNow, model.elite_premium);
  // #3449 niveau-korrektion (c), VARIG udgave (ejer-beslutning 23/8 aften): c
  // ganges på den FÆRDIGE base_value (efter scale + elite-præmie), præcis som
  // marketValueLevelCorrectionApply.js gør på de lagrede rækker. Uden denne
  // linje ville enhver genberegning (sæson-progressionen, søndags-refreshen,
  // nye ryttere) skrive niveauet tilbage til det u-korrigerede — præcis den
  // "refresh skrev det væk igen"-klasse #3449 selv advarer om. KUN base_value:
  // currentProductionValue (løn-basen, #3989) røres bevidst ikke — lønnen er
  // produktions-baseret, og apply-scriptet rører heller ikke CPV.
  const level = levelCorrectionFactor(model);
  const baseValue = Math.round(level * premium);
  if (!Number.isFinite(baseValue)) return null;
  return Math.max(1, baseValue);
}

// model.level_correction (riderValuationModelV4.json): c fra #3449-gaten.
// Mangler/ugyldig/≤0 ⇒ 1 (ingen korrektion) — bagudkompatibel med test-modeller
// og ældre JSON'er. Eksporteret så preview-/harness-scripts kan læse den samme
// faktor i stedet for at gætte.
export function levelCorrectionFactor(model) {
  const v = Number(model?.level_correction);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

// Ren trajectory-udtræk til scorecardets symmetri-gate (veteran-forfald + ungdomspræmie
// som konkrete kurver). Samme NPV-matematik som predictBaseValueV4, men returnerer
// pr.-sæson raden i stedet for kun summen. Ugyldig model/abilities → [] (ingen kurve).
export function careerTrajectory(rider, abilities, model) {
  const result = simulateCareer(rider, abilities, model);
  return result ? result.trajectory : [];
}

// Løn-base (#2428 løn-decoupling): kun SÆSON-0-produktionsleddet, skaleret, UDEN
// elite-præmie. Adskiller løn ("ugeløn for nuværende levering") fra base_value
// ("køb/salg-pris = hele karriere-NPV'en + elite-præmie"). Genbruger careerTrajectory
// så formlen ikke duplikeres — trajectory[0].prod = exp(a + b·O_0 + c·O_0² + offset)
// ved rytterens NUVÆRENDE evner (ingen diskontering, survival=1, ingen fremskrivning).
// Samme kald-form + null-kontrakt som predictBaseValueV4. Ren funktion.
export function currentProductionValue(rider, abilities, model) {
  const traj = careerTrajectory(rider, abilities, model);
  if (!traj.length) return null;
  const scale = Number.isFinite(Number(model?.scale)) ? Number(model.scale) : 1;
  const v = Math.round(scale * traj[0].prod);
  return Number.isFinite(v) && v > 0 ? Math.max(1, v) : null;
}
