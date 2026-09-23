// backend/lib/engine/v4/mechanics/individualTimeTrial.ts
// Race Engine v4 (#5576): enkeltstarten (itt, itt_hilly) koeres som en
// INDIVIDUEL start, ikke som en massestart.
//
// FEJLEN (#5576, reproduceret paa main 23/9): simulateStageV4 forgrenede kun
// profile_type "ttt", saa en enkeltstart faldt igennem til massestartens
// segment-loop med felt, laee og udbrud. Paa de pinnede ITT-proxy-etaper delte
// naesten hele feltet vindertiden, der dannedes udbrud, og finalen udsendte
// `sprint_decided`. Invariant 7 (RACE_ENGINE_RULES §3) siger det modsatte:
// selektive finaler, HERUNDER ITT, beholder individuelle tider.
//
// MODELLEN: holdtidskoerslens kerne (mechanics/teamTimeTrial.ts's
// `runTimeTrialStage`) med ÉT HOLD PR. RYTTER. Kernen giver allerede egen start
// fra nul, M10's uheld, M15's graense pr. ankomstgruppe og M9's maalpassage.
// Med én rytter pr. enhed betyder det:
//   - egen start og egen tid: holdets "k'te passage" clampes til 1 = rytteren;
//   - intet laee: rytteren koerer alene, altid "paa fronten";
//   - ingen udbrud, intet `sprint_decided`: kernen har hverken udbruds- eller
//     finale-hooket — tidskoerslens historie er tiderne selv (samme regel som
//     v3's raceTimeline.js, #4373);
//   - M10: ingen hjaelper taet paa (ingen holdkammerat i enheden), og et
//     tidstab rammer kun rytteren selv;
//   - M15: graensen maales pr. rytter mod vindertiden, uden grupetto-redning
//     (en enkeltstart har ingen grupetto) — samme faktor som §2d's tabel.
//
// HVAD DER ER ANDERLEDES END TTT: segment-tikket. TTT's tik er et holds
// work-rotation paa den absolutte fart-formel; en rytter alene har hverken
// rotation eller laee, og den absolutte formel er netop den #4885 fjernede fra
// vejetapen (den loeftede hele feltet ind i ét smalt baand). Enkeltstartens tik
// er derfor:
//
//   evne    Tidskoersels-evnen pr. terraen: finale-tuningens `solo_tt`-vektor
//           (den samme vektor der i dag afgoer en enkeltstart og definerer
//           harnessens ITT-favorit) paa alt undtagen stigninger; paa en
//           stigning `long_climb`-vektoren, fordi op ad bakke er det klatringen
//           der saetter farten (itt_hilly). Ingen nye evne-vaegte.
//   dagen   Samme lag som vejetapen, i samme raekkefoelge: M7's distance-/
//           dag-til-dag-slid, M11's vejr og udmattelsen (W'-reserven), alle
//           proportionale, derefter dagsformen (§2 invariant 3: ingen af dem
//           kan vende to rytteres orden paa samme dag).
//   fart    RELATIV til feltets reference (top-`work.frontFraction`, samme
//           regel som vejetapens referenceCpByKind), terraen-vaegtet med
//           STRENGTH_SPEED_EXTRA_TUNING.terrainWeight (styrke betyder mest op
//           ad bakke). Lineaer og stigende i evne: en staerkere rytter koerer
//           aldrig langsommere (styrke straffes aldrig, ejer 4/8).
//   krav    Som vejetapens front-rytter i en gruppe paa én: evnen x
//           terraenets baseDemand x frontWorkFactor, moduleret af rytterens
//           eget indsatsvalg (M12). Belastningen (#3459) er dermed maalt paa
//           samme skala som en vejetape.
//
// Ordrer ignoreres: en enkeltstart har intet holdspil at bestille.
//
// REN — ingen IO/Date/Math.random. Eneste stoej er dagsformen (seedet pr.
// rytter) og M10's segment-noeglede strømme, begge fra kernen; determinisme
// (§2 invariant 1) holder per konstruktion.

