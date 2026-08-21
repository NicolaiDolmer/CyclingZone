// backend/lib/engine/v4/physiology.ts
// Race Engine v4 F2 (#4030): CP/W'-model + dagsform (designdoc §5, beslutning 17-18).
//
// REN — ingen import fra oevrigt backend; egen rng via ./rng.ts. Alle vaerdier
// normaliserede (0-1) — fog-gate: ingen fysiske watt (genre-first, §5).
//
// Dagsform/jour sans genskaber raceDayForm.js's KONTRAKT (per-rytter-hash,
// dedikerede rng-streams, symmetrisk dagsform / form-koblet jour-sans-sandsynlighed)
// som en REN kopi paa v4's egen rng — ingen import af raceDayForm.js selv
// (renheds-graensen, jf. designdoc §1 "renhed"-raekken).

import type { AbilityKey, DayformTuning, PhysiologyTuning, SegmentKind } from "./types.ts";
import { gaussian, rngFor } from "./rng.ts";
import { PHYSIOLOGY_SUBTICK_TUNING } from "./tuning.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Ability-vaerdier er 0-99 (abilityRegistry-skala); normaliser til [0,1] foer
// de ganges med tuning-vaegte (samme moenster som raceSimulator.terrainScore).
function normAbility(v: number | undefined): number {
  return clamp(Number(v) || 0, 0, 99) / 99;
}

/**
 * CP-taerskel (kritisk-effekt-ækvivalent, normaliseret 0-1). §5-formlen:
 * `cp = w.tempo·A.tempo + w.endurance·A.endurance + w.climbSpec·A.climbing·isClimb
 *      + w.tt·A.time_trial·isFlat`.
 * isClimb/isFlat er terraen-gates: climbSpec-bonus kun paa climb-segmenter,
 * tt-bonus kun paa RENT flade segmenter (rolling/cobbles faar ikke tt-bonus —
 * TT-specialisme udfolder sig paa den lige, uafbrudte vej).
 */
export function deriveCp(
  abilities: Record<AbilityKey, number>,
  segmentKind: SegmentKind,
  weights: PhysiologyTuning["cpWeights"],
): number {
  const isClimb = segmentKind === "climb" ? 1 : 0;
  const isFlat = segmentKind === "flat" ? 1 : 0;
  return (
    weights.tempo * normAbility(abilities.tempo) +
    weights.endurance * normAbility(abilities.endurance) +
    weights.climbSpec * normAbility(abilities.climbing) * isClimb +
    weights.tt * normAbility(abilities.time_trial) * isFlat
  );
}

/**
 * Anaerob reserve-kapacitet (W'max, normaliseret 0-1). §5-formlen:
 * `wprimeMax = w.punch·A.punch + w.accel·A.acceleration + w.sprint·A.sprint`.
 */
export function deriveWprimeMax(
  abilities: Record<AbilityKey, number>,
  weights: PhysiologyTuning["wprimeWeights"],
): number {
  return (
    weights.punch * normAbility(abilities.punch) +
    weights.accel * normAbility(abilities.acceleration) +
    weights.sprint * normAbility(abilities.sprint)
  );
}

/**
 * Genopladningsrate (fraktion af (wprimeMax-wprime) genoprettet pr. sekund
 * under CP). §5-formlen: `rechargeRate = base · (0.5 + 0.5·A.recovery/99)`
 * — `recoveryFloorFraction` er den generaliserede "0.5"-gulv-konstant.
 */
export function deriveRechargeRate(
  abilities: Record<AbilityKey, number>,
  tuning: PhysiologyTuning,
): number {
  const recovery = normAbility(abilities.recovery);
  const floor = tuning.recoveryFloorFraction;
  return tuning.rechargeRateBase * (floor + (1 - floor) * recovery);
}

export type PhysiologyTickResult = {
  wprime: number; // ny W'-reserve efter dette tick, clampet [0, wprimeMax]
  secondsOverCp: number; // sekunder dette tick brugt over CP (0 eller dtSeconds)
  workNorm: number; // normaliseret arbejde udfoert dette tick (demand · dtSeconds)
};

