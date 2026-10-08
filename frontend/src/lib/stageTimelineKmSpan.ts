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

type TimelineOptions = { timelineVersion?: number | null };

/** Stabil km-sortering af de hændelser der har en type (samme km: input-rækkefølgen). */
export function kmSortedEvents<T extends SpanTimelineEvent>(events: readonly (T | null | undefined)[] | null | undefined): T[] {
  return (events ?? [])
    .filter((event): event is T => !!event && typeof event.type === "string")
    .map((event, i) => ({ event, i }))
    .sort((a, b) => (finite(a.event.km) ?? 0) - (finite(b.event.km) ?? 0) || a.i - b.i)
    .map(({ event }) => event);
}

/** Tidslinjen uden samlinger forklædt som indhentninger, km-sorteret (#6294). */
function keptEvents<T extends SpanTimelineEvent>(events: readonly (T | null | undefined)[] | null | undefined): T[] {
  // Projektionen er rækkefølge-følsom: den læser den rå, km-sorterede tidslinje.
  return withoutRegroupCatches(kmSortedEvents(events) as unknown as ParticipationEvent[]) as unknown as T[];
}

/**
 * Den km filmen viser for én hændelse fra `kept`-tidslinjen: `exact_km` når
 * motoren har skrevet et (aldrig spænd), ellers det ærlige spænd for en
 * tjekpunkt-stemplet hændelse på en v4-tidslinje, ellers eventets egen km.
 */
function spanResolver(kept: readonly SpanTimelineEvent[], { timelineVersion = null }: TimelineOptions) {
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
  return <T extends SpanTimelineEvent>(event: T): { event: T; spanned: boolean } => {
    const exact = exactEventKm(event);
    if (exact != null) return { event: { ...event, km: exact }, spanned: false };
    const km = finite(event.km);
    if (km == null || !checkpointEngine || !isCheckpointStamped(event) || (finishKm != null && km >= finishKm)) return { event, spanned: false };
    const from = previousAnchor(km);
    if (!(from < km)) return { event, spanned: false };
    return { event: { ...event, km: from, recorded_km: km, km_span: { from, to: km } }, spanned: true };
  };
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
      return { entry: { ...entry, shown: resolve(source) }, i };
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
  const kept = keptEvents(events);
  const resolve = spanResolver(kept, options);
  const shown = kept.map((event, i) => ({ ...resolve(event), i }));
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