import type {
  Entrant,
  EngineTuning,
  ProfileType,
  RouteV2,
  Segment,
  SegmentKind,
  StageOutput,
  Weather,
} from "../types.ts";
import { deriveRechargeRate, tickPhysiologyOverSegment, wprimeDepletionCpMultiplier } from "../physiology.ts";
import { gaussian, rngFor } from "../rng.ts";
import { computeFinaleAbilityScore } from "../finale.ts";
import { riderWeatherCpMultiplier } from "../segmentLoop.ts";
import { STRENGTH_SPEED_EXTRA_TUNING } from "../tuning.ts";
import { applyDistanceFatigueToCp } from "./distanceFatigue.ts";
import { applyEffortToDemand } from "./effortCost.ts";
import {
  runTimeTrialStage,
  type TeamRoster,
  type TeamTimeTrialOptions,
  type TimeTrialMode,
  type TimeTrialRider,
  type TimeTrialUnit,
} from "./teamTimeTrial.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── Diskriminatoren ──────────────────────────────────────────────────────────

/**
 * Enkeltstartens etapetyper. `ttt` er IKKE med: holdtidskoerslen har sin egen
 * gren (hold = enhed). Diskriminatoren er profile_type, aldrig finale_type —
 * generatoren mapper alle tre tidskoersler til "solo_tt" (RULES §2h).
 */
export const INDIVIDUAL_TIME_TRIAL_PROFILES: ReadonlySet<ProfileType> = new Set<ProfileType>(["itt", "itt_hilly"]);

export function isIndividualTimeTrial(profileType: ProfileType | null | undefined): boolean {
  return profileType != null && INDIVIDUAL_TIME_TRIAL_PROFILES.has(profileType);
}

// ── Tuning ───────────────────────────────────────────────────────────────────

/**
 * Enkeltstartens eget haandtag. Samme "additiv tuning uden om den frosne
 * EngineTuning-kontrakt"-moenster som tuning.ts's *_EXTRA_TUNING-blokke; ligger
 * i modulet fordi det kun har én aftager.
 *
 * `strengthSpeedGain` er fart-leddets haeldning pr. enhed relativ evne over/
 * under feltets reference, FOER terraen-vaegten. Kalibreret mod ITT-gap-ankret
 * (headToHeadAnchors.js's `ittTop10SpreadPer40KmSeconds`, #2415: "ITT 1-3 min
 * over 40 km") paa den pinnede population og de pinnede proxy-etaper, 5 seeds,
 * felt 180. Maalingen ligger i balance-internals/ (hard rule 17).
 */
export const INDIVIDUAL_TIME_TRIAL_TUNING = Object.freeze({
  strengthSpeedGain: 0.16,
  stageNoiseSd: 0.035,
});

export type IndividualTimeTrialTuning = { strengthSpeedGain: number; stageNoiseSd: number };

// ── Evne og fart ─────────────────────────────────────────────────────────────

/**
 * Tidskoersels-evnen for én rytter paa ét terraen (frisk, uden slid/vejr/dagsform).
 * Stigning: `long_climb`-vektoren. Alt andet: `solo_tt`-vektoren. Begge er
 * finale-tuningens egne vektorer; alle vaegte er >= 0, saa scoren er monotont
 * ikke-faldende i enhver evne (samme garanti som finale.ts).
 */
export function ittAbilityScore(abilities: Entrant["abilities"], kind: SegmentKind, tuning: EngineTuning): number {
  const vectors = tuning.finale.demandVectorByFinaleType;
  const vector = (kind === "climb" ? vectors.long_climb : vectors.solo_tt) ?? {};
  return computeFinaleAbilityScore(abilities, 0, vector, 0);
}

/**
 * Feltets reference pr. terraen: gennemsnittet af de `work.frontFraction`
 * staerkeste friske evner — samme regel som vejetapens `referenceCpByKind`.
 * Regnet ÉN gang pr. etape paa den friske evne, saa slid og vejr stadig kan
 * saenke etapens tempo (samme begrundelse som dér).
 */
export function ittReferenceByKind(startlist: readonly Entrant[], tuning: EngineTuning): Record<SegmentKind, number> {
  const kinds: SegmentKind[] = ["flat", "rolling", "climb", "descent", "cobbles"];
  const out = {} as Record<SegmentKind, number>;
  for (const kind of kinds) {
    const scores = startlist.map((e) => ittAbilityScore(e.abilities, kind, tuning)).sort((a, b) => b - a);
    const frontCount = Math.max(1, Math.ceil(scores.length * tuning.work.frontFraction));
    const slice = scores.slice(0, frontCount);
    out[kind] = slice.length > 0 ? slice.reduce((s, v) => s + v, 0) / slice.length : 0;
  }
  return out;
}

