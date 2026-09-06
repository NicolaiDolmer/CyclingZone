// backend/lib/engine/v4/mechanics/bonusSeconds.ts
// Race Engine v4 F3 (#4030, #3855): M9 — passager (bjergtoppe, indlagte
// spurter, maal): spurt-/bjergpoint + bonussekunder.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §4 M9 ("bounded saa bjerg stadig dominerer GC") + §8 beslutning 11 ("fuld
// pakke fra start"). Kontekst: #2413 (bonussekunder) + #2770 (passage-laget).
//
// EJER-BESLUTNING 6/9 (LAAST, RACE_ENGINE_RULES §9): naar v4 koerer etapen er
// DENNE mekanik den eneste kilde til point og bonussekunder. Laget uden for
// motoren (backend/lib/racePassages.js) gates AF pr. motor i broen, saa ingen
// rytter kan faa point to gange. Konsekvensen for dette modul er at det ikke
// laengere kun beregner bonussekunder: det skal producere HELE passage-formen
// (kind/index/name/km/category + results[]) som race_stage_passages og
// race_results allerede forventer, ellers ville flippet koste spillerne den
// groenne og den prikkede troeje.
//
// #2413's scope-laase gaelder uaendret: (a) maal-bonus KUN paa masse-etaper,
// ikke enkeltstart; (b) den samlede GC-effekt er bounded pr. rytter pr. etape;
// (c) selve GC-fradraget sker i `accumulateStageRows`-flowet UDEN FOR
// motor-kernen — modulets ansvar stopper ved at afgoere HVEM der faar hvor
// meget og HVORFOR.
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random. rng
// bruges KUN via injiceret RngForFn (seedet, per-rytter-hash). Alle
// eksporterede funktioner er rene: intet input muteres.
//
// tuning.ts's frosne `EngineTuning.bonusSeconds` (types.ts, F2-placeholder for
// denne mekanik) baerer selve 10/6/4- og 3/2/1-baandene. BONUS_SECONDS_EXTRA_TUNING
// (tuning.ts, additiv M9-sektion) baerer de ekstra haandtag M9 selv har brug
// for (hvilke finale-typer der er masse-etaper, det haarde per-rytter-loft,
// evne-vaegtene og de ejer-laaste point-skalaer) — samme "additiv sektion i
// tuning.ts"-moenster som finale.ts <- FINALE_EXTRA_TUNING.

import type {
  AbilityKey,
  ClimbCategory,
  Entrant,
  EngineState,
  FinaleType,
  PassageResult,
  ProfileType,
  RiderPassageTotals,
  RngForFn,
  SegmentHookContext,
  SegmentHookResult,
  StagePassage,
  StageResult,
  TimelineEvent,
  Waypoint,
} from "../types.ts";
import { gaussian } from "../rng.ts";
import { komPassageEvent, intermediateSprintEvent } from "../timeline.ts";
import { BONUS_SECONDS_EXTRA_TUNING } from "../tuning.ts";
import type { BonusSecondsTuning } from "../types.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
// Runder NEDAD til HELE sekunder — bruges KUN af klemningen mod per-rytter-
// loftet. To grunde, begge haarde:
//   1. `race_results.bonus_seconds` og `race_stage_passages.bonus_seconds` er
//      INTEGER-kolonner (database/2026-07-22-race-passages.sql). En brøkdel
//      ville braekke `(r->>'bonus_seconds')::integer` midt i en afvikling.
//   2. Loftet (#2413) skal holde EFTER afrunding: nearest-rounding kunne skubbe
//      summen over cap.
// Begge bonus-skalaer er i forvejen hele sekunder, saa klemningen er den eneste
// kilde til en brøkdel — og den er lukket her.
function floorSeconds(n: number): number {
  return Math.floor(n);
}
function normAbility(v: number | undefined): number {
  return clamp(Number(v) || 0, 0, 99) / 99;
}

// ── Point-skalaer (ejer-laaste, spejlet fra racePassages.js) ─────────────────

/**
 * Bjergpoint-skalaen for én kategori. En HC-/1.-kategori der SLUTTER paa toppen
 * taeller dobbelt (racePassages.scaleFor's summit_finish-gren) — det er dagens
 * afgoerende stigning, ikke en passage undervejs. Ukendt kategori giver en tom
 * skala, dvs. ingen passage overhovedet (samme adfaerd som v3).
 */
