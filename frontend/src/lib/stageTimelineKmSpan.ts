// #6350: løbsfilmens km skal være sande. Motoren (engine/v4) stempler en del
// hændelser ved TJEKPUNKTETS km (segment.to_km), ikke der hvor de skete: en
// rytter der "samler sig med en gruppe" ved km 121,8 kan have lukket hullet
// hvor som helst efter forrige kendte punkt. For allerede kørte etaper findes
// det præcise sted ikke, så filmen viser det ærlige spænd "km A-B":
//   A = seneste kendte punkt før hændelsen (forrige tjekpunkt, eller en senere
//       passage som en mellemspurt/top), B = tjekpunktet.
// Linjen sorteres og afspilles ved spændets start, så den står før toppassagen
// den skete op til. Nye etaper der bærer et præcist kontakt-km (`exact_km`,
// på eventet eller i params) vises præcist og aldrig som spænd.
//
// #7965: motoren stempler "alt ud"/angreb på en stigning (all_out_gain,
// all_out_cracked) ved stigningens SLUT. Ved en topankomst er det målstregen,
// så linjen stod på stregen, selv om angrebet skete op ad stigningen. Filmen
// viser hver af dem som TO linjer på hvert sit punkt (aldrig som interval, ejer
// 12/11), i kronologisk rækkefølge og kun med det motoren faktisk har stemplet:
//   1. Angrebet (`climb_phase: "attack"`) ved stigningens fod, UDEN resultat og
//      uden klokkeslæt (filmen kender ingen tid for foden). Kendes foden ikke,
//      bruges forrige kendte punkt.
//   2. Udfaldet (`climb_phase: "outcome"`): knækket (all_out_cracked) dér hvor
//      motoren stemplede det (`exact_km` + `exact_time` -> `race_time_s`), ellers
//      ved toppen uden tid; angrebet der holdt (all_out_gain) ved toppen.
// Begge bærer `recorded_km` = motorens stempel (toppen), så opgave-opslaget og
// "Angrib"-teksten er ens for de to linjer. Den fulde forspring-undervejs-løsning
// kræver nye stemplinger i motoren (#8045). Kun visning, rå events urørte.
//
// #6294: samme indgang fjerner de "indhentninger" som var en samling af
// udbruddet (withoutRegroupCatches), så film, mærker og gemte flag fortæller
// det samme. Kun visning: den gemte tidslinje er uændret. Ren afledning.

import { withoutRegroupCatches } from "../../../backend/lib/raceParticipationHistory.ts";
import type { ParticipationEvent } from "../../../backend/lib/raceParticipationHistory.ts";

export type KmSpan = { from: number; to: number };
export type SpanTimelineEvent = {
  type?: string;
  km?: number;
  params?: Record<string, unknown> | null;
  /** Præcist kontakt-km fra en motor der kender det (valgfrit felt, nye etaper). */
  exact_km?: number;
  /** Tjekpunktets km som motoren skrev, når `km` er flyttet til spændets start. */
  recorded_km?: number;
  km_span?: KmSpan;
  /** #7965: "attack" = stigningens fod (uden resultat), "outcome" = knæk/holdt (derfra hvor motoren stemplede det). */
  climb_phase?: "attack" | "outcome";
  /** #7965: stigningens navn, når profilen eller tidslinjens topmarkering har det (kun på angrebs-linjen). */
  climb_name?: string;
  /** #7965: ægte løbstid (sekunder) fra motorens `exact_time`, kun på en udfalds-linje der har et ægte km. */
  race_time_s?: number;
};

// Hændelser motoren stempler ved segmentets slut-km. Passager (top, spurt),
// uheld og formationen har deres egen km og står præcist.
const CHECKPOINT_STAMPED = new Set(["group_merged", "breakaway_caught", "peloton_splits", "breakaway_dropped"]);
const PASSAGES = new Set(["kom_passage", "intermediate_sprint"]);

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Præcist kontakt-km, når motoren har skrevet et (nye etaper); ellers null. */
export function exactEventKm(event: SpanTimelineEvent | null | undefined): number | null {
  return finite(event?.exact_km) ?? finite(event?.params?.exact_km);
}

function isCheckpointStamped(event: SpanTimelineEvent): boolean {
  if (CHECKPOINT_STAMPED.has(event.type ?? "")) return true;
  // Et nedkørsels-angreb måles over hele segmentet og stemples ved dets slut.
  return event.type === "finale_attack" && event.params?.direction === "descent" && Array.isArray(event.params?.rider_ids);
}

