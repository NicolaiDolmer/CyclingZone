// backend/lib/engine/v4/segmentLoop.ts
// Race Engine v4 F2 (#4030): event-drevet segment-loop (designdoc §3 modul-
// layout, §4 segment-loop-beskrivelsen). Fase A leverer et FLAT-ONLY-verificeret
// skelet: loopet er GENERISK for alle segment-kinds (kalder climb/descent/finale-
// hooks paa de rigtige segmenter), men M2/M3/M4's REELLE mekanik-logik er Fase
// B-scope — her er hooks tomme default-implementeringer (DEFAULT_MECHANIC_HOOKS)
// der ingenting goer.
//
// REN — ingen import fra oevrigt backend. Alt tilstand er immutable (nyt
// objekt/array pr. skridt) saa determinisme-tests kan sammenligne deep-equal.
//
// Krav-tempo/hastigheds-model (segmentLoop-specifik implementeringsdetalje,
// IKKE en del af SS2's frosne kerne-kontrakt): pr. gruppe pr. segment beregnes
// en "kollektiv CP" fra de staerkeste (tuning.work.frontFraction) ryttere i
// gruppen (§4 punkt 1: "front-tempo afledes af ... stærkeste motorer i
// gruppen"). Kollektiv-CP'en styrer segmentets krydsningstid (tuning.terrain)
// og dermed hvor meget grupper trækker fra hinanden. De samme "front"-ryttere
// betaler tuning.work.frontWorkFactor i fysiologi-tick'et, resten betaler
// tuning.work.draftFactor (§4 punkt 1).
//
// #4030 (natboelge 21/8, fixture-fund): fysiologi-tick'et er SUB-DELT
// (physiology.tickPhysiologyOverSegment) i stedet for ét Euler-skridt over
// hele segmentets dtSeconds — se tuning.ts's PHYSIOLOGY_SUBTICK_TUNING-
// kommentar og physiology.ts's tickPhysiologyOverSegment-docblock for
// begrundelsen (eksponentiel genopladnings-ODE var naer-binaer ved ét stort
// skridt). cp/demand/rechargeRate forbliver konstante for hele segmentet
// (kun sub-tick-skridtstoerrelsen aendres) — segmentets krav-tempo/hastighed
// genberegnes fortsat kun pr. segment, ikke pr. sub-tick.

import type {
  Entrant,
  EngineState,
  EngineTuning,
  MechanicHooks,
  RaceGroup,
  RiderState,
  Segment,
  SegmentHookContext,
  SegmentHookResult,
  SegmentGroupSnapshot,
  SegmentKind,
  StageInput,
  TeamOrder,
  TimelineEvent,
  Weather,
} from "./types.ts";
import { boundRngFor, segmentRngFor } from "./rng.ts";
import {
  deriveCp,
  deriveRechargeRate,
  tickPhysiologyOverSegment,
  wprimeDepletionCpMultiplier,
} from "./physiology.ts";
import { applyGroupTimes, buildGroupSnapshot, initGroups, initRiderStates, mergeGroups } from "./groups.ts";
import { GROUP_DRAFT_EXTRA_TUNING, STRENGTH_SPEED_EXTRA_TUNING, WEATHER_EXTRA_TUNING } from "./tuning.ts";
import { applyDistanceFatigueToCp } from "./mechanics/distanceFatigue.ts";
import { applyEffortToDemand } from "./mechanics/effortCost.ts";
import { weatherCpMultiplier, weatherCpPenalty, weatherTechniqueProxy } from "./mechanics/weather.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pushEvent(list: TimelineEvent[], km: number, type: TimelineEvent["type"], params: Record<string, unknown>): void {
  list.push({ km: round2(km), type, params });
}

// ── Default mekanik-hooks (Fase A no-op) ──────────────────────────────────────
// Identitets-funktion: samme state tilbage, ingen events. Fase B (climbSelection.ts/
// descent.ts/finale.ts) erstatter disse med de rigtige M2/M3/M4-implementeringer,
// bag SAMME (state, ctx) -> { state, events }-kontrakt.
function noopHook(state: EngineState, _ctx: SegmentHookContext): SegmentHookResult {
  return { state, events: [] };
}

export const DEFAULT_MECHANIC_HOOKS: MechanicHooks = {
  climbSelection: noopHook,
  descent: noopHook,
  finale: noopHook,
  breakaway: noopHook,
  incidents: noopHook,
  cobbles: noopHook,
  teamPlay: noopHook,
  passages: noopHook,
};

