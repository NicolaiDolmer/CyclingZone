// backend/lib/engine/v4/mechanics/descentRegroup6486.ts
// #6486 D3 (afgjort D1, motor; KUN s5_profiles_v3, live under den aktuelle revision): paa en bjergetape
// uden topankomst kan grupperne samle sig paa vejen fra sidste top til maal.
//
// Problemet: under official_times_v3/v4 staar hullet ved sidste top naesten
// uroert til stregen, naar nedkoerslen ender kort foer maal (#6200's loft gaelder
// fra toppen til stregen). Favoritterne kommer over toppen som enkeltryttere og
// smaa grupper med faa sekunder imellem, og ingen af dem samles igen, saa nr. 10
// ligger over loftet for bjerg uden topankomst (#6456). Er det flade stykke
// laengere (en dal, #6199 B), samles de derimod naesten helt. To naesten ens
// ruter giver dermed vidt forskellige tidshuller.
//
// Reglen (som i virkeligheden): paa nedkoerslen og det flade/rullende stykke
// efter etapens sidste stigning lukker en gruppe ind paa gruppen foran, naar den
// er inden for raekkevidde. Farten kommer af samarbejde:
//   - flere ryttere i den jagende gruppe = mere fart (op til en fuld gruppe);
//   - en enkeltrytter lukker kun lidt;
//   - en mindre gruppe bag en stoerre lukker mindre (gruppen foran koerer ogsaa).
// Grupper der samles undervejs, jager videre som én gruppe (sneboldeffekten),
// regnet i smaa skridt inde i segmentet. Et hul kan kun krympe, aldrig mere end
// hullet, og raekkefoelgen er uaendret.
//
// En gruppe koerer aldrig mere end et fysisk loft hurtigere end sin egen fart.
//
// Uroert: ethvert stykke af dagens udbrud (M5 ejer det hul, #5812), grupper i en uheldsjagt,
// topankomster (etapen slutter paa en stigning), alt foer sidste stigning, og
// alle profiler uden for bjerg/hoejfjeld. Alle aeldre revisioner kalder aldrig
// modulet (segmentLoop.ts gater paa isS5ProfilesV3OrLater): bit-identiske.
//
// #7644 (KUN kontakten descent_regroup_cap_7644, SLUKKET): paa en lang nedkoersel kunne en
// kaede af smaa grupper med korte huller imellem accelerere oven i hinanden, saa den
// bagerste gruppe vandt minutter paa gruppen foran kaeden. Kontakten laegger et loft paa,
// hvor meget hurtigere end sin egen fart en gruppe samlet kan koere pr. km. Loftet sidder
// kun paa #6486's egen tuning; #7236's dronningeetape-tuning er uroert. Slukket =
// bit-identisk. Tal kun privat (balance-internals/7644/, hard rule 17).
//
// REN: ingen IO, ingen rng. Returnerer samme Map naar intet aendres.
import type { ProfileType, RaceGroup, Segment, SegmentKind, StageInput } from "../types.ts";
import { compareIds } from "../../../compareIds.ts";
import { QUEEN_STAGE_GAP_7236_TUNING } from "../tuning.ts"; // #7236
import { isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts"; // #7644

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

export type DescentRegroup6486Tuning = {
  /** Profilerne reglen gaelder paa. */
  profiles: readonly ProfileType[];
  /** Hoejeste hul (s) til gruppen foran, hvor en gruppe stadig kan lukke. */
  reachSeconds: number;
  /** Lukning (s pr. km) for en fuld, samarbejdende gruppe, pr. terraen. Udeladt terraen = 0. */
  secondsPerKmByKind: Readonly<Partial<Record<SegmentKind, number>>>;
  /** En enkeltrytters andel af den fulde gruppes lukning. */
  soloShare: number;
  /** Rytterantal hvor gruppen samarbejder fuldt. */
  fullCooperationRiders: number;
  /** Bund paa forholdet (jagende / foran), naar gruppen foran er stoerst. */
  sizeRatioFloor: number;
  /** Skridtlaengde (km) inde i et segment, saa grupper der samles jager videre sammen. */
  stepKm: number;
  /** Hoejeste andel en gruppe kan koere hurtigere end sin egen fart paa segmentet (fysisk loft, < 1). */
  maxSpeedGainShare: number;
  /**
   * #7644 (KUN kontakten descent_regroup_cap_7644): hoejeste samlede gevinst (s pr. km) en gruppe
   * kan hente i forhold til sin egen fart paa segmentet. Udeladt eller Infinity = intet loft.
   */
  maxClosingSecondsPerKm?: number;
};

/** #6486 (KUN s5_profiles_v3, deep-frosset). */
export const DESCENT_REGROUP_6486_TUNING: DescentRegroup6486Tuning = deepFreeze({
  profiles: ["mountain", "high_mountain"] as readonly ProfileType[],
  reachSeconds: 90,
  secondsPerKmByKind: { descent: 2.5, flat: 5, rolling: 4 },
  soloShare: 0.25,
  fullCooperationRiders: 5,
  sizeRatioFloor: 0.4,
  stepKm: 1,
  maxSpeedGainShare: 0.15,
  maxClosingSecondsPerKm: 2, // #7644: virker kun med kontakten (descentRegroupTempo6486, capOn)
});

/**
 * #7236 (KUN kontakten queen_stage_gap_7236, SLUKKET): paa en bjergetape med kort vej fra
 * sidste top til maal lukker grupperne lidt hurtigere og fra lidt laengere bag, saa
 * favoritterne der kom over toppen under loftet (climbSelection.queenStageTopCap7236) kan
 * samles paa nedkoerslen. Resten af reglen er #6486's. Kalibreret privat (balance-internals/7236/).
 */
export const DESCENT_REGROUP_7236_TUNING: DescentRegroup6486Tuning = deepFreeze({
  ...DESCENT_REGROUP_6486_TUNING,
  reachSeconds: 160,
  secondsPerKmByKind: { descent: 4, flat: 5, rolling: 4 },
  maxClosingSecondsPerKm: Infinity, // #7644: dronningeetaperne faar intet loft
});

/** #7644: kontakten. Kun s5_profiles_v3 (og senere) OG et eksplicit flag; haandbyggede fixtures og aeldre revisioner: nej. */
export function descentRegroupCap7644On(input: Pick<StageInput, "rules_revision" | "descent_regroup_cap_7644">): boolean {
  return input.descent_regroup_cap_7644 === true && isS5ProfilesV3OrLater(input.rules_revision);
}

/**
 * #7236: regrupperingens tuning paa ruten. Kontakten slukket, eller lang vej fra sidste
 * top til maal: #6486's egen (samme objekt, bit-identisk). Ellers DESCENT_REGROUP_7236_TUNING.
 */
export function descentRegroupTuning7236(
  on: boolean,
  route: { distance_km?: number; segments: readonly (Pick<Segment, "kind"> & Partial<Pick<Segment, "to_km">>)[] },
  maxTopToFinishKm: number = QUEEN_STAGE_GAP_7236_TUNING.maxTopToFinishKm,
): DescentRegroup6486Tuning {
  if (!on) return DESCENT_REGROUP_6486_TUNING;
  const segs = route.segments ?? [];
  const last = lastClimbIndex(segs);
  const topKm = last >= 0 ? segs[last].to_km : undefined;
  const finishKm = Number.isFinite(route.distance_km) ? route.distance_km : segs[segs.length - 1]?.to_km;
  if (!Number.isFinite(topKm) || !Number.isFinite(finishKm)) return DESCENT_REGROUP_6486_TUNING;
  return (finishKm as number) - (topKm as number) < maxTopToFinishKm ? DESCENT_REGROUP_7236_TUNING : DESCENT_REGROUP_6486_TUNING;
}

/** Indekset for etapens sidste stigning, eller -1. */
function lastClimbIndex(segments: readonly Pick<Segment, "kind">[]): number {
  for (let i = segments.length - 1; i >= 0; i--) if (segments[i].kind === "climb") return i;
  return -1;
}

/**
 * Gaelder reglen paa dette segment? Bjerg/hoejfjeld uden topankomst (etapens sidste
 * segment er ikke en stigning), et segment EFTER sidste stigning, og et terraen
 * med en lukning (nedkoersel, flad, rullende).
 */
export function descentRegroup6486Applies(
  route: { profile_type?: ProfileType; segments: readonly Pick<Segment, "kind">[] },
  segmentIndex: number,
  t: DescentRegroup6486Tuning = DESCENT_REGROUP_6486_TUNING,
): boolean {
  const segs = route.segments ?? [];
  const seg = segs[segmentIndex];
  if (!seg || route.profile_type === undefined || !t.profiles.includes(route.profile_type)) return false;
  if (segs[segs.length - 1]?.kind === "climb") return false;
  const lastClimb = lastClimbIndex(segs);
  if (lastClimb < 0 || segmentIndex <= lastClimb) return false;
  return (t.secondsPerKmByKind[seg.kind] ?? 0) > 0;
}

/** Gaelder reglen paa mindst ét segment af ruten? */
export function descentRegroup6486OnRoute(
  route: { profile_type?: ProfileType; segments: readonly Pick<Segment, "kind">[] },
  t: DescentRegroup6486Tuning = DESCENT_REGROUP_6486_TUNING,
): boolean {
  return (route.segments ?? []).some((_, i) => descentRegroup6486Applies(route, i, t));
}

/** Samarbejdet i en gruppe paa `riders` ryttere (andel af den fulde gruppes fart). */
export function cooperationShare(riders: number, t: DescentRegroup6486Tuning = DESCENT_REGROUP_6486_TUNING): number {
  const n = Math.max(1, Math.floor(Number(riders) || 1));
  const full = Math.max(2, t.fullCooperationRiders);
  const ramp = Math.min(1, (n - 1) / (full - 1));
  return t.soloShare + (1 - t.soloShare) * ramp;
}

/** Lukning (s pr. km) for en gruppe paa `chaseRiders` bag en gruppe paa `aheadRiders`. */
export function closingSecondsPerKm(
  kind: SegmentKind,
  chaseRiders: number,
  aheadRiders: number,
  t: DescentRegroup6486Tuning = DESCENT_REGROUP_6486_TUNING,
): number {
  const base = t.secondsPerKmByKind[kind] ?? 0;
  if (!(base > 0)) return 0;
  const n = Math.max(1, chaseRiders);
  const m = Math.max(1, aheadRiders);
  const ratio = Math.min(1, Math.max(t.sizeRatioFloor, n / m));
  return base * cooperationShare(n, t) * ratio;
}

type Chain = { id: string; gap: number; riders: number };

/**
 * Hvor mange sekunder hver gruppe lukker paa gruppen umiddelbart foran (i kaeden af
 * grupper uden dagens udbrud og uheldsjagter) paa et segment af `lengthKm` km.
 * Kaeden regnes i skridt af `stepKm`: grupper der faar kontakt, jager videre som én.
 * Resultatet er altid >= 0 og aldrig mere end hullet ved segmentets start. REN.
 */
export function regroupClosingSeconds(
  chain: readonly Chain[],
  kind: SegmentKind,
  lengthKm: number,
  t: DescentRegroup6486Tuning = DESCENT_REGROUP_6486_TUNING,
): Map<string, number> {
  const out = new Map<string, number>();
  const sorted = [...chain].sort((a, b) => a.gap - b.gap || compareIds(a.id, b.id));
  for (const g of sorted) out.set(g.id, 0);
  const km = Number.isFinite(lengthKm) ? Math.max(0, lengthKm) : 0;
  if (sorted.length < 2 || km === 0 || !((t.secondsPerKmByKind[kind] ?? 0) > 0)) return out;
  // Hul til gruppen foran (s), og klynger af grupper der har kontakt.
  const holes = sorted.map((g, i) => (i === 0 ? 0 : Math.max(0, g.gap - sorted[i - 1].gap)));
  const closed = sorted.map(() => 0);
  const steps = Math.max(1, Math.ceil(km / Math.max(0.1, t.stepKm)));
  const h = km / steps;
  for (let s = 0; s < steps; s++) {
    // Klyngens rytterantal: en gruppe i kontakt med gruppen foran hoerer til samme klynge.
    const clusterRiders: number[] = [];
    const clusterStart: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && holes[i] <= 0) {
        clusterStart[i] = clusterStart[i - 1];
        clusterRiders[clusterStart[i]] += sorted[i].riders;
      } else {
        clusterStart[i] = i;
        clusterRiders[i] = sorted[i].riders;
      }
    }
    for (let i = 1; i < sorted.length; i++) {
      if (holes[i] <= 0 || holes[i] > t.reachSeconds) continue;
      const ahead = clusterRiders[clusterStart[i - 1]];
      // Klyngen bagved: gruppen selv + dem der allerede sidder paa dens hjul.
      let behind = sorted[i].riders;
      for (let j = i + 1; j < sorted.length && holes[j] <= 0; j++) behind += sorted[j].riders;
      const step = Math.min(holes[i], h * closingSecondsPerKm(kind, behind, ahead, t));
      holes[i] = holes[i] - step < 1e-9 ? 0 : holes[i] - step;
      closed[i] += step;
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const startHole = Math.max(0, sorted[i].gap - sorted[i - 1].gap);
    out.set(sorted[i].id, holes[i] === 0 ? startHole : Math.min(startHole, closed[i]));
  }
  return out;
}