/**
 * Ét fysiologi-tick for én rytter over ét segment (§5-formlen):
 * `demand > cp ⇒ wprime -= (demand − cp)·dt`;
 * `ellers ⇒ wprime += rechargeRate·(wprimeMax − wprime)·dt` (eksponentiel genopladning).
 * `wprime ≤ 0` ⇒ rytteren kan ikke foelge accelerationer/splits (tvungen
 * selektion) — haandhaeves af mekanik-hooks (M2/M3), ikke her; denne funktion
 * clamper blot til [0, wprimeMax] og rapporterer belastnings-metrikkerne raat.
 */
export function tickPhysiology(args: {
  cp: number;
  wprimeMax: number;
  wprime: number;
  demand: number;
  dtSeconds: number;
  rechargeRate: number;
}): PhysiologyTickResult {
  const { cp, wprimeMax, wprime, demand, dtSeconds, rechargeRate } = args;
  const workNorm = demand * dtSeconds;
  if (demand > cp) {
    const nextWprime = clamp(wprime - (demand - cp) * dtSeconds, 0, wprimeMax);
    return { wprime: nextWprime, secondsOverCp: dtSeconds, workNorm };
  }
  const nextWprime = clamp(wprime + rechargeRate * (wprimeMax - wprime) * dtSeconds, 0, wprimeMax);
  return { wprime: nextWprime, secondsOverCp: 0, workNorm };
}

export type SubTickPlan = {
  count: number; // antal sub-tick, altid >= 1
  dtSubSeconds: number; // segmentets dtSeconds / count (lige store sub-tick)
};

/**
 * Sub-tick-plan for ét segment (#4030 fixture-fund, tuning.ts's
 * physiologySubTick-kommentar): deler segmentets dtSeconds i `count` lige
 * store bidder, afledt af segmentets km-laengde (`kmPerSubTick`) og clampet
 * af `maxSubTicksPerSegment` (perf-/determinisme-gulv). Degenererer sikkert
 * til ét enkelt "sub-tick" (identisk med foer-fixet tickPhysiology-kald) for
 * 0-laengde/0-varighed segmenter.
 */
export function planSubTicks(args: {
  dtSeconds: number;
  segmentLengthKm: number;
  kmPerSubTick: number;
  maxSubTicksPerSegment: number;
}): SubTickPlan {
  const { dtSeconds, segmentLengthKm, kmPerSubTick, maxSubTicksPerSegment } = args;
  if (!(dtSeconds > 0) || !(segmentLengthKm > 0) || !(kmPerSubTick > 0)) {
    return { count: 1, dtSubSeconds: Math.max(0, dtSeconds) };
  }
  const raw = Math.ceil(segmentLengthKm / kmPerSubTick);
  const count = clamp(raw, 1, Math.max(1, maxSubTicksPerSegment));
  return { count, dtSubSeconds: dtSeconds / count };
}

/**
 * Fysiologi-tick for ét HELT segment, sub-delt (#4030 fixture-fund: `tickPhysiology`
 * daekkede foer et helt segment i ét Euler-skridt, hvilket gjorde den
 * eksponentielle genopladnings-ODE naer-binaer — ét stort skridt overskyder
 * maalstregen og klampes til wprimeMax. Denne funktion kalder `tickPhysiology`
 * `plan.count` gange med `plan.dtSubSeconds` og akkumulerer resultatet, saa
 * genopladningen naermer sig den sande eksponentielle kurve mens taering
 * forbliver vaerdimaessigt uaendret (lineaer ODE, sub-tick-invariant — se
 * `physiology.test.ts`'s ligheds-test). `cp`/`demand`/`rechargeRate` er
 * KONSTANTE for hele segmentet (segmentLoop.ts's kollektiv-CP/tempo-model
 * genberegnes kun pr. segment, ikke pr. sub-tick) — kun selve Euler-
 * integrationens skridtstoerrelse aendres.
 */