// ── Kollektiv-CP + hastighed ───────────────────────────────────────────────────

type GroupTempo = {
  collectiveCp: number;
  frontRiderIds: Set<string>;
  cpByRider: Map<string, number>;
  dtSeconds: number;
};

// M7-wiring (#4885, 6/9): distance-slid + dag-til-dag-slid ganges paa base-CP'en
// EFTER deriveCp og FOER dayform laegges til — praecis det punkt
// mechanics/distanceFatigue.ts's egen wiring-note udpeger. `segment.from_km` er
// km tilbagelagt ved segmentets INDGANG og er identisk med loopets `state.km`
// paa dette tidspunkt (cursoren saettes til forrige segments `to_km` naar
// segmentet lukkes), men laeses lokalt fra segmentet saa funktionen forbliver
// ren og state-fri.
//
// Multiplikatoren er svagt STIGENDE i endurance og i condition (se
// distanceFatigue.ts), saa den kan aldrig vende to rytteres indbyrdes CP-orden:
// invariant 3 (styrke straffes aldrig) holder per konstruktion, ikke per
// kalibrering. Ingen rng — sliddet er en deterministisk funktion af
// km/evne/condition.
//
// Eksporteret for testbarhed af netop KOBLINGEN — samme praecedens som
// `groupDraftSpeedGain` nedenfor. En ende-til-ende-test kan ikke skelne "M7 er
// koblet fra" fra "M7 er koblet til og flyttede ingenting"; en direkte test paa
// denne funktion kan (segmentLoop.distanceFatigue.test.ts).
export function riderCpForSegment(
  entrant: Entrant,
  riderState: RiderState,
  segment: Segment,
  tuning: EngineTuning,
  weather: Weather,
): number {
  const baseCp = deriveCp(entrant.abilities, segment.kind, tuning.physiology.cpWeights);
  const worn = applyDistanceFatigueToCp(baseCp, {
    kmSoFar: segment.from_km,
    enduranceAbility: entrant.abilities.endurance,
    condition: entrant.condition,
  });
  // To proportionale CP-faktorer ganges paa den slidte CP FOER dayform laegges
  // til. Begge sidder samme sted som M7's slid, og af samme grund: dayform er
  // et absolut dagsudsving oven paa dagens faktiske troeskel, ikke noget de
  // skal skalere. Begge er PR. RYTTER PROPORTIONALE (aldrig absolutte
  // fradrag), saa invariant 3 holder per konstruktion — hverken holdrollen
  // eller vejret kan vende to rytteres indbyrdes CP-orden.
  //
  // M16-wiring (#4246): holdarbejdets pris/kaptajnens lae. Faktoren er
  // akkumuleret af mechanics/teamPlay.ts i det FORRIGE segment: prisen betales
  // FREMAD, praecis som i virkeligheden, hvor en tur i vinden koster resten af
  // dagen og ikke det stykke man allerede har koert. To ryttere med samme
  // holdrolle beholder deres indbyrdes CP-orden, praecis som i v3, hvor
  // work_cost er den samme score-delta for alle hjaelpere paa profilen.
  //
  // M11-wiring (#3855): vejrets pris. Multiplikatoren er <= 1 og IKKE-FALDENDE
  // i evne, saa vejret hverken kan haeve en CP eller straffe den staerkeste
  // haardest.
  //
  // #4885-wiring (7/9): UDMATTELSEN. Samme plads og samme form som de tre
  // andre — en proportional faktor paa dagens troeskel FOER dagsformen. Den
  // laeser rytterens EGEN reserve-andel (`wprime/wprimeMax`) og har ingen
  // evne-akse, saa to ryttere med samme udtoemning rammes identisk og
  // invariant 3 holder per konstruktion. Se physiology.ts's
  // wprimeDepletionCpMultiplier for hvorfor en toemt reserve SKAL koste
  // troeskel: uden dette led gjorde W' ingen rytter langsommere, kun mindre,
  // og feltet havde derfor ingen hale.
  const teamFactor = Number.isFinite(riderState.team_cp_factor) ? (riderState.team_cp_factor as number) : 1;
  const weatherFactor = riderWeatherCpMultiplier(entrant, segment, weather);
  const fatigueFactor = wprimeDepletionCpMultiplier(riderState.wprime, riderState.wprimeMax);
  return Math.max(0, worn * teamFactor * weatherFactor * fatigueFactor + riderState.dayform);
}

