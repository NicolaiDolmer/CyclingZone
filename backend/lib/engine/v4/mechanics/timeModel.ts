// backend/lib/engine/v4/mechanics/timeModel.ts
// #6199 + #6200: én faelles tidsmodel for stigning og nedkoersel. Ejer-aftalt
// design 5/10 (kontrakten staar paa #6199; SSOT: docs/RACE_ENGINE_RULES.md,
// "Én tidsmodel for stigning og nedkørsel" og "Samlet Tour-revision
// `official_times_v2`"):
//
//  1. A: hullet en stigning skaber regnes ud fra stigningens laengde, stejlhed og
//     evneforskellen (tiden paa stigningen x det relative fartab), ikke et fast
//     trin. En tom reserve tvinger kun en rytter af paa de haarde kategorier
//     (wprimeForcedCategories).
//     B: efter en top midt paa etapen kan en gruppe koere op igen paa
//     nedkoerslen, og i dalen kan hullet ikke vokse (valleyRegroupTempoV3).
//  2. Nedkoersel mod maal: en klart bedre nedkoerer vinder hoejst et loft pr. km,
//     afhaengigt af laengde og teknik, og hoejst en andel af hullet (bogen
//     bookFinishDescentClosure deles af regruppering, angreb, jagt og finale).
//     Klatring taeller med i placeringen i en nedkoerselsfinale.
//  3. Taet score giver samme tid i en selektiv finale.
//
// Hvem laeser hvad (gaten sidder hos kaldestederne og i timeModelTuningFor):
//  - Legacy, orders_gc_v1 og orders_gc_v2 laeser intet herfra.
//  - orders_gc_v3 laeser modellen med TIME_MODEL_V3_TUNING (kaldestederne gater
//    paa ctx.ordersGcV3).
//  - official_times_v1 (frosset prototype, v2-arvelinje + faelles gruppeklokke)
//    laeser de dele den faelles gruppeklokke bruger (fx dalen), ogsaa med
//    TIME_MODEL_V3_TUNING (kaldestederne gater paa ctx.sharedGroupTime).
//  - official_times_v2 (v3-pakken + faelles gruppeklokke) er den eneste der faar
//    SHARED_TIME_MODEL_V2_TUNING (timeModelTuningFor: ordersGcV3 OG
//    sharedGroupTime). Knapperne der kun den laeser, er neutrale i v3-tallene, saa
//    orders_gc_v3 og official_times_v1 er byte-identiske (frosne digests).
//
// Alle konstanter er kalibreret privat mod ejer-maalene (balance-internals/6199/).
//
// REN: ingen IO, ingen rng.

