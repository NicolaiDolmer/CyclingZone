// backend/lib/engine/v4/mechanics/timeModel.ts
// #6199 + #6200 (KUN regel-revisionen "orders_gc_v3"): én faelles tidsmodel for
// stigning og nedkoersel. Ejer-aftalt design 5/10 (kontrakten staar i den
// seneste kommentar paa #6199):
//
//  1. A: hullet en stigning skaber regnes ud fra stigningens laengde, stejlhed og
//     evneforskellen (tiden paa stigningen x det relative fartab), ikke et fast
//     trin. En tom reserve tvinger kun en rytter af fra ca. kat. 2.
//     B: efter en top midt paa etapen kan en gruppe koere op igen paa
//     nedkoerslen (i dag lukker den 0 s, saa hullet kun kan vokse).
//  2. Nedkoersel mod maal: hoejst ca. 1,5 s pr. km for en klart bedre nedkoerer,
//     afhaengigt af laengde og teknik, og hoejst halvdelen af hullet. Klatring
//     taeller med i placeringen i en nedkoerselsfinale.
//  3. Taet score giver samme tid i en selektiv finale.
//
// Alle konstanter er kalibreret privat mod ejer-maalene (balance-internals/6199/).
// Legacy, orders_gc_v1 og orders_gc_v2 laeser intet herfra (kaldestederne gater
// paa ctx.ordersGcV3).
//
// REN: ingen IO, ingen rng.

import type { AbilityKey, ClimbCategory } from "../types.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) freeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

export const TIME_MODEL_V3_TUNING = freeze({
  // ── A: hullet paa en stigning ──────────────────────────────────────────────
  // Referencefart op ad bakke: lodret hastighed (km/t) delt med stigningen, clampet.
  climbVerticalSpeedKmh: 1.7,
  climbSpeedBoundsKmh: [12, 40] as readonly [number, number],
  // Andel af stigningen de afhaengte ryttere i snit koerer bag gruppen (de saettes af undervejs).
  climbGapExposure: 0.6,
  // Relativt fartab pr. enhed klatre-underskud (0-1 mod gruppens bedste klatrer).
  climbGapAbilityWeight: 1.2,
  // Relativt fartab pr. enhed energi-underskud (tom reserve = 1).
  climbGapEnergyWeight: 0.08,
  climbGapMaxRelativeLoss: 0.35,
  // Et split er altid mindst saa stort, at det overlever segmentets merge-trin.
  climbGapBoundsSeconds: [3, 900] as readonly [number, number],
  // De afhaengte samles i faa grupper efter eget hul (clusterSplitRiders).
  clusterMinSeconds: 10,
  clusterShare: 0.25,
  clusterMaxGroups: 4,
  // En tom reserve tvinger kun rytteren af paa disse kategorier (ca. kat. 2 og op).
  wprimeForcedCategories: ["HC", "1", "2"] as readonly ClimbCategory[],

  // ── B: en gruppe kan koere op igen efter en top midt paa etapen ─────────────
  midDescentSecondsPerKm: 4,
  midDescentGapFractionPerKm: 0.04,

  // ── 2: nedkoersel mod maal ──────────────────────────────────────────────────
  finishDescentMaxSecondsPerKm: 1.5,
  finishDescentMaxGapShare: 0.5,
  // Descending-forspring (0-99) der giver det fulde loft pr. km. Under: proportionalt.
  finishDescentAbilitySpanPoints: 15,
  // Teknik: jo mere teknisk, jo mere kan en bedre nedkoerer vinde.
  finishDescentTechnicalityFactor: { 1: 0.6, 2: 0.8, 3: 1 } as Record<1 | 2 | 3, number>,
  // Placeringen i en nedkoerselsfinale: klatring taeller med.
  descentFinaleDemand: { climbing: 0.35, descending: 0.35, positioning: 0.1, aggression: 0.1, tactics: 0.1 } as Partial<Record<AbilityKey, number>>,

  // ── 3: taet score = samme tid i en selektiv finale ──────────────────────────
  finaleTieScoreEpsilon: 0.02,
});

type TimeModelTuning = typeof TIME_MODEL_V3_TUNING;

/** Referencefarten (km/t) op ad en stigning med denne gennemsnitsstigning. */
export function climbSpeedKmh(gradientPct: number, t: TimeModelTuning = TIME_MODEL_V3_TUNING): number {
  const [lo, hi] = t.climbSpeedBoundsKmh;
  const g = Number.isFinite(gradientPct) ? gradientPct : 0;
  if (g <= 0) return hi;
  return clamp(t.climbVerticalSpeedKmh / (g / 100), lo, hi);
}

/** Tiden (s) en stigning tager i referencefarten. */
export function climbTimeSeconds(gradientPct: number, lengthKm: number, t: TimeModelTuning = TIME_MODEL_V3_TUNING): number {
  const km = Number.isFinite(lengthKm) ? Math.max(0, lengthKm) : 0;
  return (km / climbSpeedKmh(gradientPct, t)) * 3600;
}