/**
 * Feltets REFERENCE-CP pr. terraen-type: den kollektive CP en gruppe bestaaende
 * af HELE startlisten ville have (samme top-`work.frontFraction`-regel som
 * `computeGroupTempo`), regnet paa den friske `deriveCp` uden slid, vejr eller
 * dagsform.
 *
 * #4885: dette er nulpunktet fart-modellen manglede. `computeSegmentSpeedKmh`
 * maalte foer gruppens CP mod `terrain.baseDemand[kind]` — en ABSOLUT konstant
 * kalibreret for et midt-skala felt — hvilket gjorde hele fart-spaendet til
 * `strengthSpeedGain x (feltets CP-spaend)`, altsaa ~4 % mod den aegte
 * population. Med feltets egen reference er en gruppe der matcher fronten per
 * definition paa basishastigheden, uanset aargangens niveau.
 *
 * Bevidst STAGE-KONSTANT (regnet én gang, paa den friske CP): var referencen
 * regnet paa dagens slidte CP, ville hele feltets slid forsvinde ud af
 * fart-modellen — alle blev lige meget slidte, altsaa lige hurtige — og M7's
 * distance-slid ville ikke laengere kunne saenke etapens tempo.
 *
 * Eksporteret for testbarhed af netop denne definition, samme praecedens som
 * `groupDraftSpeedGain`.
 */
export function referenceCpByKind(
  startlist: readonly Entrant[],
  tuning: EngineTuning,
): Record<SegmentKind, number> {
  const kinds: SegmentKind[] = ["flat", "rolling", "climb", "descent", "cobbles"];
  const out = {} as Record<SegmentKind, number>;
  for (const kind of kinds) {
    const cps = startlist
      .map((e) => deriveCp(e.abilities, kind, tuning.physiology.cpWeights))
      .sort((a, b) => b - a);
    const frontCount = Math.max(1, Math.ceil(cps.length * tuning.work.frontFraction));
    const slice = cps.slice(0, frontCount);
    out[kind] = slice.length > 0 ? slice.reduce((s, v) => s + v, 0) / slice.length : 0;
  }
  return out;
}

/**
 * Styrke-leddet i fart-multiplikatoren (#4885): gruppens kollektive CP maalt
 * RELATIVT til feltets reference-CP paa terraenet, terraen-vaegtet, med en
 * eksponent > 1 paa underskuds-grenen.
 *
 * Eksporteret for property-testbarhed. Tre egenskaber testene laaser:
 *   1. `collectiveCp === referenceCp` giver praecis 0 (basishastighed).
 *   2. Monotont IKKE-FALDENDE i `collectiveCp` — en staerkere gruppe kan aldrig
 *      koere langsommere (§3 invariant 3, "styrke straffes aldrig").
 *   3. Terraen-rangordenen climb > cobbles > rolling > flat > descent, samme
 *      fysiske grund som work.draftFactor's egen ordning.
 *
 * Ren aritmetik: ingen RNG, ingen state.
 */
export function groupStrengthSpeedFactor(
  collectiveCp: number,
  referenceCp: number,
  kind: SegmentKind,
  tuning: EngineTuning,
): number {
  if (!(referenceCp > 0)) return 0;
  const relative = collectiveCp / referenceCp - 1;
  const exponent = STRENGTH_SPEED_EXTRA_TUNING.deficitExponent;
  // Overskud er lineaert og daempet (`surplusWeight`), saa fronten beholder
  // #4604's kalibrering af bjerg-top-10-spredningen; underskud er konvekst, saa
  // de sidste procent under referencen koster mest. Begge grene er stigende i
  // collectiveCp, saa styrke aldrig straffes (§3 invariant 3).
  const shaped =
    relative >= 0
      ? STRENGTH_SPEED_EXTRA_TUNING.surplusWeight * relative
      : -STRENGTH_SPEED_EXTRA_TUNING.deficitWeight * Math.pow(-relative, exponent);
  return tuning.terrain.strengthSpeedGain * STRENGTH_SPEED_EXTRA_TUNING.terrainWeight[kind] * shaped;
}