import type { AbilityKey, ClimbCategory, FinaleType, ProfileType, RaceGroup, Segment } from "../types.ts";
import type { GcDangerTuning } from "./gcThreat.ts";

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
  climbGapExposure: 0.5,
  // Relativt fartab pr. enhed klatre-underskud (0-1 mod gruppens bedste klatrer).
  climbGapAbilityWeight: 1.0,
  // Konveks del af fartabet (underskud i anden): 0 = lineaert (orders_gc_v3).
  climbGapAbilityWeightQuadratic: 0,
  // KUN official_times_v2: evne-vaegten pr. etapeprofil (udeladt = climbGapAbilityWeight).
  climbGapAbilityWeightByProfile: {} as Readonly<Partial<Record<ProfileType, number>>>,
  // Relativt fartab pr. enhed energi-underskud (tom reserve = 1).
  climbGapEnergyWeight: 0.02,
  climbGapMaxRelativeLoss: 0.6,
  // Et split er altid mindst saa stort, at det overlever segmentets merge-trin.
  climbGapBoundsSeconds: [3, 900] as readonly [number, number],
  // De afhaengte samles i faa grupper efter eget hul (clusterSplitRiders).
  clusterMinSeconds: 8,
  clusterShare: 0.15,
  clusterMaxGroups: 8,
  // En tom reserve tvinger kun rytteren af paa disse kategorier (ca. kat. 2 og op).
  wprimeForcedCategories: ["HC", "1", "2"] as readonly ClimbCategory[],

  // ── B: en gruppe kan koere op igen efter en top midt paa etapen ─────────────
  midDescentSecondsPerKm: 4,
  midDescentGapFractionPerKm: 0.04,
  // I dalen efter en top kan hullet ikke vokse for grupper inden for denne raekkevidde (s).
  valleyReachSeconds: 180,
  // KUN official_times_v2: i dalen koerer gruppen bagved op igen (B), som fart:
  // sekunder pr. km + andel af hullet pr. km, skaleret med antallet bagved mod
  // antallet foran. 0 = ingen lukning (orders_gc_v3: hullet kan kun ikke vokse).
  valleyClosingSecondsPerKm: 0,
  valleyClosingGapFractionPerKm: 0,

  // ── 2: nedkoersel mod maal ──────────────────────────────────────────────────
  finishDescentMaxSecondsPerKm: 1.5,
  finishDescentMaxGapShare: 0.5,
  // Descending-forspring (0-99) der giver det fulde loft pr. km. Under: proportionalt.
  finishDescentAbilitySpanPoints: 15,
  // Teknik: jo mere teknisk, jo mere kan en bedre nedkoerer vinde.
  finishDescentTechnicalityFactor: { 1: 0.6, 2: 0.8, 3: 1 } as Record<1 | 2 | 3, number>,
  // Placeringen i en nedkoerselsfinale: klatring taeller med.
  descentFinaleDemand: { climbing: 0.35, descending: 0.35, positioning: 0.1, aggression: 0.1, tactics: 0.1 } as Partial<Record<AbilityKey, number>>,

  // ── Massefinale (KUN official_times_v2): feltets antals-fordel som lukning ──
  // Hoejst saa mange sekunder pr. km af finalens segment (fart, ikke vindue).
  bunchClosingMaxSecondsPerKm: 20,
  // KUN official_times_v2: skalering af M5s lad-gaa-loft (1 = uaendret).
  letGoMaxGapScale: 1,
  // #5578 (KUN official_times_v2): lad-gaa-loftets skalering pr. etapeprofil
  // (udeladt = letGoMaxGapScale).
  letGoMaxGapScaleByProfile: {} as Readonly<Partial<Record<ProfileType, number>>>,
  // #5578 (KUN official_times_v2): finalens faktor paa lad-gaa-loftet pr. finaletype
  // (udeladt = BREAKAWAY_EXTRA_TUNING.maxGapFinaleFactor).
  letGoFinaleFactorByFinale: {} as Readonly<Partial<Record<FinaleType, number>>>,
  // #5578 (KUN official_times_v2): mindste jagtgruppe der er et "felt", der kan
  // lade dagens udbrud gaa (null = BREAKAWAY_EXTRA_TUNING.letGoMinChaseRiders).
  letGoMinChaseRiders: null as number | null,
  // #5578 (KUN official_times_v2): et farligt udbrud (et hold i jagtgruppen
  // bremser for en rytter i det) faar aldrig et lad-gaa-loft over det mindste
  // tolererede forspring blandt de bremsende hold. false = kun bremsen (v3).
  letGoCapAtTolerated: false,
  // #5578 (KUN official_times_v2, etapeloeb): GC-reaktionens farligheds-tuning
  // (gcThreat.DangerModel.tuning). null = orders_gc_v3s vaerdier (bit-identisk).
  gcDanger: null as GcDangerTuning | null,

  // ── 3: taet score = samme tid i en selektiv finale ──────────────────────────
  finaleTieScoreEpsilon: 0.02,
});

export type TimeModelTuning = typeof TIME_MODEL_V3_TUNING;

/**
 * #6199 (KUN official_times_v2): den samlede tidsmodel kalibreret paa den faelles
 * gruppeklokke. Samme form som v3-modellen; kun de kalibrerede felter afviger.
 * orders_gc_v3 og official_times_v1 laeser aldrig dette (gamle digests uaendrede).
 */