export function komPointScale(
  category: ClimbCategory | string | null | undefined,
  summitFinish = false,
): readonly number[] {
  const base = BONUS_SECONDS_EXTRA_TUNING.komPointsByCategory[String(category ?? "")] ?? [];
  if (
    summitFinish
    && BONUS_SECONDS_EXTRA_TUNING.summitFinishDoubledCategories.includes(String(category ?? ""))
  ) {
    return base.map((p) => p * BONUS_SECONDS_EXTRA_TUNING.summitFinishPointMultiplier);
  }
  return base;
}

/** Maal-pointskalaen (den "groenne" troeje) for etapens profil-type. */
export function finishPointScale(profileType: ProfileType | string | null | undefined): readonly number[] {
  const table = BONUS_SECONDS_EXTRA_TUNING.finishPointsByProfileType;
  return table[String(profileType ?? "")]
    ?? table[BONUS_SECONDS_EXTRA_TUNING.finishPointsFallbackProfileType]
    ?? [];
}

// ── Maal-bonus-berettigelse ─────────────────────────────────────────────────

/**
 * #2413-scope: maal-bonus gaelder KUN masse-etaper, ikke enkeltstart.
 * `finaleType === null` (legacy/uklassificeret rute, jf. types.ts's
 * RouteV2-kommentar) regnes som masse-etape (sikker default — det ville kraeve
 * en positiv ITT-klassifikation at UDELUKKE bonussen, ikke omvendt), men
 * profil-typen gater stadig: v3 gater paa `profile_type` (itt/ttt), og en
 * legacy-raekke uden finale_type ville ellers slippe igennem begge net.
 */
export function isMassFinishFinaleType(
  finaleType: FinaleType | null,
  eligibleFinaleTypes: readonly string[] = BONUS_SECONDS_EXTRA_TUNING.finishBonusEligibleFinaleTypes,
): boolean {
  if (finaleType == null) return true;
  return eligibleFinaleTypes.includes(finaleType);
}

/** Giver etapen overhovedet maal-bonussekunder? Begge gates skal sige ja. */
export function stageAwardsFinishBonus(
  finaleType: FinaleType | null,
  profileType: ProfileType | string | null | undefined,
): boolean {
  if (BONUS_SECONDS_EXTRA_TUNING.bonusExcludedProfileTypes.includes(String(profileType ?? ""))) return false;
  return isMassFinishFinaleType(finaleType);
}

// ── Passage-raekkefolgen ────────────────────────────────────────────────────

/**
 * Hvem passerer linjen foerst?
 *
 * To led, i den raekkefolge:
 *   1. GRUPPEN. En rytter i en gruppe der ligger 3 minutter bagude kan ikke
 *      tage en indlagt spurt fra et udbrud der er forbi for laenge siden. v4
 *      har et rigtigt gruppe-lag (mor-spec §3.2), saa "hvem er foran" er en
 *      MAALT stoerrelse her — v3 maatte gaette det med en syntetisk
 *      udbruds-status og et catch-km (racePassages' `inFront`).
 *   2. EVNEN inden for gruppen, plus seedet stoej.
 *
 * Bevidst RANK-GUARD og ikke monotoni-garanti (samme moenster som
 * climbSelection.ts/finale.ts): stoejen flytter afstande TILFAELDIGT, fordi en
 * passage er en UAFHAENGIG delkonkurrence (point-/bonusjagt), ikke en fysisk
 * gruppe-tidsforskel. Invariant 3 (§3) handler om TID i samme gruppe og roeres
 * ikke af en passage — passager aendrer hverken tid, gruppe eller placering.
 *
 * Udgaaede ryttere (M10's alvorlige styrt) er ude af opgoerelsen: de er ikke
 * paa vejen laengere.
 *
 * DETERMINISME (#4886): rng-stroemmen noegles paa selve VEJPUNKTET
 * (`passage:<kind>:<index>`), ikke paa mekaniknavnet alene. To vejpunkter af
 * samme art paa samme etape ville ellers dele stroem og faa identisk stoej —
 * og et vejpunkt ville skifte stroem hvis rutens segmentinddeling aendrede sig.
 */