// M11-wiring (#3855, 6/9): vejrets CP-multiplikator for ÉN rytter paa ÉT
// segment. Ganges paa den slidte CP i `riderCpForSegment` ovenfor — samme
// sted og samme form som M7's distance-slid, jf. weather.ts's belastnings-blok
// (hvorfor CP og ikke kraftkravet er en MAALT konklusion, se dér).
//
// Vejr-teknikken er en PROXY (vaegtet descending+durability) indtil den rigtige
// evne fødes; se weather.ts's weatherTechniqueProxy-docblock. Ingen rng: vejrets
// pris er en deterministisk funktion af (vejr, terraen, evne), saa determinisme-
// invarianten er uberoert og der er intet segment-index-hash-spoergsmaal (#4886).
//
// Eksporteret af samme grund som `riderCpForSegment` og `groupDraftSpeedGain`:
// en ende-til-ende-test kan se AT en regnetape er anderledes, men ikke at netop
// denne kobling er den der goer det.
export function riderWeatherCpMultiplier(entrant: Entrant, segment: Segment, weather: Weather): number {
  const technique = weatherTechniqueProxy(entrant.abilities, WEATHER_EXTRA_TUNING.weatherTechniqueProxyWeights);
  return weatherCpMultiplier(weather, segment.kind, technique, WEATHER_EXTRA_TUNING);
}

/**
 * Gruppe-lae-fart-gevinst (M1, #4604): den relative fart en gruppe paa
 * `riderCount` holder UD OVER en solo-rytter med samme kollektive CP.
 *
 * Eksporteret for property-testbarhed. Tre egenskaber testene laaser:
 *   1. `riderCount <= 1` giver praecis 0 — en solo-rytter faar aldrig laegevinst.
 *   2. Monotont ikke-faldende i `riderCount` (log-kurve, clampet til [0, 1]).
 *   3. Terraen-vaegten er `1 - draftFactor[kind]`, saa gevinsten er stoerst paa
 *      flad vej og mindst op ad bakke — samme rangorden som hjul-rabatten selv.
 *
 * Ren aritmetik: ingen RNG, ingen state. Paavirker KUN gruppe-tider (mellem
 * grupper), aldrig raekkefolgen inden for en gruppe — monotoni-invarianten
 * (SS2 §2 invariant 3) er derfor uberoert per konstruktion.
 */
export function groupDraftSpeedGain(riderCount: number, kind: SegmentKind, tuning: EngineTuning): number {
  if (!Number.isFinite(riderCount) || riderCount <= 1) return 0;
  const { maxSpeedGain, referenceSize } = GROUP_DRAFT_EXTRA_TUNING;
  const sizeFactor = clamp(Math.log(riderCount) / Math.log(referenceSize), 0, 1);
  const terrainShare = clamp(1 - tuning.work.draftFactor[kind], 0, 1);
  return maxSpeedGain * terrainShare * sizeFactor;
}

function computeSegmentSpeedKmh(
  collectiveCp: number,
  kind: SegmentKind,
  tuning: EngineTuning,
  riderCount: number,
  referenceCp: number,
): number {
  const baseSpeed = tuning.terrain.baseSpeedKmh[kind];
  const [lo, hi] = tuning.terrain.speedMultiplierBounds;
  // #4885: styrke-leddet er RELATIVT til feltets reference-CP, ikke en absolut
  // difference mod `terrain.baseDemand[kind]`. `baseDemand` beholder sin rolle
  // paa KRAV-siden (tickGroupRiders), hvor #4604 gjorde den relativ — den var
  // aldrig et fart-nulpunkt, den blev brugt som ét.
  const multiplier = clamp(1 + groupStrengthSpeedFactor(collectiveCp, referenceCp, kind, tuning), lo, hi);
  return baseSpeed * multiplier * (1 + groupDraftSpeedGain(riderCount, kind, tuning));
}