/**
 * Rytterens baeredygtige tidskoersels-evne paa ét segment i dag: frisk evne x
 * M7-slid x M11-vejr x udmattelse, plus dagsform. Samme lag og samme
 * raekkefoelge som vejetapens `riderCpForSegment` (segmentLoop.ts) — kun
 * evne-grundlaget er tidskoerslens eget. Holdrollens `team_cp_factor` findes
 * ikke her: en enkeltstart har intet holdarbejde.
 */
export function ittCapacityForSegment(
  entrant: Entrant,
  rider: Pick<TimeTrialRider, "wprime" | "wprimeMax" | "dayform">,
  segment: Segment,
  tuning: EngineTuning,
  weather: Weather,
  stageNoise = 0,
): number {
  const fresh = ittAbilityScore(entrant.abilities, segment.kind, tuning);
  const worn = applyDistanceFatigueToCp(fresh, {
    kmSoFar: segment.from_km,
    enduranceAbility: entrant.abilities.endurance,
    condition: entrant.condition,
  });
  const weatherFactor = riderWeatherCpMultiplier(entrant, segment, weather);
  const fatigueFactor = wprimeDepletionCpMultiplier(rider.wprime, rider.wprimeMax);
  return Math.max(0, worn * weatherFactor * fatigueFactor + rider.dayform + stageNoise);
}

/**
 * Tidskoerslens dagsudsving pr. rytter (seedet, egen strøm "itt_day"): det
 * v3's enkeltstart allerede baerer som `randomness`-leddet i sin demand-vektor
 * (raceStageProfileGenerator.js's itt/itt_hilly), og som v4's massestart faar
 * gennem finalens placerings-stoej. Uden det er dagsformen den eneste stoej,
 * og feltets bedste enkeltstartsrytter vinder langt oftere end v3-spec'ens
 * favorit-baand. Additivt paa evnen ligesom dagsformen: det skalerer
 * magnitude og kan aldrig vende evnens fortegn i fart-formlen.
 * Uafhaengigt af segment: det er dagens start, ikke et udsving pr. km.
 */
export function ittStageNoise(seed: string, riderId: string, ittTuning: IndividualTimeTrialTuning): number {
  if (!(ittTuning.stageNoiseSd > 0)) return 0;
  return gaussian(rngFor(seed, "itt_day", riderId), 0, ittTuning.stageNoiseSd);
}

/**
 * Rytterens fart alene paa ét segment. Relativ til feltets reference,
 * terraen-vaegtet, clampet af `terrain.speedMultiplierBounds`. Ingen laee-led:
 * en rytter alene faar per definition ingen (segmentLoop's groupDraftSpeedGain
 * giver praecis 0 ved én rytter). Monotont ikke-faldende i `capacity`.
 */
export function ittSpeedKmh(
  capacity: number,
  referenceCapacity: number,
  kind: SegmentKind,
  tuning: EngineTuning,
  ittTuning: IndividualTimeTrialTuning = INDIVIDUAL_TIME_TRIAL_TUNING,
): number {
  const baseSpeed = tuning.terrain.baseSpeedKmh[kind];
  const [lo, hi] = tuning.terrain.speedMultiplierBounds;
  const relative = referenceCapacity > 0 ? capacity / referenceCapacity - 1 : 0;
  const slope = ittTuning.strengthSpeedGain * STRENGTH_SPEED_EXTRA_TUNING.terrainWeight[kind];
  return baseSpeed * clamp(1 + slope * relative, lo, hi);
}

// ── Segment-tikket ───────────────────────────────────────────────────────────

/**
 * Ét segment for én rytter alene. Muterer den lokale tilstand (kernens egen
 * per-kald-kopi, aldrig kalderens input). Returnerer altid [] — en rytter
 * alene har intet hold at blive sat af.
 */
