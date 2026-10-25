// #6299 (ejer-go 24/10): kun dagens rigtige udbrud hedder "udbrud".
//
// Motoren lader en gruppe der splittes ud af udbruddet ARVE oprindelsen
// "breakaway" (groups.ts splitGroup, #5578). Dens survived/caught/dropped-
// hændelser kan derfor nævne ryttere der aldrig var med i udbruddet, fx en
// kontra der lukkede hullet. Visningen skelner her, i præsentationslaget, og
// rører ikke motoren:
//   - "breakaway":   alle nævnte ryttere er fra udbruddets dannelse
//   - "group_ahead": ingen af dem er; vises som "gruppe foran feltet"
//   - "mixed":       begge dele; kun udbrydderne nævnes som udbrud
//
// Udbruddet er rytterne fra `breakaway_formed`, med SAMME regel som
// resultat-mærkerne (#7092/#7119) og serverens story.breakaway:
// deriveParticipationHistory's morningRiderIds (første dannelse + et nyt udbrud
// efter en tidlig indhentning, `reformation`). Ukendt dannelse (ældre
// tidslinjer uden rytterliste) = ingen mærkning, visningen er uændret.
import { deriveParticipationHistory } from "../../../backend/lib/raceParticipationHistory.ts";
import type { ParticipationEvent } from "../../../backend/lib/raceParticipationHistory.ts";

export type BreakawayLabel = "breakaway" | "group_ahead" | "mixed";

export interface BreakawaySplit {
  label: BreakawayLabel;
  /** Ryttere fra udbruddets dannelse (dem der må kaldes udbrud). */
  morningIds: string[];
  /** Ryttere der kører foran feltet uden at have været i udbruddet. */
  aheadIds: string[];
}

type TimelineEvent = { type?: string; km?: number; params?: Record<string, unknown> | null; [key: string]: unknown };

/** Hændelser hvis rytterliste motoren kalder "udbruddet". */
export const BREAKAWAY_EVENT_TYPES: ReadonlySet<string> = new Set(["breakaway_formed", "breakaway_caught", "breakaway_survived", "breakaway_dropped"]);

/** Feltet hændelsen bærer sin mærkning i (sat af labelBreakawayEvents). */
export const BREAKAWAY_LABEL_FIELD = "breakawayLabel6299";

function riderIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

/**
 * Udbruddets ryttere ud fra tidslinjen, eller null når dannelsen ikke kendes
 * (ingen `breakaway_formed` med rytterliste): så mærkes intet.
 */
export function morningBreakawayRiderIds(events: readonly TimelineEvent[] | null | undefined): Set<string> | null {
  const list = Array.isArray(events) ? events : [];
  const formation = list.find((e) => e?.type === "breakaway_formed");
  if (!formation || !Array.isArray(formation.params?.rider_ids)) return null;
  const history = deriveParticipationHistory(list as ParticipationEvent[]);
  return history.morningRiderIds.size ? new Set(history.morningRiderIds) : null;
}

/** Del en rytterliste i udbrud og gruppe foran feltet. Ukendt udbrud = alt er udbrud (uændret). */
export function splitBreakawayRiders(ids: readonly string[] | null | undefined, morning: ReadonlySet<string> | null | undefined): BreakawaySplit {
  const all = riderIds(ids);
  if (!morning || morning.size === 0) return { label: "breakaway", morningIds: all, aheadIds: [] };
  const morningIds = all.filter((id) => morning.has(id));
  const aheadIds = all.filter((id) => !morning.has(id));
  if (!aheadIds.length) return { label: "breakaway", morningIds, aheadIds };
  return { label: morningIds.length ? "mixed" : "group_ahead", morningIds, aheadIds };
}

/**
 * Tidslinjen med en mærkning på hver udbruds-hændelse der nævner ryttere uden
 * for udbruddet. Øvrige hændelser (og alt når udbruddet er ukendt) returneres
 * som de er. `source` er listen udbruddet læses fra (default: `events`).
 */
export function labelBreakawayEvents<T extends TimelineEvent>(events: readonly T[] | null | undefined, source: readonly TimelineEvent[] | null | undefined = events): T[] {
  const list = Array.isArray(events) ? [...events] : [];
  const morning = morningBreakawayRiderIds(source);
  if (!morning) return list;
  return list.map((event) => {
    if (!event || !BREAKAWAY_EVENT_TYPES.has(String(event.type))) return event;
    const split = splitBreakawayRiders(riderIds(event.params?.rider_ids), morning);
    return split.label === "breakaway" ? event : { ...event, [BREAKAWAY_LABEL_FIELD]: split };
  });
}

/** Mærkningen på en hændelse (labelBreakawayEvents), eller null. */
export function breakawayLabelOf(event: unknown): BreakawaySplit | null {
  const value = (event as Record<string, unknown> | null)?.[BREAKAWAY_LABEL_FIELD];
  return value && typeof value === "object" ? (value as BreakawaySplit) : null;
}

/** Udbruddet fra løbshistoriens kontrakt (story.breakaway), eller null = ukendt. */
export function morningFromStory(story: { breakaway?: { morning_rider_ids?: readonly string[] } | null } | null | undefined): Set<string> | null {
  const ids = riderIds(story?.breakaway?.morning_rider_ids);
  return ids.length ? new Set(ids) : null;
}

type StoryLineLike = { riderIds: string[]; mineIds: string[]; count: number; data: Record<string, string | number | boolean | null> };

/**
 * Etapeside 2.0's linje for en udbruds-hændelse: "group_ahead" får
 * `data.ahead = true` (teksten siger "gruppe foran feltet"); "mixed" nævner og
 * tæller kun udbrydderne. Returnerer samme linje (muteret), så kaldet kan
 * pakkes om et eksisterende baseLine-kald.
 */
export function labelStoryLine<L extends StoryLineLike>(line: L, morning: ReadonlySet<string> | null): L {
  const split = splitBreakawayRiders(line.riderIds, morning);
  if (split.label === "group_ahead") line.data.ahead = true;
  else if (split.label === "mixed") {
    const mine = new Set(line.mineIds);
    line.riderIds = split.morningIds;
    line.mineIds = split.morningIds.filter((id) => mine.has(id));
    line.count = split.morningIds.length;
  }
  return line;
}

/**
 * Filmens tekst for én udbruds-hændelse: copy-nøglen og de ryttere linjen må
 * nævne. "group_ahead" bruger gruppe-nøglen (`group_ahead_*`); "mixed" nævner
 * kun udbrydderne under udbruds-nøglen. Umærket = uændret.
 */
export function breakawayFilmCopy(event: unknown, baseKey: string): { key: string; riderIds: string[]; ahead: boolean } {
  const params = (event as { params?: Record<string, unknown> } | null)?.params ?? {};
  const label = breakawayLabelOf(event);
  if (!label) return { key: baseKey, riderIds: riderIds(params.rider_ids), ahead: false };
  if (label.label === "group_ahead") return { key: baseKey.replace(/^breakaway_/, "group_ahead_").replace(/_by_(teams|peloton)$/, ""), riderIds: label.aheadIds, ahead: true };
  return { key: baseKey, riderIds: label.morningIds, ahead: false };
}