export const SHARED_TIME_MODEL_V2_TUNING: TimeModelTuning = freeze({
  ...TIME_MODEL_V3_TUNING,
  // Slutstigningen paa en topankomst spreder hele gruppen individuelt
  // (climbSelection.summitRace), saa evne-vaegten er lavere end v3s.
  climbGapAbilityWeight: 0.8,
  // Kuperet/rullende/fladt: hoejere fart og mere lae paa stigningerne.
  climbGapAbilityWeightByProfile: { flat: 0.5, rolling: 0.5, hilly: 0.5 },
  // Uden v3s ikke-fysiske lukning paa nedkoerslen skal jagten hente udbruddet
  // fysisk; feltet giver derfor et mindre lad-gaa-loft (profiler uden egen vaerdi).
  letGoMaxGapScale: 0.7,
  // #5578 (ejer 8/10, udbrudsmaal 2-4): loftet pr. vejprofil, kalibreret privat
  // (balance-internals/5578-official-v2/) paa Tour- og Giro-feltet.
  letGoMaxGapScaleByProfile: { flat: 1.8, rolling: 1.5, hilly: 3, mountain: 3, high_mountain: 1.5 },
  // #5578: foran en nedkoerselsfinale kontrollerer feltet hullet lidt mindre stramt.
  letGoFinaleFactorByFinale: { descent: 0.65 },
  // #5578: favoritgruppen er stadig et felt, der styrer udbruddet, naar
  // selektionen paa stigningerne har gjort den lille.
  letGoMinChaseRiders: 10,
  // #5578 (udbrudsmaal 6): et farligt udbrud vokser aldrig forbi det tolererede.
  letGoCapAtTolerated: true,
  // #5578: hvem har noget at forsvare (klassementets forreste og foereren), hvem
  // er en rival (de forreste altid; ellers kun en mindst lige saa staerk rytter),
  // og snoren for de forreste er altid holdt og har et loft.
  gcDanger: {
    futureSecondsPerStage: 40,
    defendBaseSeconds: 0,
    defendSecondsPerStage: 0,
    leashMarginSeconds: 75,
    rivalStrengthMin: 1,
    rivalRankAlways: 10,
    rankedLeadCapSeconds: 150,
  },
  // B i dalen som fart (valleyRegroupTempoV3).
  valleyClosingSecondsPerKm: 2,
  valleyClosingGapFractionPerKm: 0.02,
});

// Den kalibrerede tuning pr. profil med egen evne-vaegt (beregnet én gang).
const SHARED_BY_PROFILE: Readonly<Partial<Record<ProfileType, TimeModelTuning>>> = Object.freeze(Object.fromEntries(
  Object.entries(SHARED_TIME_MODEL_V2_TUNING.climbGapAbilityWeightByProfile)
    .map(([profile, weight]) => [profile, freeze({ ...SHARED_TIME_MODEL_V2_TUNING, climbGapAbilityWeight: weight as number })]),
));

/**
 * Tidsmodellens tuning for en hook-kontekst: den kalibrerede kun under
 * official_times_v2 (v3-pakken + den faelles gruppeklokke), ellers v3-tallene.
 */
export function timeModelTuningFor(ctx: { ordersGcV3?: true; sharedGroupTime?: unknown; route?: { profile_type: ProfileType } }): TimeModelTuning {
  if (!(ctx.ordersGcV3 === true && ctx.sharedGroupTime !== undefined)) return TIME_MODEL_V3_TUNING;
  return (ctx.route ? SHARED_BY_PROFILE[ctx.route.profile_type] : undefined) ?? SHARED_TIME_MODEL_V2_TUNING;
}

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
  const loss = clamp(t.climbGapAbilityWeight * deficit + t.climbGapAbilityWeightQuadratic * deficit * deficit + t.climbGapEnergyWeight * energy, 0, t.climbGapMaxRelativeLoss);
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

/**
 * 2: loftet over finalens jagt paa en nedkoersel mod maal: hoejst
 * `finishDescentMaxSecondsPerKm` pr. km og hoejst `finishDescentMaxGapShare`
 * af hullet. Samme loft som regrupperingen, saa et hul ved toppen aldrig
 * forsvinder paa nedkoerslen, uanset hvem der jager.
 */