function finishKmOf(events: readonly SpanTimelineEvent[]): number | null {
  const finish = events.find((event) => event.type === "finish");
  const fromFinish = finite(finish?.km);
  if (fromFinish != null) return fromFinish;
  return finite(events.find((event) => event.type === "stage_start")?.params?.distance_km);
}

/** Stigning fra etapeprofilen (kun de felter foden udledes af). */
export type SpanClimb = { crest_km?: number | string | null; length_km?: number | string | null; name?: string | null };

type TimelineOptions = {
  timelineVersion?: number | null;
  /** #6400: etapens startliste (rider_id), som broen bruger. */
  startlist?: readonly string[] | null;
  /** #7965: etapeprofilens stigninger (foden = crest_km - length_km). Ukendt (null/udeladt): forrige kendte punkt bruges. */
  climbs?: readonly SpanClimb[] | null;
};

// Hændelser motoren stempler når en stigning er slut (opsummering over hele stigningen).
const CLIMB_STAMPED = new Set(["all_out_gain", "all_out_cracked"]);
// En top inden for denne afstand af hændelsens km er stigningen hændelsen hører til.
const CREST_TOLERANCE_KM = 1;

/** Stabil km-sortering af de hændelser der har en type (samme km: input-rækkefølgen). */
export function kmSortedEvents<T extends SpanTimelineEvent>(events: readonly (T | null | undefined)[] | null | undefined): T[] {
  return (events ?? [])
    .filter((event): event is T => !!event && typeof event.type === "string")
    .map((event, i) => ({ event, i }))
    .sort((a, b) => (finite(a.event.km) ?? 0) - (finite(b.event.km) ?? 0) || a.i - b.i)
    .map(({ event }) => event);
}

/** Tidslinjen uden samlinger forklædt som indhentninger, km-sorteret (#6294). */
function keptEvents<T extends SpanTimelineEvent>(events: readonly (T | null | undefined)[] | null | undefined, startlist: readonly string[] | null = null): T[] {
  // Projektionen er rækkefølge-følsom: den læser den rå, km-sorterede tidslinje.
  return withoutRegroupCatches(kmSortedEvents(events) as unknown as ParticipationEvent[], startlist ?? []) as unknown as T[];
}

/**
 * Den km filmen viser for én hændelse fra `kept`-tidslinjen: `exact_km` når
 * motoren har skrevet et (aldrig spænd), ellers det ærlige spænd for en
 * tjekpunkt-stemplet hændelse på en v4-tidslinje, ellers eventets egen km.
 */