// Codex-review: ethvert stykke af morgenudbruddet (ogsaa en "chase"-gruppe der er
// splittet ud af det paa en stigning) ejes af M5, aldrig kun breakaway/solo.
const isMorningBreakawayPiece = (g: Pick<RaceGroup, "origin">): boolean => g.origin === "breakaway";

/**
 * Tempo-laget i segment-loopet: en gruppe inden for raekkevidde koerer segmentet
 * mindst saa hurtigt, at den lukker sin del af hullet til gruppen foran
 * (regroupClosingSeconds). Laget kan kun goere en gruppe hurtigere, aldrig
 * langsommere, og roerer aldrig dagens udbrud eller en uheldsjagt. Samme Map naar
 * reglen ikke gaelder eller intet aendres.
 */
export function descentRegroupTempo6486<T extends { dtSeconds: number }>(
  groups: readonly RaceGroup[],
  tempoByGroup: Map<string, T>,
  route: { profile_type?: ProfileType; segments: readonly (Pick<Segment, "kind"> & Partial<Pick<Segment, "from_km" | "to_km">>)[] },
  segmentIndex: number,
  incidentChasers: Readonly<Record<string, unknown>> | undefined,
  t: DescentRegroup6486Tuning = DESCENT_REGROUP_6486_TUNING,
  capOn = false, // #7644 (slukket): loftet pr. km (t.maxClosingSecondsPerKm) gaelder kun med kontakten
): Map<string, T> {
  if (!descentRegroup6486Applies(route, segmentIndex, t)) return tempoByGroup;
  const seg = route.segments[segmentIndex];
  const lengthKm = Number.isFinite(seg.from_km) && Number.isFinite(seg.to_km) ? Math.max(0, (seg.to_km as number) - (seg.from_km as number)) : 0;
  const capPerKm = capOn === true && Number.isFinite(t.maxClosingSecondsPerKm) ? Math.max(0, t.maxClosingSecondsPerKm as number) : null;
  const inIncident = (g: RaceGroup) => incidentChasers !== undefined && g.rider_ids.some((id) => incidentChasers[id] !== undefined);
  const chainGroups = [...groups]
    .filter((g) => !isMorningBreakawayPiece(g) && !inIncident(g) && g.rider_ids.length > 0 && tempoByGroup.has(g.id))
    .sort((a, b) => a.gap_seconds - b.gap_seconds || compareIds(a.id, b.id));
  if (chainGroups.length < 2) return tempoByGroup;
  const closing = regroupClosingSeconds(chainGroups.map((g) => ({ id: g.id, gap: g.gap_seconds, riders: g.rider_ids.length })), seg.kind, lengthKm, t);
  let out: Map<string, T> | null = null;
  let reference: { gap: number; dt: number } | null = null;
  for (const group of chainGroups) {
    const own = (out ?? tempoByGroup).get(group.id) as T;
    if (reference !== null) {
      const close = closing.get(group.id) ?? 0;
      // Ankomst = gap + dt, saa hullet til gruppen foran krymper med `close`. Codex-review:
      // en lang kaede maa aldrig summere til en ugyldig (for kort) tid, saa en gruppe koerer
      // hoejst `maxSpeedGainShare` hurtigere end sin egen fart (gruppen bag maaler mod den).
      // Loftet er paa FARTEN: v' <= v * (1 + andel) <=> dt' >= dt / (1 + andel). (dt * (1 - andel)
      // ville give mere end andelen i fart; Codex #7175.)
      let target = Math.max(reference.dt - close, own.dtSeconds / (1 + t.maxSpeedGainShare));
      // #7644 (kun med kontakten): lukningen summeres ned gennem kaeden (referencen er gruppen
      // foran EFTER dens egen acceleration), saa gevinsten i forhold til egen fart faar ogsaa et
      // loft pr. km. Kun langsommere, aldrig hurtigere; raekkefoelgen bevares derfor.
      if (capPerKm !== null) target = Math.max(target, own.dtSeconds - capPerKm * lengthKm);
      if (close > 0 && own.dtSeconds > target) {
        out ??= new Map(tempoByGroup);
        out.set(group.id, { ...own, dtSeconds: target });
      }
    }
    reference = { gap: group.gap_seconds, dt: (out ?? tempoByGroup).get(group.id)?.dtSeconds ?? own.dtSeconds };
  }
  return out ?? tempoByGroup;
}