export function computePassageOrder(
  state: EngineState,
  entrants: Readonly<Record<string, Entrant>>,
  rngFor: RngForFn,
  args: { stream: string; qualityWeights: Partial<Record<AbilityKey, number>>; noiseSd: number },
): string[] {
  const gapByGroup = new Map(state.groups.map((g) => [g.id, g.gap_seconds]));
  const scored: Array<{ riderId: string; gap: number; score: number }> = [];
  for (const rider of Object.values(state.riders)) {
    if (rider.status === "abandoned") continue;
    const abilities = entrants[rider.rider_id]?.abilities;
    let base = 0;
    if (abilities) {
      for (const key of Object.keys(args.qualityWeights) as AbilityKey[]) {
        base += (args.qualityWeights[key] ?? 0) * normAbility(abilities[key]);
      }
    }
    const noise = gaussian(rngFor(args.stream, rider.rider_id), 0, args.noiseSd);
    scored.push({
      riderId: rider.rider_id,
      gap: gapByGroup.get(rider.group_id) ?? Number.MAX_SAFE_INTEGER,
      score: base + noise,
    });
  }
  return scored
    .sort((a, b) => a.gap - b.gap || b.score - a.score || a.riderId.localeCompare(b.riderId))
    .map((s) => s.riderId);
}

// ── Passage-konstruktion ────────────────────────────────────────────────────

/**
 * Bygger ÉN passage af en faerdig raekkefolge + de to skalaer.
 *
 * `Math.max(pointScale.length, 3)`-loftet er racePassages' eget: bonus-skalaen
 * er kun 3 lang, saa en passage med en kortere pointskala end 3 (fx en
 * 4.-kategori-stigning) stadig kan naa alle tre bonuspladser. Rytterrader uden
 * baade point og bonus udelades — de er ikke en passage-praestation.
 */
export function buildPassage(args: {
  kind: StagePassage["kind"];
  index: number;
  name: string;
  km: number;
  category?: ClimbCategory | null;
  order: readonly string[];
  pointScale: readonly number[];
  bonusScale?: readonly number[];
}): StagePassage | null {
  const { pointScale, bonusScale = [] } = args;
  if (pointScale.length === 0 && bonusScale.length === 0) return null;
  const limit = Math.min(args.order.length, Math.max(pointScale.length, 3));
  const results: PassageResult[] = [];
  for (let i = 0; i < limit; i++) {
    const points = pointScale[i] ?? 0;
    const bonus = bonusScale[i] ?? 0;
    if (!points && !bonus) continue;
    results.push({ rider_id: args.order[i], passage_rank: i + 1, points, bonus_seconds: bonus });
  }
  if (results.length === 0) return null;
  return {
    kind: args.kind,
    index: args.index,
    name: args.name,
    km: round2(args.km),
    category: args.category ?? null,
    results,
  };
}

/**
 * Vejpunkter der afgoeres UNDERVEJS (segment-hooket): indlagte spurter og
 * bjergtoppe der IKKE er maalstregen. En summit-finish-top afgoeres af
 * maalordenen og hoerer derfor til `buildFinishPassages`.
 *
 * Sorteringen (km, derefter kom foer sprint) er racePassages' egen, saa
 * `index`-felterne og raekkefolgen i race_stage_passages er de samme uanset
 * hvilken motor der koerte etapen.
 */
export function inRacePassageWaypoints(waypoints: readonly Waypoint[], fromKm: number, toKm: number): Waypoint[] {
  return waypoints
    .filter((wp) => (wp.kind === "sprint" || (wp.kind === "kom" && !wp.summit_finish)))
    .filter((wp) => wp.km > fromKm && wp.km <= toKm)
    .sort((a, b) => a.km - b.km || (a.kind === "kom" ? -1 : 1));
}

/**
 * M9-segment-hook: kaldes pr. segment (samme (state, ctx) -> {state, events}-
 * kontrakt som de oevrige mekanik-hooks). Uden effekt paa segmenter uden
 * vejpunkter.
 *
 * Rytternes TID, GRUPPE og PLACERING returneres ALTID uroert: en passage er en
 * ren delkonkurrence oven paa loebet. Det er ogsaa derfor hooket ikke kan
 * braekke invariant 2/3/6 — det tilfoejer kun til `state.stage_passages`.
 */