function spanResolver(kept: readonly SpanTimelineEvent[], { timelineVersion = null, climbs = null }: TimelineOptions) {
  // Kun v4-tidslinjer (timeline_version >= 2) stempler ved tjekpunkter; v3's
  // tidslinje (version 1) har sine egne km og får aldrig spænd.
  const checkpointEngine = typeof timelineVersion === "number" && timelineVersion >= 2;
  const finishKm = finishKmOf(kept);
  // Kendte punkter: start, alle tjekpunkter motoren har skrevet (gap_update og
  // tjekpunkt-stemplede hændelser) og passager med egen km.
  const anchors = new Set<number>([0]);
  for (const event of kept) {
    const km = finite(event.km);
    if (km == null) continue;
    if (event.type === "gap_update" || PASSAGES.has(event.type ?? "") || isCheckpointStamped(event)) anchors.add(km);
  }
  const sortedAnchors = [...anchors].sort((a, b) => a - b);
  const previousAnchor = (km: number): number => {
    let best = 0;
    for (const anchor of sortedAnchors) { if (anchor < km) best = anchor; else break; }
    return best;
  };
  // #7965: foden af stigningen hvis top ligger ved km; null hvis profilen ikke har den.
  const climbAt = (km: number): { foot: number; name: string | null } | null => {
    let best: { crest: number; foot: number; name: string | null } | null = null;
    for (const climb of climbs ?? []) {
      const crest = finite(climb?.crest_km);
      const length = finite(climb?.length_km);
      if (crest == null || length == null || !(length > 0) || Math.abs(crest - km) > CREST_TOLERANCE_KM) continue;
      if (!best || Math.abs(crest - km) < Math.abs(best.crest - km)) {
        const name = typeof climb?.name === "string" && climb.name.trim() ? climb.name.trim() : null;
        best = { crest, foot: Math.max(0, crest - length), name };
      }
    }
    return best && best.foot < km ? { foot: best.foot, name: best.name } : null;
  };
  // Stigningens navn fra tidslinjens egen topmarkering, når profilen ikke har et.
  const komNameNear = (km: number): string | null => {
    let best: { d: number; name: string } | null = null;
    for (const event of kept) {
      if (event.type !== "kom_passage") continue;
      const at = finite(event.km);
      const name = event.params?.name;
      if (at == null || typeof name !== "string" || !name.trim() || Math.abs(at - km) > CREST_TOLERANCE_KM) continue;
      if (!best || Math.abs(at - km) < best.d) best = { d: Math.abs(at - km), name: name.trim() };
    }
    return best?.name ?? null;
  };
  /** Uden motorens ægte kontaktdata (exact_km/exact_time): kopi af params til angrebs-linjen. */
  const withoutExact = <T extends SpanTimelineEvent>(event: T): T => {
    const { exact_km: _omit, ...rest } = event as T & { exact_km?: number };
    const params = event.params ? Object.fromEntries(Object.entries(event.params).filter(([key]) => key !== "exact_km" && key !== "exact_time")) : event.params;
    return { ...rest, params } as T;
  };
  /**
   * #7965: stigningens opsummering stemplet på målstregen (topankomst) bliver to linjer:
   * angrebet ved foden og udfaldet dér hvor motoren stemplede det. null = ikke en topankomst.
   */
  const climbParts = <T extends SpanTimelineEvent>(event: T): Array<{ event: T; spanned: boolean }> | null => {
    if (!checkpointEngine || !CLIMB_STAMPED.has(event.type ?? "") || finishKm == null) return null;
    const top = finite(event.km);
    if (top == null || top < finishKm) return null;
    // Kender profilen stigninger, kræves en der slutter her (ellers er det ikke en topankomst).
    const known = climbs ? climbAt(top) : null;
    const foot = climbs ? known?.foot ?? null : previousAnchor(top);
    if (foot == null || !(foot < top)) return null;
    const exactKm = exactEventKm(event);
    const trueSpot = exactKm != null && exactKm > foot && exactKm <= top;
    const exactTime = finite(event.params?.exact_time);
    const name = known?.name ?? komNameNear(top);
    const attack = { ...withoutExact(event), km: foot, recorded_km: top, climb_phase: "attack" as const, ...(name ? { climb_name: name } : {}) };
    // Ét punkt hver, aldrig km_span. Et opfundet klokkeslæt vises aldrig: tid kun med et ægte km.
    const outcome = { ...event, km: trueSpot ? (exactKm as number) : top, recorded_km: top, climb_phase: "outcome" as const, ...(trueSpot && exactTime != null ? { race_time_s: exactTime } : {}) };
    return [{ event: attack, spanned: true }, { event: outcome, spanned: false }];
  };
  const resolveOne = <T extends SpanTimelineEvent>(event: T): { event: T; spanned: boolean } => {
    const exact = exactEventKm(event);
    if (exact != null) return { event: { ...event, km: exact }, spanned: false };
    const km = finite(event.km);
    if (km == null || !checkpointEngine || !isCheckpointStamped(event) || (finishKm != null && km >= finishKm)) return { event, spanned: false };
    const from = previousAnchor(km);
    if (!(from < km)) return { event, spanned: false };
    return { event: { ...event, km: from, recorded_km: km, km_span: { from, to: km } }, spanned: true };
  };
  /** Alle linjer en hændelse bliver til i filmen (to for stigningens opsummering, ellers én). */
  const resolveAll = <T extends SpanTimelineEvent>(event: T): Array<{ event: T; spanned: boolean }> => climbParts(event) ?? [resolveOne(event)];
  /** Hændelsens ENE linje til lister (tidstab): udfaldet, ellers filmens egen linje. */
  const resolve = <T extends SpanTimelineEvent>(event: T): { event: T; spanned: boolean } => {
    const parts = climbParts(event);
    return parts ? parts[parts.length - 1] : resolveOne(event);
  };
  return Object.assign(resolve, { all: resolveAll });
}