export function finishDescentChaseCapSeconds(gapSeconds: number, lengthKm: number, t: TimeModelTuning = TIME_MODEL_V3_TUNING): number {
  const gap = Number.isFinite(gapSeconds) ? Math.max(0, gapSeconds) : 0;
  const km = Number.isFinite(lengthKm) ? Math.max(0, lengthKm) : 0;
  return round2(Math.min(gap * t.finishDescentMaxGapShare, t.finishDescentMaxSecondsPerKm * km));
}

/**
 * 2: det der er tilbage af loftet til finalens jagt paa en nedkoersel mod maal,
 * naar regrupperingen paa samme segment allerede har lukket `regroupClosedSeconds`
 * af et hul paa `topGapSeconds` ved toppen. Loftet gaelder de to lag TILSAMMEN:
 * regruppering + jagt lukker aldrig mere end finishDescentChaseCapSeconds(hullet
 * ved toppen), og jagten aldrig mere end loftet paa sit eget, resterende hul.
 * Uden en regruppering (null) er det loftet paa det resterende hul.
 */
export function finishDescentRemainingCapSeconds(
  carriedGapSeconds: number,
  lengthKm: number,
  regroup: { topGapSeconds: number; closedSeconds: number } | null | undefined,
  t: TimeModelTuning = TIME_MODEL_V3_TUNING,
): number {
  const ownCap = finishDescentChaseCapSeconds(carriedGapSeconds, lengthKm, t);
  if (!regroup) return ownCap;
  const closed = Number.isFinite(regroup.closedSeconds) ? Math.max(0, regroup.closedSeconds) : 0;
  return round2(Math.max(0, Math.min(ownCap, finishDescentChaseCapSeconds(regroup.topGapSeconds, lengthKm, t) - closed)));
}

/**
 * 2 (review af #6223): loftet over et nedkoerselsangrebs (M3) gevinst paa en
 * nedkoersel mod maal. Tre graenser, den mindste vinder:
 *   - inde i gruppen: hoejst loftet pr. km (den bedste nedkoerer vinder aldrig mere);
 *   - mod gruppen umiddelbart foran ved toppen (ogsaa dagens udbrud): det
 *     regrupperingen allerede har lukket + gevinsten holder sig under loftet paa
 *     hullet ved toppen, saa angriberen aldrig passerer den;
 *   - mod fronten ved toppen: samme delte loft som regrupperingen, M5's jagt og
 *     finalens jagt (bogen, finishDescentRemainingCapSeconds).
 * `ahead`/`front` er null for gruppen der var forrest ved toppen. Et negativt
 * `closedSeconds` (gruppen foran koerte selv fra) giver plads, aldrig mere end loftet.
 */
export function finishDescentAttackGainCapSeconds(
  lengthKm: number,
  ahead: { topGapSeconds: number; closedSeconds: number } | null,
  front: { topGapSeconds: number; closedSeconds: number } | null,
  t: TimeModelTuning = TIME_MODEL_V3_TUNING,
): number {
  const km = Number.isFinite(lengthKm) ? Math.max(0, lengthKm) : 0;
  let cap = t.finishDescentMaxSecondsPerKm * km;
  for (const ref of [ahead, front]) {
    if (!ref) continue;
    const closed = Number.isFinite(ref.closedSeconds) ? ref.closedSeconds : 0;
    cap = Math.min(cap, finishDescentChaseCapSeconds(ref.topGapSeconds, km, t) - closed);
  }
  return round2(Math.max(0, cap));
}

/**
 * 2 (review af #6223): laegger `closedSeconds` til bogen for `groupId` paa en
 * nedkoersel mod maal (regruppering, M3-angreb, M5's jagt), saa finalens jagt
 * kun faar resten af loftet. `topGapSeconds` bruges kun, naar gruppen ikke staar
 * i bogen i forvejen. Ren: returnerer en ny bog; uaendret ved 0 eller mindre.
 */
export function bookFinishDescentClosure(
  book: Record<string, { topGapSeconds: number; closedSeconds: number }> | undefined,
  groupId: string,
  topGapSeconds: number,
  closedSeconds: number,
): Record<string, { topGapSeconds: number; closedSeconds: number }> | undefined {
  if (!(closedSeconds > 0)) return book;
  const prior = book?.[groupId];
  return {
    ...(book ?? {}),
    [groupId]: {
      topGapSeconds: prior?.topGapSeconds ?? round2(Math.max(0, topGapSeconds)),
      closedSeconds: round2((prior?.closedSeconds ?? 0) + closedSeconds),
    },
  };
}