export const passagesHook = (state: EngineState, ctx: SegmentHookContext): SegmentHookResult => {
  // ETAPE-STABIL STREAM, BEVIDST (#4886): passagens stream noegles paa selve
  // VEJPUNKTET (`passage:<kind>:<index>`), og et vejpunkt skal have samme
  // lodtraekning uanset hvilket segment det tilfaeldigvis falder i — ellers
  // skifter en indlagt spurt stroem hver gang rutens segmentinddeling aendres.
  // Derfor `rngForStage` og ikke den segment-noeglede default; vejpunkt-
  // indekset giver allerede den adskillelse pr. kaldested som segment-noeglen
  // ellers leverer.
  const { segment, route, entrants, rngForStage: rngFor, tuning } = ctx;
  const waypoints = inRacePassageWaypoints(route.waypoints, segment.from_km, segment.to_km);
  if (waypoints.length === 0) return { state, events: [] };

  const extra = BONUS_SECONDS_EXTRA_TUNING;
  const passages: StagePassage[] = [];
  for (const wp of waypoints) {
    const isKom = wp.kind === "kom";
    const category = isKom ? (wp.category ?? null) : null;
    const pointScale = isKom ? komPointScale(category, false) : extra.intermediateSprintPoints;
    const qualityWeights = isKom
      ? (extra.komSmallCategories.includes(String(category ?? ""))
        ? extra.komQualityWeightsSmall
        : extra.komQualityWeightsBig)
      : extra.intermediateSprintQualityWeights;
    const order = computePassageOrder(state, entrants, rngFor, {
      stream: `passage:${wp.kind}:${wp.index}`,
      qualityWeights,
      noiseSd: isKom ? extra.komNoiseSd : extra.intermediateSprintNoiseSd,
    });
    const passage = buildPassage({
      kind: wp.kind as StagePassage["kind"],
      index: wp.index,
      name: wp.name,
      km: wp.km,
      category,
      order,
      pointScale,
      // Kun den indlagte spurt giver bonussekunder undervejs — en bjergtop
      // giver point, aldrig sekunder (#2413's scope).
      bonusScale: isKom ? [] : tuning.bonusSeconds.intermediateSeconds,
    });
    if (passage) passages.push(passage);
  }
  if (passages.length === 0) return { state, events: [] };

  return {
    state: { ...state, stage_passages: [...(state.stage_passages ?? []), ...passages] },
    events: [],
  };
};

/**
 * Maalstregens passager: selve maalet (groenne point + 10/6/4) plus enhver
 * bjergtop der ER maalstregen (summit finish). Begge afgoeres af den endelige
 * placeringsraekkefolge, ikke af en evne-lodtrækning — praecis som v3
 * (racePassages: "Maalorden ER motorens rangering").
 *
 * `results` er StageOutput's endelige liste. Ryttere der ikke kom i maal
 * (udgaaet / uden for tidsgraensen) taeller ikke med i maalordenen: de kan
 * hverken tage point eller bonussekunder.
 */
export function buildFinishPassages(args: {
  results: readonly StageResult[];
  waypoints: readonly Waypoint[];
  distanceKm: number;
  profileType: ProfileType | string | null | undefined;
  finaleType: FinaleType | null;
  tuning: Pick<BonusSecondsTuning, "finishSeconds">;
}): StagePassage[] {
  const finishOrder = [...args.results]
    .filter((r) => r.status === "finished")
    .sort((a, b) => a.rank - b.rank)
    .map((r) => r.rider_id);
  if (finishOrder.length === 0) return [];

  const passages: StagePassage[] = [];

  // 1. Summit-finish-bjergtoppe (dobbelt point, maalorden).
  for (const wp of args.waypoints) {
    if (wp.kind !== "kom" || !wp.summit_finish) continue;
    const passage = buildPassage({
      kind: "kom",
      index: wp.index,
      name: wp.name,
      km: wp.km,
      category: wp.category ?? null,
      order: finishOrder,
      pointScale: komPointScale(wp.category ?? null, true),
    });
    if (passage) passages.push(passage);
  }

  // 2. Maalet. Vejpunktet findes normalt paa ruten; mangler det (legacy-rute),
  //    er maalstregen stadig maalstregen — den udledes af distancen.
  const finishWaypoint = args.waypoints.find((wp) => wp.kind === "finish");
  const finishPassage = buildPassage({
    kind: "finish",
    index: finishWaypoint?.index ?? 0,
    name: finishWaypoint?.name ?? "Finish",
    km: finishWaypoint?.km ?? args.distanceKm,
    order: finishOrder,
    pointScale: finishPointScale(args.profileType),
    bonusScale: stageAwardsFinishBonus(args.finaleType, args.profileType) ? args.tuning.finishSeconds : [],
  });
  if (finishPassage) passages.push(finishPassage);

  return passages;
}

// ── Per-rytter-loft (#2413: samlet GC-effekt bounded ~10s/etape) ─────────────