/**
 * Den samme km som filmen, for lister der viser enkelte hændelser fra den rå
 * tidslinje (fx "hvor tabte dine ryttere tid"): returnerer en funktion der
 * giver hændelsen med filmens `km`/`km_span`. Spændet afhænger kun af hele
 * tidslinjen og hændelsens egen type og km, så resultatet er det samme som
 * hændelsens linje i filmen.
 */
export function honestKmResolver(
  events: readonly (SpanTimelineEvent | null | undefined)[] | null | undefined,
  options: TimelineOptions = {},
): <T extends SpanTimelineEvent>(event: T) => T {
  const resolve = spanResolver(keptEvents(events), options);
  return (event) => resolve(event).event;
}

type LossLike = { type: string; km: number; riderId: string; event?: SpanTimelineEvent | null };

/**
 * "Hvor tabte dine ryttere tid" med filmens km: hver linje får `shown` (den
 * hændelse filmen viser, med `km`/`km_span`) og listen står i filmens
 * rækkefølge. Et fald er motorens `peloton_splits` for rytteren på samme km;
 * findes den ikke, bruges en hændelse af samme type og km (samme spænd).
 */
export function lossEntriesWithFilmKm<E extends LossLike>(
  events: readonly (SpanTimelineEvent | null | undefined)[] | null | undefined,
  entries: readonly E[],
  options: TimelineOptions = {},
): Array<E & { shown: SpanTimelineEvent }> {
  if (!entries.length) return [];
  const resolve = honestKmResolver(events, options);
  const splits = kmSortedEvents(events).filter((event) => event.type === "peloton_splits");
  return entries
    .map((entry, i) => {
      const source: SpanTimelineEvent = entry.type === "event" && entry.event ? entry.event
        : splits.find((event) => finite(event.km) === entry.km && Array.isArray(event.params?.rider_ids) && event.params.rider_ids.includes(entry.riderId))
          ?? { type: "peloton_splits", km: entry.km };
      const shown = resolve(source);
      // #7965: en stigningsopsummering står i listen som sit udfald (knækket), så linjens tekst og sted er filmens udfaldslinje.
      return { entry: { ...entry, shown, ...(shown.climb_phase && entry.type === "event" ? { event: shown } : {}) }, i };
    })
    .sort((a, b) => (a.entry.shown.km ?? 0) - (b.entry.shown.km ?? 0) || a.i - b.i)
    .map(({ entry }) => entry);
}

/**
 * Tidslinjen som filmen skal vise den: uden samlinger forklædt som
 * indhentninger (#6294), km-sorteret, og med ærlige spænd (#6350) for
 * hændelser stemplet ved et tjekpunkt. Et spænd-event får `km` = spændets
 * start (afspilning og sortering), `recorded_km` = tjekpunktet og `km_span`.
 * Hændelser på målstregen (afgørelsen, opdelingen bag vinderen) står på
 * stregen og får aldrig spænd.
 */
export function honestTimelineEvents<T extends SpanTimelineEvent>(
  events: readonly (T | null | undefined)[] | null | undefined,
  options: TimelineOptions = {},
): T[] {
  const kept = keptEvents(events, options.startlist);
  const resolve = spanResolver(kept, options);
  const shown = kept.flatMap((event, i) => resolve.all(event).map((part) => ({ ...part, i })));
  // Spændets start sorterer; ved samme km står det præcise punkt (fx spurten
  // der åbner spændet) før spændet, og spænd holder tjekpunkt-rækkefølgen.
  shown.sort((a, b) => (a.event.km ?? 0) - (b.event.km ?? 0)
    || Number(a.spanned) - Number(b.spanned)
    || (a.event.recorded_km ?? a.event.km ?? 0) - (b.event.recorded_km ?? b.event.km ?? 0)
    || a.i - b.i);
  return shown.map(({ event }) => event);
}

/**
 * Værdien til `detail.film.km` ("km {value}"): "105-122" for et spænd
 * (start rundet ned, tjekpunkt rundet op, så spændet altid rummer det sande
 * sted), ellers eventets egen km. `format` er sidens talformat.
 */
export function filmKmValue(event: SpanTimelineEvent | null | undefined, format: (value: number) => string): string {
  const span = event?.km_span;
  if (span && Number.isFinite(span.from) && Number.isFinite(span.to)) {
    return `${format(Math.floor(span.from))}-${format(Math.ceil(span.to))}`;
  }
  return format(event?.km ?? 0);
}