function tickSoloRider(
  rider: TimeTrialRider,
  entrant: Entrant,
  segment: Segment,
  referenceCapacity: number,
  stageNoise: number,
  route: RouteV2,
  tuning: EngineTuning,
  ittTuning: IndividualTimeTrialTuning,
): void {
  const capacity = ittCapacityForSegment(entrant, rider, segment, tuning, route.weather, stageNoise);
  const distanceKm = Math.max(0, segment.to_km - segment.from_km);
  const speedKmh = ittSpeedKmh(capacity, referenceCapacity, segment.kind, tuning, ittTuning);
  const dtSeconds = speedKmh > 0 ? (distanceKm / speedKmh) * 3600 : 0;
  // Kravet: vejetapens front-rytter i en gruppe paa én (tickGroupRiders med
  // collectiveCp = rytterens egen evne), moduleret af rytterens indsatsvalg.
  const baseDemand = capacity * tuning.terrain.baseDemand[segment.kind] * tuning.work.frontWorkFactor[segment.kind];
  const demand = applyEffortToDemand(baseDemand, entrant.effort, undefined, route.profile_type);
  const tick = tickPhysiologyOverSegment({
    cp: capacity,
    wprimeMax: rider.wprimeMax,
    wprime: rider.wprime,
    demand,
    dtSeconds,
    rechargeRate: deriveRechargeRate(entrant.abilities, tuning.physiology),
    segmentLengthKm: distanceKm,
  });
  rider.cp = capacity;
  rider.wprime = tick.wprime;
  rider.seconds_over_cp += tick.secondsOverCp;
  rider.work_norm += tick.workNorm;
  rider.elapsed_seconds += dtSeconds;
}

function individualTimeTrialMode(
  route: RouteV2,
  reference: Record<SegmentKind, number>,
  stageNoiseByRider: ReadonlyMap<string, number>,
  ittTuning: IndividualTimeTrialTuning,
): TimeTrialMode {
  return {
    groupPrefix: "itt",
    // Den win_type v3's raceTimeline.js (TIME_TRIAL_WIN_KEY) og loebsfilmen
    // (stageTimelineFilm.js's WIN_TYPE_KEY) allerede kender, med faerdig copy.
    winType: "itt_win",
    unitEvents: false,
    // 180 kurvepunkter pr. segment ville fylde tidslinjen uden at blive vist:
    // filmen tegner ingen gap-kurve paa en tidskoersel. Tiderne staar i
    // finish-eventets top-10 og i resultatet.
    gapUpdates: false,
    tickUnitSegment: (unit: TimeTrialUnit, segment: Segment, _segmentIndex: number, tuning: EngineTuning): string[] => {
      for (const entrant of unit.roster.riders) {
        const rider = unit.riders[entrant.rider_id];
        if (!rider || rider.status === "abandoned") continue;
        const noise = stageNoiseByRider.get(entrant.rider_id) ?? 0;
        tickSoloRider(rider, entrant, segment, reference[segment.kind], noise, route, tuning, ittTuning);
      }
      return [];
    },
  };
}

// ── Top-niveau ───────────────────────────────────────────────────────────────

export type IndividualTimeTrialOptions = TeamTimeTrialOptions & { ittTuning?: IndividualTimeTrialTuning };

/**
 * Hele enkeltstarten: hver rytter starter fra sit eget nul, koerer alene og
 * faar sin egen tid. StageOutput-formet (uden TTT's `teams`-opsummering).
 */
export function simulateIndividualTimeTrialStage(
  route: RouteV2,
  startlist: readonly Entrant[],
  seed: string,
  tuning: EngineTuning,
  options: IndividualTimeTrialOptions = {},
): StageOutput {
  const ittTuning = options.ittTuning ?? INDIVIDUAL_TIME_TRIAL_TUNING;
  const units: TeamRoster[] = startlist.map((entrant) => ({ team_id: entrant.rider_id, riders: [entrant] }));
  const reference = ittReferenceByKind(startlist, tuning);
  const stageNoiseByRider = new Map(startlist.map((e) => [e.rider_id, ittStageNoise(seed, e.rider_id, ittTuning)]));
  const { teams: _perRiderUnits, ...output } = runTimeTrialStage(
    route,
    units,
    seed,
    tuning,
    { incidentsTuning: options.incidentsTuning, timeLimitTuning: options.timeLimitTuning },
    individualTimeTrialMode(route, reference, stageNoiseByRider, ittTuning),
  );
  return output;
}
