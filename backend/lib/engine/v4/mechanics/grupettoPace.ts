// backend/lib/engine/v4/mechanics/grupettoPace.ts
// #5581 (ejer-beslutning 23/9, #4914 valg 1b: "Soerg for at det foelger
// realismen"): grupettoen regner paa tidsgraensen.
//
// FUNDET: i grupetto-model a (`effort_weighted`, segmentLoop.groupEffortTempo)
// koerer en gruppe af udelukkende grupetto-ryttere grupetto-tempo, og en
// grupetto-rytter falder tilbage paa stigningerne (climbSelection.
// grupettoDropBackForced). Uden en stor grupetto at komme ind med koerer han
// derfor ALENE i grupetto-tempo og uden lae, og han kan ende uden for
// tidsgraensen (M15, mechanics/timeLimit.ts), ogsaa naar han let kunne have
// naaet den. Det rammer de staerke ryttere, som paa `normal` aldrig ryger ud.
//
// VIRKELIGHEDEN: grupettoen koerer saa langsomt som muligt, men aldrig
// langsommere end tidsgraensen tillader. Den regner graensen ud paa forhaand
// (sportsdirektoeren/vejkaptajnen kender etapen), og en rytter ryger kun ud,
// naar han fysisk ikke kan foelge med.
//
// REGLEN (ren, deterministisk, ingen rng):
//   1. BUDGET. Motoren kender frontens tid, gruppens afstand til fronten og
//      etapens graense-faktor. Vindertiden forudsiges ud fra frontens tempo
//      indtil nu, maalt mod etapens NOMINELLE tid (hvert segments laengde
//      ved terraenets basishastighed) — saa en bjergetape med stigningerne
//      til sidst ikke forudsiges som en flad etape. Budgettet er den del af
//      graensen gruppen endnu har tilbage, ganget med en sikkerhedsandel
//      (`limitShare` < 1: grupettoen sigter lidt inden for graensen, ikke
//      praecis paa den).
//   2. TEMPO-KRAV. Budgettet fordeles jaevnt over resten af frontens etape:
//      paa dette segment maa gruppen bruge frontens tid plus sin andel af
//      budgettet. Er grupetto-tempoet hurtigt nok, sker der INTET (ren
//      grupetto er stadig langsommere end feltet, naar graensen ikke trues).
//   3. GULVET. Ellers haeves gruppens indsats-led lige praecis nok til at
//      holde tidskravet, dog aldrig over 1 (gruppen koerer aldrig hurtigere
//      end rytternes egen CP tillader — det er ikke en bonus over evne).
//   4. RESERVEN. Gulvet skaleres med front-rytternes W'-reserve: med fuld
//      reserve (>= `reserveForFullFloor`) holder han det, med en toemt
//      reserve kan han ikke, og han ryger stadig ud. Et knaek eller et
//      uheld kan derfor stadig sende ham hjem, praecis som i virkeligheden.
//
// Koblingen (hvilke grupper, og hvem der saa koerer forrest) bor i
// segmentLoop.applyGrupettoPaceFloor: en ren grupetto-gruppe, eller grupetto-
// rytterne i en blandet gruppe der er for langsom til graensen. finale.ts
// holder den anden halvdel af kontrakten: grupettoen jager ikke op i finalen.
//
// Invariant 3 (styrke straffes aldrig) er uberoert: gulvet er en funktion af
// gruppens position og reserve, aldrig af evnerne, og det goer aldrig en
// gruppe langsommere. Fog-gate (§2d): intet her naar en tidslinje eller en
// spiller-flade.

import { GRUPETTO_PACE_EXTRA_TUNING } from "../tuning.ts";

export type GrupettoPaceTuning = {
  /** Andel af den tilladte margin grupettoen sigter efter (0 < x <= 1). */
  limitShare: number;
  /** Reserve-andel (W'/W'max) hvor gulvet gaelder fuldt; under den skaleres det lineaert mod 0. */
  reserveForFullFloor: number;
};

export { GRUPETTO_PACE_EXTRA_TUNING as GRUPETTO_PACE_TUNING };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export type GrupettoAllowedDtArgs = {
  /** Frontgruppens krydsningstid paa dette segment (s). */
  dtFrontSeconds: number;
  /** Frontens forbrugte tid ved segmentets indgang (s). */
  frontElapsedSeconds: number;
  /** Etapens nominelle tid til og med dette segment (s), se filhovedet punkt 1. */
  nominalElapsedSeconds: number;
  /** Etapens samlede nominelle tid (s). */
  nominalTotalSeconds: number;
  /** Gruppens afstand til fronten ved segmentets indgang (s). */
  gapSeconds: number;
  /** Etapens graense-faktor (mechanics/timeLimit.ts's timeLimitFactorFor). */
  limitFactor: number;
  tuning?: GrupettoPaceTuning;
};