function computeGroupTempo(
  group: RaceGroup,
  riders: Record<string, RiderState>,
  entrantsById: Record<string, Entrant>,
  segment: Segment,
  tuning: EngineTuning,
  weather: Weather,
  referenceCp: number,
): GroupTempo {
  const cpByRider = new Map<string, number>();
  for (const riderId of group.rider_ids) {
    const entrant = entrantsById[riderId];
    const riderState = riders[riderId];
    if (!entrant || !riderState) continue;
    cpByRider.set(riderId, riderCpForSegment(entrant, riderState, segment, tuning, weather));
  }
  const ranked = [...cpByRider.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const frontCount = Math.max(1, Math.ceil(ranked.length * tuning.work.frontFraction));
  const frontSlice = ranked.slice(0, frontCount);
  const frontRiderIds = new Set(frontSlice.map(([id]) => id));
  const collectiveCp = frontSlice.length > 0 ? frontSlice.reduce((s, [, cp]) => s + cp, 0) / frontSlice.length : 0;
  const speedKmh = computeSegmentSpeedKmh(collectiveCp, segment.kind, tuning, ranked.length, referenceCp);
  const distanceSegmentKm = Math.max(0, segment.to_km - segment.from_km);
  const dtSeconds = speedKmh > 0 ? (distanceSegmentKm / speedKmh) * 3600 : 0;
  return { collectiveCp, frontRiderIds, cpByRider, dtSeconds };
}

function tickGroupRiders(
  group: RaceGroup,
  riders: Record<string, RiderState>,
  entrantsById: Record<string, Entrant>,
  segment: Segment,
  tempo: GroupTempo,
  tuning: EngineTuning,
): Record<string, RiderState> {
  const next: Record<string, RiderState> = {};
  // #4604 (bjerg-anker): kravet er RELATIVT til gruppens kollektive CP — den
  // samme stoerrelse §4 punkt 1 allerede afleder front-tempoet af.
  //
  // FOER var `terrain.baseDemand[kind]` en ABSOLUT 0-1-vaerdi maalt mod en
  // evne-VAEGTET CP. Konstanterne blev valgt ud fra en antaget middel-evne
  // omkring midt-skala; den aegte S3-populations median-CP paa climb er 0,097
  // mod et krav paa 0,720. Maalt 2/9 over 5.938 ryttere: 100 % af feltet laa
  // over CP paa climb, 92 % paa flat, 89 % paa descent — altsaa ogsaa nedad.
  // Det er ikke en balance-praeference, det er en skala-fejl: uanset hvor
  // staerkt eller svagt et felt er, kan det ikke ligge over sit EGET tempo.
  // #4606's tidskonstant gjorde taeringen langsom nok til at vaere maalbar;
  // uden dette led taerer den stadig for ALLE, hele tiden.
  //
  // `baseDemand[kind]` beholder sin kalibrering, men laeses nu som "andel af
  // gruppens baeredygtige tempo dette terraen kraever". Terraenets indbyrdes
  // ordning (climb 0,8 > cobbles 0,65 > flat 0,55 > descent 0,3) er uaendret,
  // og fortolkningen er population-uafhaengig: en staerkere eller svagere
  // aargang giver samme selektions-dynamik i stedet for et kollaps.
  const groupDemand = tempo.collectiveCp * tuning.terrain.baseDemand[segment.kind];
  const segmentLengthKm = Math.max(0, segment.to_km - segment.from_km);
  for (const riderId of group.rider_ids) {
    const entrant = entrantsById[riderId];
    const riderState = riders[riderId];
    if (!entrant || !riderState) continue;
    const cp = tempo.cpByRider.get(riderId) ?? 0;
    const positionFactor = tempo.frontRiderIds.has(riderId)
      ? tuning.work.frontWorkFactor[segment.kind]
      : tuning.work.draftFactor[segment.kind];
    // M12-wiring (#4632, ejer-beslutning 6/9, model C): rytterens EGET
    // indsatsvalg ganges paa KRAFTKRAVET — ikke paa CP'en, hvor M7's
    // distance-slid, M16's team_cp_factor og M11's vejr sidder. Skellet er
    // ikke kosmetisk: CP er hvad rytteren KAN baere i dag (evne, slid, vejr),
    // kravet er hvad han VAELGER at lave. `all_out` haever kravet over
    // gruppens tempo og braender dermed W' hurtigere (stoerre kollaps-risiko
    // sent paa etapen, hvor climbSelection/finale laeser reserven);
    // `grupetto` saenker det markant, saa rytteren overlever dagen i stedet
    // for at koere om noget. Havde valget i stedet ganget paa CP, ville
    // `save`/`grupetto` GRATIS have haevet dagens baeredygtige troeskel —
    // altsaa gjort rytteren staerkere af at spare — og `all_out` have gjort
    // ham svagere; begge dele er den modsatte fysiologi.
    //
    // Invariant 3 (styrke straffes aldrig) holder per konstruktion:
    // multiplikatoren er en ren funktion af rytterens EGET effort-trin, ikke
    // af hans evner, saa to ryttere paa SAMME trin beholder deres indbyrdes
    // orden praecis som foer wiringen. Determinismen er uberoert — intet rng.
    const demand = applyEffortToDemand(groupDemand * positionFactor, entrant.effort);
    const rechargeRate = deriveRechargeRate(entrant.abilities, tuning.physiology);
    // #4030 fixture-fund: sub-tick i stedet for ét Euler-skridt over hele
    // segmentet (tuning.ts's PHYSIOLOGY_SUBTICK_TUNING, physiology.ts's
    // tickPhysiologyOverSegment-kommentar) — genopladning bliver gradvis
    // i stedet for naer-binaer; taering er vaerdimaessigt uaendret.
    const tick = tickPhysiologyOverSegment({
      cp,
      wprimeMax: riderState.wprimeMax,
      wprime: riderState.wprime,
      demand,
      dtSeconds: tempo.dtSeconds,
      rechargeRate,
      segmentLengthKm,
    });
    next[riderId] = {
      ...riderState,
      cp,
      wprime: tick.wprime,
      seconds_over_cp: riderState.seconds_over_cp + tick.secondsOverCp,
      work_norm: riderState.work_norm + tick.workNorm,
    };
  }
  return next;
}

/** Rebaseliner grupper saa den mindste gap_seconds altid er praecis 0 (fronten). */
function rebaselineGroups(groups: RaceGroup[]): RaceGroup[] {
  if (groups.length === 0) return groups;
  const minGap = groups.reduce((m, g) => Math.min(m, g.gap_seconds), groups[0].gap_seconds);
  if (minGap === 0) return groups;
  return groups.map((g) => ({ ...g, gap_seconds: Math.max(0, g.gap_seconds - minGap) }));
}

export type SegmentLoopResult = {
  state: EngineState;
  timeline: TimelineEvent[];
  groupSnapshots: SegmentGroupSnapshot[];
};

/**
 * Koerer hele segment-listen for én etape og returnerer sluttilstand + tidslinje
 * + gruppe-snapshots. `simulateStageV4` (index.ts) bygger StageOutput oven paa
 * dette (results/loads afledes af sluttilstanden, finish-eventet tilfoejes der).
 */
export function runSegmentLoop(input: StageInput, hooks: MechanicHooks = DEFAULT_MECHANIC_HOOKS): SegmentLoopResult {
  const { route, startlist, seed, tuning } = input;
  // T4 (tactics-orders-specen): kernen kraever ALDRIG ordrer — en manglende
  // eller tom liste er den neutrale default.
  const orders: readonly TeamOrder[] = input.orders ?? [];
  const entrantsById: Record<string, Entrant> = {};
  for (const entrant of startlist) entrantsById[entrant.rider_id] = entrant;

  const rngForFn = boundRngFor(seed);
  // #4885: feltets reference-CP pr. terraen — fart-modellens nulpunkt. Regnet
  // ÉN gang pr. etape af hele startlisten (se referenceCpByKind).
  const referenceCp = referenceCpByKind(startlist, tuning);
  const virtualGc: Record<string, number> = {};
  for (const entrant of startlist) virtualGc[entrant.rider_id] = 0;

  let state: EngineState = {
    km: 0,
    groups: initGroups(startlist),
    riders: initRiderStates(startlist, tuning, seed),
    virtual_gc: virtualGc,
  };

  const timeline: TimelineEvent[] = [];
  const groupSnapshots: SegmentGroupSnapshot[] = [];
  const lastEmittedGap = new Map<string, number>();
  let frontElapsedSeconds = 0;

  pushEvent(timeline, 0, "stage_start", {
    field_count: startlist.length,
    profile_type: route.profile_type,
    distance_km: route.distance_km,
  });

  // M11 (#3855-wiring 6/9): vejr-eventet emitteres ÉN gang, paa det foerste
  // segment hvor vejret faktisk koster noget. For regn er det km 0 (regn
  // rammer hele etapen); for vind er det det foerste EKSPONEREDE segment, saa
  // en bjergetape i vind foerst melder vinden naar feltet kommer ud paa det
  // aabne — "vind fra km 80", ikke "vind fra km 0". Sol/overskyet melder
  // ingenting: der er intet at fortaelle spilleren, og etapen skal vaere
  // byte-identisk med en etape uden vejr-lag.
  //
  // Fog-gate (§3 invariant 5, ejer 6/9): params baerer KUN vejrtypen. Ingen
  // wind_exposure, ingen multiplikator, ingen straf — spilleren ser "regn",
  // ikke hvad regn koster.
  let weatherAnnounced = false;

  const segments = route.segments;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];

    if (!weatherAnnounced && weatherCpPenalty(route.weather, segment.kind, WEATHER_EXTRA_TUNING) > 0) {
      pushEvent(timeline, segment.from_km, "weather", { kind: route.weather.kind });
      weatherAnnounced = true;
    }

    // 1+2: krav-tempo + fysiologi-tick, pr. gruppe (baseret paa gruppe-strukturen
    // ved segmentets indgang).
    const tempoByGroup = new Map<string, GroupTempo>();
    let nextRiders: Record<string, RiderState> = { ...state.riders };
    for (const group of state.groups) {
      const tempo = computeGroupTempo(
        group,
        state.riders,
        entrantsById,
        segment,
        tuning,
        route.weather,
        referenceCp[segment.kind],
      );
      tempoByGroup.set(group.id, tempo);
      const patch = tickGroupRiders(group, state.riders, entrantsById, segment, tempo, tuning);
      nextRiders = { ...nextRiders, ...patch };
    }
    state = { ...state, riders: nextRiders };

    // 4a. Gap-bogfoering: fronten (mindste gap_seconds) er referencen; andre
    // gruppers gap opdateres med (dtGruppe - dtFront), floor 0.
    const frontGroup = state.groups.reduce((min, g) => (g.gap_seconds < min.gap_seconds ? g : min), state.groups[0]);
    const dtFront = tempoByGroup.get(frontGroup.id)?.dtSeconds ?? 0;
    let groups = state.groups.map((g) => {
      if (g.id === frontGroup.id) return g;
      const dtGroup = tempoByGroup.get(g.id)?.dtSeconds ?? dtFront;
      return { ...g, gap_seconds: Math.max(0, g.gap_seconds + (dtGroup - dtFront)) };
    });
    groups = rebaselineGroups(groups);
    state = { ...state, groups };

    // 3. Mekanik-hooks (M2 paa climb, M3 paa descent, M4 paa sidste segment).
    // Fase A: DEFAULT_MECHANIC_HOOKS er no-op, saa state/timeline er uaendret.
    const ctx: SegmentHookContext = {
      segment,
      segmentIndex,
      route,
      entrants: entrantsById,
      tuning,
      // #4886: hooksene får ALTID en segment-nøglet stream. Uden indpakningen
      // er en stream nøglet på (seed, mekanik, rider_id) alene, og enhver
      // mekanik der kaldes pr. segment genbruger sin første lodtrækning på
      // hvert segment. Se rng.ts's segmentRngFor for hele kontrakten.
      rngFor: segmentRngFor(rngForFn, segmentIndex),
      rngForStage: rngForFn,
      orders,
    };
    // M16 (#4246): holdspillet koeres FOERST blandt hooksene — umiddelbart
    // efter fysiologi-tick'et og gap-bogfoeringen, og FOER terraen-selektionen.
    // Raekkefoelgen er hele pointen: hjaelperen betaler for det arbejde der
    // lige er tikket, og klatre-/brostens-selektionen laeser derefter den
    // reserve holdarbejdet efterlod — praecis som i v3, hvor work-cost og
    // kaptajn-beskyttelse hoerer til SAMME etapes opgoer. Ikke kind-gated:
    // holdarbejde er ambient (som M10's uheld), en hjaelper traekker paa flad
    // vej saavel som op ad bakke.
    //
    // Hooket er VALGFRIT (types.ts): et hook-saet uden `teamPlay` koerer
    // etapen helt uden holdspil — den gamle F2-adfaerd, uaendret. Det samme
    // gaelder enhver startliste uden `team_id` (mechanics/teamPlay.ts's
    // hoved): mekanikken er da en eksakt no-op.
    {
      const result = (hooks.teamPlay ?? noopHook)(state, ctx);
      state = result.state;
      timeline.push(...result.events);
    }

    if (segment.kind === "climb") {
      const result = hooks.climbSelection(state, ctx);
      state = result.state;
      timeline.push(...result.events);
    } else if (segment.kind === "descent") {
      const result = hooks.descent(state, ctx);
      state = result.state;
      timeline.push(...result.events);
    } else if (segment.kind === "cobbles") {
      // M8 (#3855-wiring): brosten-/grus-sektor. Samme plads i loopet som M2/M3
      // — dagens terraen-selektion sker FOER udbruds-hooket og finalen, saa et
      // brostens-split er med i det billede M5/M4 arbejder videre paa. Grus-
      // sektorer ER cobbles-segmenter (RACE_ENGINE_RULES §2b), saa denne gren
      // daekker begge underlag.
      const result = (hooks.cobbles ?? noopHook)(state, ctx);
      state = result.state;
      timeline.push(...result.events);
    }

    // M5 (#4615): udbrud v2 koeres paa HVERT segment — formation paa det
    // foerste, jagt-fremdrift paa de oevrige. Placeret EFTER climb/descent (saa
    // selektionen paa dagens terraen allerede har fundet sted) og FOER finale-
    // hooket (saa M4 ser det korrekte frontgruppe-billede naar en overlevet
    // udbryder skal placeres) — praecis den raekkefolge breakaway.ts's egen
    // wiring-note foreskriver.
    {
      const result = hooks.breakaway(state, ctx);
      state = result.state;
      timeline.push(...result.events);
    }

    // M10 (#2944): incidents-trappen koeres paa HVERT segment — et uheld er
    // ambient og hoerer ikke til én terraen-type. Placeringen er bevidst:
    //   EFTER M2/M3/M5, saa dagens selektion og udbruddet allerede har formet
    //   grupperne (et uheld rammer den gruppe rytteren FAKTISK er i), og
    //   FOER M4/finale-hooket, saa et styrt paa sidste segment tager rytteren
    //   ud af frontgruppen INDEN spurten gøres op — praecis som i virkeligheden.
    //   FOER merge-trinnet, saa en uheldsramt der kun tabte faa sekunder kan
    //   smelte tilbage i sin gruppe samme segment.
    // Hooket er VALGFRIT (types.ts): et hook-saet uden `incidents` koerer
    // etapen helt uden uheld — det er den gamle F2-adfaerd, uaendret.
    if (hooks.incidents) {
      const result = hooks.incidents(state, ctx);
      state = result.state;
      timeline.push(...result.events);
    }

    // M9 (#2770/#2413): passager (bjergtoppe + indlagte spurter). Kaldes paa
    // HVERT segment — et vejpunkt kan ligge paa et hvilket som helst terraen.
    // Placeringen er bevidst SIDST i segmentets mekanik-raekke, lige foer
    // finalen: passagen skal opgoeres paa det gruppe-billede dagens selektion,
    // udbruddet og uheldene rent faktisk har efterladt ved linjen. Hooket
    // roerer aldrig state.riders/state.groups — det tilfoejer kun passager, saa
    // det kan hverken flytte en tid eller en placering.
    {
      const result = (hooks.passages ?? noopHook)(state, ctx);
      state = result.state;
      timeline.push(...result.events);
    }

    const isLastSegment = segmentIndex === segments.length - 1;
    if (isLastSegment) {
      // M3-angreb paa selve finale-segmentet giver angrebsgruppen negativt gap
      // (den rykker FORAN kildegruppens 0). Finale-opgoerets frontPool-filter
      // (gap_seconds === 0) kraever rebaseline FOER kaldet — ellers falder
      // angriberne ud af opgoerelsen (fundet af golden fixture 4, 21/8).
      state = { ...state, groups: rebaselineGroups(state.groups) };
      const result = hooks.finale(state, ctx);
      state = result.state;
      timeline.push(...result.events);
    }
    state = { ...state, groups: rebaselineGroups(state.groups) };

    // 4b. Sammensmelt grupper der er kommet inden for merge-taerskel.
    const mergedGroups = mergeGroups(state.groups, tuning.groups.mergeThresholdSeconds);
    state = { ...state, groups: mergedGroups, km: segment.to_km };
    frontElapsedSeconds += dtFront;

    for (const g of mergedGroups) {
      if (g.gap_seconds === 0) continue;
      const last = lastEmittedGap.get(g.id);
      if (last === undefined || Math.abs(g.gap_seconds - last) >= tuning.groups.gapUpdateThresholdSeconds) {
        pushEvent(timeline, segment.to_km, "gap_update", { group_id: g.id, gap_seconds: round2(g.gap_seconds) });
        lastEmittedGap.set(g.id, g.gap_seconds);
      }
    }

    // 5. Snapshot pr. segment (beslutning 20).
    groupSnapshots.push(buildGroupSnapshot(segment.to_km, mergedGroups));
  }

  // Tid-tildeling: rent gruppe-princip (mor-spec SS3.2).
  state = { ...state, riders: applyGroupTimes(state.groups, state.riders, frontElapsedSeconds) };

  return { state, timeline, groupSnapshots };
}