export function tickPhysiologyOverSegment(args: {
  cp: number;
  wprimeMax: number;
  wprime: number;
  demand: number;
  dtSeconds: number;
  rechargeRate: number;
  segmentLengthKm: number;
  subTick?: { kmPerSubTick: number; maxSubTicksPerSegment: number };
}): PhysiologyTickResult {
  const { cp, wprimeMax, demand, dtSeconds, rechargeRate, segmentLengthKm } = args;
  const subTick = args.subTick ?? PHYSIOLOGY_SUBTICK_TUNING;
  const plan = planSubTicks({
    dtSeconds,
    segmentLengthKm,
    kmPerSubTick: subTick.kmPerSubTick,
    maxSubTicksPerSegment: subTick.maxSubTicksPerSegment,
  });

  let wprime = args.wprime;
  let secondsOverCp = 0;
  let workNorm = 0;
  for (let i = 0; i < plan.count; i++) {
    const tick = tickPhysiology({ cp, wprimeMax, wprime, demand, dtSeconds: plan.dtSubSeconds, rechargeRate });
    wprime = tick.wprime;
    secondsOverCp += tick.secondsOverCp;
    workNorm += tick.workNorm;
  }
  return { wprime, secondsOverCp, workNorm };
}

/**
 * Dagsform: seeded normal-komponent pr. (etape-seed, rytter), symmetrisk om 0
 * — samme kontrakt som raceDayForm.dayFormComponent, egen rng-stream ("dayform").
 */
export function dayformComponent(args: { seed: string; riderId: string; tuning: DayformTuning }): number {
  const { seed, riderId, tuning } = args;
  if (!tuning.sd) return 0;
  return gaussian(rngFor(seed, "dayform", riderId), 0, tuning.sd);
}

/**
 * p(jour sans) for en given form-vaerdi (0-100): base-raten skaleret lineaert
 * mellem jourSansPMultLowform (form <= formLow) og jourSansPMultHighform
 * (form >= formHigh). Manglende/ugyldig form -> base (neutral). Samme kontrakt
 * som raceDayForm.jourSansProbability.
 */
export function jourSansProbability(form: number | null | undefined, tuning: DayformTuning): number {
  const base = tuning.jourSansPBase;
  if (!base) return 0;
  const f = Number(form);
  if (form == null || !Number.isFinite(f)) return base;
  const lo = tuning.jourSansFormLow;
  const hi = tuning.jourSansFormHigh;
  const fc = clamp(f, lo, hi);
  const frac = (fc - lo) / (hi - lo);
  const mult = tuning.jourSansPMultLowform + frac * (tuning.jourSansPMultHighform - tuning.jourSansPMultLowform);
  return clamp(base * mult, 0, 1);
}

/**
 * Jour sans: Bernoulli pr. (etape-seed, rytter) med form-koblet p; udfald
 * uniform i [magnitudeMin, magnitudeMax], returneret NEGATIVT (adderes til cp
 * som en CP-reduktion — sjaelden negativ hale). 0 = ingen kollaps. Samme
 * rng-orden-kontrakt som raceDayForm.jourSansComponent (u1=Bernoulli, u2=magnitude
 * kun ved hit) — form-/p-aendringer flytter ALDRIG andre rytteres udfald,
 * streamen er per-rytter ("joursans").
 */
export function jourSansComponent(args: {
  seed: string;
  riderId: string;
  form?: number | null;
  tuning: DayformTuning;
}): number {
  const { seed, riderId, form = null, tuning } = args;
  const p = jourSansProbability(form, tuning);
  if (!p) return 0;
  const rng = rngFor(seed, "joursans", riderId);
  if (rng() >= p) return 0;
  const u = rng();
  return -(tuning.jourSansMagnitudeMin + u * (tuning.jourSansMagnitudeMax - tuning.jourSansMagnitudeMin));
}

/** Anvend dagsform + jour sans paa en base-CP; gulv 0 (CP kan aldrig blive negativ). */
export function applyDayformToCp(cp: number, dayform: number, jourSans: number): number {
  return Math.max(0, cp + dayform + jourSans);
}