/**
 * Den laengste tid gruppen maa bruge paa dette segment, hvis den skal naa
 * inden for (sikkerhedsandelen af) tidsgraensen med et jaevnt tempo resten af
 * etapen. `null` naar der ikke kan regnes et krav (manglende/ugyldige tal):
 * saa gaelder intet gulv.
 *
 * Er budgettet allerede brugt op, er kravet frontens egen tid — gruppen skal
 * holde frontens tempo for ikke at tabe mere. Om den KAN, afgoer tempo-
 * modellen og reserven (grupettoPaceFloorFactor), ikke denne funktion.
 */
export function grupettoAllowedDtSeconds(args: GrupettoAllowedDtArgs): number | null {
  const tuning = args.tuning ?? GRUPETTO_PACE_EXTRA_TUNING;
  const { dtFrontSeconds, frontElapsedSeconds, nominalElapsedSeconds, nominalTotalSeconds, gapSeconds, limitFactor } = args;
  if (![dtFrontSeconds, frontElapsedSeconds, nominalElapsedSeconds, nominalTotalSeconds, gapSeconds, limitFactor].every(Number.isFinite)) {
    return null;
  }
  if (dtFrontSeconds <= 0 || nominalElapsedSeconds <= 0 || nominalTotalSeconds <= 0 || limitFactor <= 0) return null;
  const share = Number.isFinite(tuning.limitShare) ? clamp(tuning.limitShare, 0, 1) : 1;
  // Frontens tempo mod den nominelle etape indtil nu (inkl. dette segment).
  const pace = (frontElapsedSeconds + dtFrontSeconds) / nominalElapsedSeconds;
  const expectedWinnerSeconds = pace * Math.max(nominalTotalSeconds, nominalElapsedSeconds);
  const remainingFrontSeconds = Math.max(dtFrontSeconds, expectedWinnerSeconds - frontElapsedSeconds);
  const budgetSeconds = limitFactor * share * expectedWinnerSeconds - Math.max(0, gapSeconds);
  if (budgetSeconds <= 0) return dtFrontSeconds;
  return dtFrontSeconds * (1 + budgetSeconds / remainingFrontSeconds);
}

export type GrupettoPaceFloorArgs = {
  /** Gruppens grupetto-indsats-led (segmentLoop.groupEffortTempo), 0 < x < 1. */
  baseFactor: number;
  /** Gruppens krydsningstid ved et givet indsats-led. Skal vaere ikke-stigende i faktoren. */
  dtAt: (factor: number) => number;
  /** grupettoAllowedDtSeconds's svar; `null` = intet krav. */
  allowedDtSeconds: number | null;
  /** Front-rytternes W'-reserve (0-1). */
  reserveFraction: number;
  tuning?: GrupettoPaceTuning;
};

const BISECTION_STEPS = 24;

/**
 * Gruppens indsats-led efter tidsgraense-gulvet: `baseFactor` naar grupetto-
 * tempoet er hurtigt nok, ellers den mindste faktor der holder tidskravet,
 * skaleret med reserven og aldrig over 1. Ren og deterministisk (fast antal
 * bisektions-skridt, ingen rng).
 */
export function grupettoPaceFloorFactor(args: GrupettoPaceFloorArgs): number {
  const tuning = args.tuning ?? GRUPETTO_PACE_EXTRA_TUNING;
  const base = args.baseFactor;
  // Ingen grupetto-term (1) eller en ugyldig faktor: intet at haeve.
  if (!Number.isFinite(base) || base <= 0 || base >= 1) return 1;
  const allowed = args.allowedDtSeconds;
  if (allowed === null || !Number.isFinite(allowed) || allowed <= 0) return base;
  if (args.dtAt(base) <= allowed) return base;
  let needed = 1;
  if (args.dtAt(1) < allowed) {
    // Mindste faktor i (base, 1] der holder kravet: dt er ikke-stigende i
    // faktoren, saa bisektionen konvergerer mod graensepunktet fra oven.
    let lo = base;
    let hi = 1;
    for (let i = 0; i < BISECTION_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (args.dtAt(mid) <= allowed) hi = mid;
      else lo = mid;
    }
    needed = hi;
  }
  const full = Number.isFinite(tuning.reserveForFullFloor) && tuning.reserveForFullFloor > 0 ? tuning.reserveForFullFloor : 0;
  const reserve = Number.isFinite(args.reserveFraction) ? clamp(args.reserveFraction, 0, 1) : 0;
  const gate = full > 0 ? clamp(reserve / full, 0, 1) : 1;
  return clamp(base + (needed - base) * gate, base, 1);
}