/**
 * A: hullet (s) en udskilt gruppe faar paa stigningen: stigningens tid x den
 * del de koerer bag gruppen x det relative fartab. Fartabet stiger med det
 * gennemsnitlige klatre-underskud og (svagere) energi-underskud blandt de
 * udskilte. Monotont ikke-faldende i laengde, stigning og begge underskud, saa
 * en svagere gruppe aldrig faar et mindre hul end en staerkere paa samme stigning.
 */
export function climbSplitGapSeconds(
  gradientPct: number,
  lengthKm: number,
  avgDeficit01: number,
  avgEnergyDeficit01: number,
  t: TimeModelTuning = TIME_MODEL_V3_TUNING,
): number {
  const deficit = Number.isFinite(avgDeficit01) ? clamp(avgDeficit01, 0, 1) : 0;
  const energy = Number.isFinite(avgEnergyDeficit01) ? clamp(avgEnergyDeficit01, 0, 1) : 0;
  const loss = clamp(t.climbGapAbilityWeight * deficit + t.climbGapEnergyWeight * energy, 0, t.climbGapMaxRelativeLoss);
  const raw = climbTimeSeconds(gradientPct, lengthKm, t) * t.climbGapExposure * loss;
  const [lo, hi] = t.climbGapBoundsSeconds;
  return round2(clamp(raw, lo, hi));
}

/**
 * A: de afhaengte ryttere samles i faa grupper efter deres eget hul. Sorteret
 * paa hul (stigende, rider_id ved lige hul); en ny gruppe startes naar hullet
 * ligger mere end max(clusterMinSeconds, clusterShare x gruppens foerste hul)
 * bag gruppens foerste rytter. Hoejst `clusterMaxGroups` grupper: resten
 * samles i den sidste. Hver gruppe faar sine rytteres gennemsnitlige hul.
 * Raekkefoelgen af grupper foelger hullet, saa en rytter med mindre hul aldrig
 * ender i en gruppe laengere tilbage end en med stoerre hul.
 */
export function clusterSplitRiders(
  riders: ReadonlyArray<{ riderId: string; gapSeconds: number }>,
  t: TimeModelTuning = TIME_MODEL_V3_TUNING,
): Array<{ riderIds: string[]; gapSeconds: number }> {
  const sorted = [...riders].sort((a, b) => a.gapSeconds - b.gapSeconds || a.riderId.localeCompare(b.riderId));
  const clusters: Array<{ riders: Array<{ riderId: string; gapSeconds: number }> }> = [];
  for (const rider of sorted) {
    const last = clusters[clusters.length - 1];
    const startGap = last?.riders[0].gapSeconds ?? 0;
    const window = Math.max(t.clusterMinSeconds, t.clusterShare * startGap);
    if (!last || (rider.gapSeconds - startGap > window && clusters.length < t.clusterMaxGroups)) clusters.push({ riders: [rider] });
    else last.riders.push(rider);
  }
  return clusters.map((c) => ({
    riderIds: c.riders.map((r) => r.riderId).sort(),
    gapSeconds: round2(c.riders.reduce((sum, r) => sum + r.gapSeconds, 0) / c.riders.length),
  }));
}

/** A: maa en tom reserve tvinge rytteren af paa denne stigning? Kun fra ca. kat. 2. */
export function wprimeForcedCategoryAllowed(category: string | undefined, t: TimeModelTuning = TIME_MODEL_V3_TUNING): boolean {
  return category !== undefined && (t.wprimeForcedCategories as readonly string[]).includes(category);
}

/**
 * 2: hvor meget (s) en jagende gruppe hoejst kan lukke paa en nedkoersel mod
 * maal. 0 naar jagten ikke er den bedre nedkoerer. Op til loftet pr. km ved et
 * klart descending-forspring, skaleret med teknik, og aldrig mere end
 * `finishDescentMaxGapShare` af hullet.
 */
export function finishDescentClosingSeconds(
  gapSeconds: number,
  lengthKm: number,
  technicality: number,
  chaseDescending: number,
  aheadDescending: number,
  t: TimeModelTuning = TIME_MODEL_V3_TUNING,
): number {
  const gap = Number.isFinite(gapSeconds) ? Math.max(0, gapSeconds) : 0;
  const km = Number.isFinite(lengthKm) ? Math.max(0, lengthKm) : 0;
  if (gap === 0 || km === 0) return 0;
  const advantage = (Number(chaseDescending) || 0) - (Number(aheadDescending) || 0);
  if (!(advantage > 0)) return 0;
  const share = t.finishDescentAbilitySpanPoints > 0 ? clamp(advantage / t.finishDescentAbilitySpanPoints, 0, 1) : 1;
  const techKey = clamp(Math.round(technicality) || 2, 1, 3) as 1 | 2 | 3;
  const perKm = t.finishDescentMaxSecondsPerKm * share * t.finishDescentTechnicalityFactor[techKey];
  return round2(Math.min(gap * t.finishDescentMaxGapShare, perKm * km));
}