/**
 * Klemmer den SAMLEDE bonus én rytter faar over hele etapen (maal + alle
 * indlagte spurter) ned til `maxTotalPerRider`, proportionalt paa tvaers af
 * alle den rytters bonusrader (bevarer den relative vaegtning mellem
 * maal-/spurt-bonus i stedet for vilkaarligt at nulstille én kilde) — ALDRIG
 * en forhoejelse: rader under loftet er uaendrede. POINT roeres ikke: loftet er
 * en GC-graense (#2413), ikke en pointgraense.
 *
 * Deterministisk, ren funktion af `passages`.
 */
export function clampPassageBonusToPerRiderCap(
  passages: readonly StagePassage[],
  maxTotalPerRider: number = BONUS_SECONDS_EXTRA_TUNING.maxTotalBonusSecondsPerRiderPerStage,
): StagePassage[] {
  const totalByRider = new Map<string, number>();
  for (const p of passages) {
    for (const r of p.results) {
      totalByRider.set(r.rider_id, (totalByRider.get(r.rider_id) ?? 0) + r.bonus_seconds);
    }
  }
  return passages.map((p) => ({
    ...p,
    results: p.results.map((r) => {
      const total = totalByRider.get(r.rider_id) ?? 0;
      if (total <= maxTotalPerRider || total <= 0) return { ...r };
      return { ...r, bonus_seconds: floorSeconds(r.bonus_seconds * (maxTotalPerRider / total)) };
    }),
  }));
}

/**
 * Etapens samlede udbytte pr. rytter — kilden til
 * race_results.sprint_points/kom_points/bonus_seconds. Sorteret paa rider_id,
 * saa to identiske koersler giver identiske raekker helt ud i databasen.
 *
 * En `finish`-passage giver SPURT-point (den groenne troeje), en `kom`-passage
 * bjergpoint. Praecis racePassages' egen `bump`-regel.
 */
export function passageTotals(passages: readonly StagePassage[]): RiderPassageTotals[] {
  const byRider = new Map<string, RiderPassageTotals>();
  const get = (riderId: string): RiderPassageTotals => {
    let row = byRider.get(riderId);
    if (!row) {
      row = { rider_id: riderId, sprint_points: 0, kom_points: 0, bonus_seconds: 0 };
      byRider.set(riderId, row);
    }
    return row;
  };
  for (const p of passages) {
    for (const r of p.results) {
      const row = get(r.rider_id);
      if (p.kind === "kom") row.kom_points += r.points;
      else row.sprint_points += r.points;
      row.bonus_seconds = round2(row.bonus_seconds + r.bonus_seconds);
    }
  }
  return [...byRider.values()].sort((a, b) => a.rider_id.localeCompare(b.rider_id));
}

/**
 * Passager -> tidslinje-events. `finish`-passagen udelades bevidst: motoren
 * udsender sit eget `finish`-event, praecis som v3's tidslinje goer.
 *
 * FOG-GATE (#1791, invariant 5): params baerer hvem og hvor mange point/
 * sekunder — offentlig spilinformation spilleren allerede ser i klassementet —
 * aldrig evne-vaegte, stoej eller sandsynligheder. Formen er 1:1 med v3's
 * (raceTimeline.js's kom_passage/intermediate_sprint), saa loebsfilmen
 * (frontend/src/lib/stageTimelineFilm.js) laeser den uaendret.
 */
export function passagesToTimelineEvents(passages: readonly StagePassage[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const p of passages) {
    if (p.kind === "kom") {
      events.push(komPassageEvent(p.km, {
        name: p.name,
        category: p.category ?? null,
        top: p.results.map((r) => ({ rider_id: r.rider_id, points: r.points })),
      }));
    } else if (p.kind === "sprint") {
      events.push(intermediateSprintEvent(p.km, {
        name: p.name,
        top: p.results.map((r) => ({
          rider_id: r.rider_id,
          points: r.points,
          bonus_seconds: r.bonus_seconds,
        })),
      }));
    }
  }
  return events;
}

/** Passager i stabil (km, art)-orden — samme orden som racePassages bygger dem i. */
export function sortPassages(passages: readonly StagePassage[]): StagePassage[] {
  const kindRank = (kind: StagePassage["kind"]): number => (kind === "kom" ? 0 : kind === "sprint" ? 1 : 2);
  return [...passages].sort((a, b) => a.km - b.km || kindRank(a.kind) - kindRank(b.kind) || a.index - b.index);
}