/** Dagens udbrud (samme definition som finale.isEscapeGroup). M5 ejer hullet til det. */
export function isEscapeGroupV3(group: Pick<RaceGroup, "kind" | "origin">): boolean {
  return group.origin === "breakaway" && (group.kind === "breakaway" || group.kind === "solo");
}

/**
 * B: i dalen efter en top (fladt/rullende terraen efter etapens foerste
 * stigning) kan hullet mellem to grupper ikke vokse, saa laenge den bagerste
 * ligger inden for `valleyReachSeconds` af gruppen foran. Den kan stadig
 * krympe (en stoerre gruppe koerer hurtigere i laeet). Gruppen foran er den
 * naermeste gruppe der ikke er dagens udbrud (M5 ejer det hul). Grupper i en
 * uheldsjagt (state.incident_chasers) roeres ikke: deres tempo er sat af
 * jagt-blokken. Grupper laengere bag (grupettoen) driver som foer.
 *
 * Returnerer samme Map naar intet aendres (bit-identisk uden effekt).
 */
export function valleyRegroupTempoV3<T extends { dtSeconds: number }>(
  groups: readonly RaceGroup[],
  tempoByGroup: Map<string, T>,
  segments: readonly (Pick<Segment, "kind"> & Partial<Pick<Segment, "from_km" | "to_km">>)[],
  segmentIndex: number,
  incidentChasers: Readonly<Record<string, unknown>> | undefined,
  t: TimeModelTuning = TIME_MODEL_V3_TUNING,
): Map<string, T> {
  const kind = segments[segmentIndex]?.kind;
  const seg = segments[segmentIndex];
  const lengthKm = seg && Number.isFinite(seg.from_km) && Number.isFinite(seg.to_km) ? Math.max(0, (seg.to_km as number) - (seg.from_km as number)) : 0;
  if (kind !== "flat" && kind !== "rolling") return tempoByGroup;
  if (!segments.slice(0, segmentIndex).some((s) => s.kind === "climb")) return tempoByGroup;
  const sorted = [...groups].sort((a, b) => a.gap_seconds - b.gap_seconds || a.id.localeCompare(b.id));
  let out: Map<string, T> | null = null;
  let reference: { gap: number; dtSeconds: number; size: number } | null = null;
  for (const group of sorted) {
    if (isEscapeGroupV3(group)) continue;
    const own = (out ?? tempoByGroup).get(group.id);
    if (!own) continue;
    const inIncidentChase = incidentChasers !== undefined && group.rider_ids.some((id) => incidentChasers[id] !== undefined);
    // KUN official_times_v2 (B i dalen): gruppen bagved lukker som fart, aldrig
    // mere end hullet, skaleret med antallet bagved mod antallet foran.
    const gapToAhead = reference === null ? 0 : Math.max(0, group.gap_seconds - reference.gap);
    const closing = reference === null || !(t.valleyClosingSecondsPerKm > 0 || t.valleyClosingGapFractionPerKm > 0) ? 0
      : Math.min(gapToAhead, lengthKm * (t.valleyClosingSecondsPerKm + t.valleyClosingGapFractionPerKm * gapToAhead)
        * clamp(group.rider_ids.length / Math.max(1, reference.size), 0, 1));
    if (
      reference !== null
      && !inIncidentChase
      && group.gap_seconds - reference.gap <= t.valleyReachSeconds
      && own.dtSeconds > reference.dtSeconds - closing
    ) {
      out ??= new Map(tempoByGroup);
      out.set(group.id, { ...own, dtSeconds: reference.dtSeconds - closing });
    }
    reference = { gap: group.gap_seconds, dtSeconds: (out ?? tempoByGroup).get(group.id)?.dtSeconds ?? own.dtSeconds, size: group.rider_ids.length };
  }
  return out ?? tempoByGroup;
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
